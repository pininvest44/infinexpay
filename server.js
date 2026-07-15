const express = require('express');
const axios = require('axios');
const Bottleneck = require('bottleneck');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Configure rate limiter: Max 20 requests per minute (60000ms / 20 = 3000ms interval)
const limiter = new Bottleneck({
  minTime: 3000 
});

// STK Worker execution
const sendStkPush = async (phone, amount, reference, description) => {
  const url = "https://infinexpay.co.ke/api/v2/stkpush.php";
  
  try {
    const response = await axios.post(url, {
      payment_account_id: parseInt(process.env.INFINEX_ACCOUNT_ID),
      phone: phone,
      amount: parseFloat(amount),
      reference: reference,
      description: description
    }, {
      headers: {
        'X-API-Key': process.env.INFINEX_API_KEY,
        'X-API-Secret': process.env.INFINEX_API_SECRET,
        'Content-Type': 'application/json'
      },
      timeout: 15000 // 15s timeout
    });

    return { phone, success: response.data?.success || false, data: response.data };
  } catch (error) {
    return { 
      phone, 
      success: false, 
      error: error.response?.data?.message || error.message 
    };
  }
};

// Wrapped in the rate limiter
const limitedStkPush = limiter.wrap(sendStkPush);

// Endpoint to receive bulk operations
app.post('/api/bulk-stk', async (req, res) => {
  const { numbers, amount, reference, description } = req.body;

  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: "Invalid phone numbers array provided." });
  }

  // Acknowledge receipt to frontend and process requests asynchronously 
  res.status(202).json({ message: `Bulk processing started for ${numbers.length} numbers.` });

  // Process in background sequentially obeying the rate limit
  for (const [index, phone] of numbers.entries()) {
    const uniqueRef = `${reference}-${index + 1}`;
    
    // Log the initiation timestamp to server logs
    console.log(`[${new Date().toISOString()}] Queueing STK to ${phone}`);
    
    limitedStkPush(phone, amount, uniqueRef, description)
      .then(result => {
        if (result.success) {
          console.log(`✅ Success | Phone: ${result.phone} | RequestID: ${result.data?.checkout_request_id}`);
        } else {
          console.error(`❌ Failed | Phone: ${result.phone} | Reason: ${result.error || result.data?.message}`);
        }
      });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
