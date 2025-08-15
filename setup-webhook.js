const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

async function setupWebhook() {
  const axios = require('axios');
  
  try {
    // Set webhook URL
    const webhookUrl = process.env.WEBHOOK_URL || 'https://tzen.ai/webhook';
    const botToken = process.env.BOT_TOKEN;
    
    console.log(`Setting webhook to: ${webhookUrl}`);
    
    const response = await axios.post(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      url: webhookUrl
    });
    
    console.log('Webhook setup response:', response.data);
    
    if (response.data.ok) {
      console.log('✅ Webhook configured successfully!');
      console.log(`📝 Webhook URL: ${webhookUrl}`);
    } else {
      console.log('❌ Webhook configuration failed');
    }
    
  } catch (error) {
    console.error('❌ Error setting up webhook:', error.message);
  }
}

// Run setup
setupWebhook();
