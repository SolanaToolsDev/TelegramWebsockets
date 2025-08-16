require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getEnrichedTokens, getCachedSolanaTokens } = require('./cache-solana-tokens');

const app = express();
const PORT = process.env.PORT || 3000;

// SQLite configuration
const DB_PATH = path.join(__dirname, 'tokens.db');

// Initialize SQLite database
let db = null;
let dbConnected = false;

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
// SQLITE FUNCTIONS
// =============================================================================

// Ensure database connection
async function ensureDB() {
  if (!dbConnected) {
    return new Promise((resolve, reject) => {
      db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          console.error('❌ Error opening database:', err.message);
          reject(err);
        } else {
          console.log('🔗 Connected to SQLite database');
          dbConnected = true;
          resolve();
        }
      });
    });
  }
}

// Get data from SQLite
function dbGet(table, key) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT data FROM ${table} WHERE key_name = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      [key],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? JSON.parse(row.data) : null);
        }
      }
    );
  });
}



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

async function handleStartCommand(chatId, userId) {
  console.log(`🚀 /start command from user ${userId}`);
  
  try {
    // Get all basic tokens from cache (all tokens from DexScreener)
    const basicData = await getCachedSolanaTokens();
    
    // Send welcome message
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
    
    await bot.sendMessage(chatId, 
      '🤖 Welcome to SolTools Test Bot!\n\n' +
      'This bot is for testing functionality only.',
      { reply_markup: keyboard }
    );
    
    // Send all tokens in one message
    if (basicData && basicData.tokens && basicData.tokens.length > 0) {
      const tokens = basicData.tokens;
      
      if (tokens.length > 0) {
        // Build the message with all tokens
        let message = '🏆 **All Cached Solana Tokens:**\n\n';
        
        tokens.forEach((token, index) => {
          const rank = index + 1;
          const name = token.description ? token.description.substring(0, 40) : 'Unknown';
          const address = token.tokenAddress ? token.tokenAddress.substring(0, 8) + '...' : 'N/A';
          
          message += `${rank}. **${name}** - ${address}\n`;
        });
        
        message += `\n📊 Total: ${tokens.length} tokens\n`;
        message += `🕐 Last updated: ${new Date(basicData.timestamp).toLocaleString()}`;
        
        // Send the complete message
        await bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true // Prevent link previews
        });
        
        console.log(`✅ Sent ${tokens.length} tokens to user ${userId}`);
      } else {
        await bot.sendMessage(chatId, 
          '📊 No tokens found in cache. Please try again later.'
        );
      }
    } else {
      await bot.sendMessage(chatId, 
        '📊 No token data available at the moment. Please try again later.'
      );
    }
    
    console.log(`✅ /start response sent to user ${userId}`);
    
  } catch (error) {
    console.error(`❌ Error sending /start response to user ${userId}:`, error);
    
    // Send fallback message
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
    
    await bot.sendMessage(chatId, 
      '🤖 Welcome to SolTools Test Bot!\n\n' +
      'This bot is for testing functionality only.',
      { reply_markup: keyboard }
    );
  }
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

// Connect to SQLite on startup
ensureDB().then(() => {
  console.log('🔗 Connected to SQLite database');
}).catch((error) => {
  console.error('❌ Failed to connect to SQLite database:', error);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Bot: @soltoolsdexpaidbot`);
  console.log(`📝 Webhook URL: ${process.env.WEBHOOK_URL}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Close database connection
  if (db) {
    db.close((err) => {
      if (err) {
        console.error('❌ Error closing database:', err.message);
      } else {
        console.log('🔗 Database connection closed');
      }
    });
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  
  // Close database connection
  if (db) {
    db.close((err) => {
      if (err) {
        console.error('❌ Error closing database:', err.message);
      } else {
        console.log('🔗 Database connection closed');
      }
    });
  }
  
  process.exit(0);
});