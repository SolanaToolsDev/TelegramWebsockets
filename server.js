require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize bot with webhook
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================================================================
// HTTP ENDPOINTS
// =============================================================================

// Webhook endpoint
app.post('/webhook', (req, res) => {
  const update = req.body;
  console.log('📥 Webhook received:', update);
  
  if (update.message) {
    handleMessage(update.message);
  } else if (update.callback_query) {
    bot.emit('callback_query', update.callback_query);
  }
  
  res.sendStatus(200);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bot: '@soltoolsdexpaidbot'
  });
});

// =============================================================================
// TELEGRAM COMMAND HANDLERS
// =============================================================================

function handleMessage(msg) {
  const text = msg.text;
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`📨 Processing message from user ${userId}: ${text}`);
  
  // Handle commands
  if (text === '/start') {
    handleStartCommand(chatId, userId);
  } else if (text === '/help') {
    handleHelpCommand(chatId, userId);
  } else if (text === '/test') {
    handleTestCommand(chatId, userId);
  } else if (text && text.startsWith('/')) {
    handleUnknownCommand(chatId, userId, text);
  }
}

function handleStartCommand(chatId, userId) {
  console.log(`🚀 /start command from user ${userId}`);
  
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🧪 Test Buttons', callback_data: 'test_menu' }
      ],
      [
        { text: '❓ Help', callback_data: 'help_menu' }
      ]
    ]
  };
  
  bot.sendMessage(chatId, 
    '🤖 Welcome to SolTools Test Bot!\n\n' +
    'This bot is for testing functionality only.',
    { reply_markup: keyboard }
  ).then(() => {
    console.log(`✅ /start response sent to user ${userId}`);
  }).catch((error) => {
    console.error(`❌ Error sending /start response to user ${userId}:`, error);
  });
}

function handleHelpCommand(chatId, userId) {
  console.log(`❓ /help command from user ${userId}`);
  
  bot.sendMessage(chatId,
    '📚 **Available Commands:**\n\n' +
    '/start - Show main menu\n' +
    '/help - Show this help\n' +
    '/test - Test functionality\n\n' +
    '🧪 Use the inline buttons to test keyboard functionality!'
  );
}

function handleTestCommand(chatId, userId) {
  console.log(`🧪 /test command from user ${userId}`);
  
  const testKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Test 1', callback_data: 'test_1' },
        { text: '✅ Test 2', callback_data: 'test_2' }
      ],
      [
        { text: '✅ Test 3', callback_data: 'test_3' },
        { text: '✅ Test 4', callback_data: 'test_4' }
      ],
      [
        { text: '🔙 Back to Main', callback_data: 'main_menu' }
      ]
    ]
  };
  
  bot.sendMessage(chatId,
    '🧪 **Test Menu**\n\n' +
    'Click any test button to verify functionality:',
    { reply_markup: testKeyboard }
  );
}

function handleUnknownCommand(chatId, userId, text) {
  console.log(`❓ Unknown command: ${text} from user ${userId}`);
  bot.sendMessage(chatId, '❓ Unknown command. Use /help to see available commands.');
}

// =============================================================================
// CALLBACK QUERY HANDLERS
// =============================================================================

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  
  console.log(`🔘 Callback query received: ${data} from user ${userId}`);
  
  try {
    switch (data) {
      case 'help_menu':
        await handleHelpMenu(chatId, callbackQuery.message.message_id);
        break;
      case 'test_menu':
        await handleTestMenu(chatId, callbackQuery.message.message_id);
        break;
      case 'test_1':
      case 'test_2':
      case 'test_3':
      case 'test_4':
        await handleTestButton(chatId, callbackQuery.message.message_id, callbackQuery.id, data);
        break;
      case 'main_menu':
        await handleMainMenu(chatId, callbackQuery.message.message_id);
        break;
      default:
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❓ Unknown option' });
        break;
    }
    
    // Answer callback query to remove loading state
    await bot.answerCallbackQuery(callbackQuery.id);
    
  } catch (error) {
    console.error('Error handling callback query:', error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ An error occurred. Please try again.',
      show_alert: true
    });
  }
});

// Menu handlers
async function handleHelpMenu(chatId, messageId) {
  await bot.editMessageText(
    '❓ **Help Menu**\n\nUse /help to see all available commands.',
    { chat_id: chatId, message_id: messageId }
  );
}

async function handleTestMenu(chatId, messageId) {
  const testKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Test 1', callback_data: 'test_1' },
        { text: '✅ Test 2', callback_data: 'test_2' }
      ],
      [
        { text: '✅ Test 3', callback_data: 'test_3' },
        { text: '✅ Test 4', callback_data: 'test_4' }
      ],
      [
        { text: '🔙 Back to Main', callback_data: 'main_menu' }
      ]
    ]
  };
  
  await bot.editMessageText(
    '🧪 **Test Menu**\n\nClick any test button to verify functionality:',
    { chat_id: chatId, message_id: messageId, reply_markup: testKeyboard }
  );
}

async function handleTestButton(chatId, messageId, callbackId, testNumber) {
  const testNum = testNumber.split('_')[1];
  
  await bot.answerCallbackQuery(callbackId, { text: `✅ Test ${testNum} passed!` });
  await bot.editMessageText(
    `✅ **Test ${testNum} Result**\n\nTest button ${testNum} is working correctly!`,
    { chat_id: chatId, message_id: messageId }
  );
}

async function handleMainMenu(chatId, messageId) {
  const mainKeyboard = {
    inline_keyboard: [
      [
        { text: '🧪 Test Buttons', callback_data: 'test_menu' }
      ],
      [
        { text: '❓ Help', callback_data: 'help_menu' }
      ]
    ]
  };
  
  await bot.editMessageText(
    '🤖 **Main Menu**\n\nChoose an option:',
    { chat_id: chatId, message_id: messageId, reply_markup: mainKeyboard }
  );
}

// =============================================================================
// ERROR HANDLERS
// =============================================================================

bot.on('error', (error) => {
  console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Bot: @soltoolsdexpaidbot`);
  console.log(`📝 Webhook URL: ${process.env.WEBHOOK_URL}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});