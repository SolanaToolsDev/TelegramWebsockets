# SolTools Test Bot (@soltoolsdexpaidbot)

A simple Telegram test bot for testing keyboard and button functionality.

## Features

- 🤖 Telegram bot with inline keyboard support
- 🧪 Test button functionality for development
- 📱 Interactive inline keyboards
- 🔧 Simple webhook-based architecture

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the bot token you receive

### 2. Configure Environment Variables

Edit the `.env` file and replace the placeholder values:

```env
BOT_TOKEN=your_actual_bot_token_here
WEBHOOK_URL=https://your-domain.com/webhook
PORT=3000
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Set up Webhook (Production)

For production deployment, set up the webhook:

```bash
# Update WEBHOOK_URL in .env file first
npm run setup-webhook
```

### 5. Run the Bot

**Using the Management Script (Recommended):**
```bash
# Start the bot service
./manage-bot.sh start

# Check status
./manage-bot.sh status

# View logs
./manage-bot.sh logs

# Restart the bot
./manage-bot.sh restart

# Switch to development mode
./manage-bot.sh dev

# Switch to production mode
./manage-bot.sh prod

# Run tests
./manage-bot.sh test
```

**Manual Commands:**
```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

**Systemd Service Commands:**
```bash
# Start service
systemctl start soltools-dexbot

# Stop service
systemctl stop soltools-dexbot

# Restart service
systemctl restart soltools-dexbot

# Check status
systemctl status soltools-dexbot

# View logs
journalctl -u soltools-dexbot -f
```

## Available Commands

- `/start` - Show main menu with test options
- `/help` - Show available commands and usage examples
- `/test` - Display test menu with 4 test buttons

## Test Functionality

### Inline Keyboard Testing
- **Test Buttons**: 4 interactive test buttons (Test 1, 2, 3, 4)
- **Navigation**: Back to main menu functionality
- **Feedback**: Success messages when buttons are clicked
- **Menu System**: Simple two-level menu structure

### Commands Testing
- **Command Processing**: Tests webhook command handling
- **Response Verification**: Confirms bot responses work correctly
- **Error Handling**: Tests unknown command responses

## API Endpoints

The bot provides these HTTP endpoints:
- `POST /webhook` - Telegram webhook endpoint
- `GET /health` - Health check endpoint

## Project Structure

```
DexScreenerbot/
├── server.js           # Main server with webhook support
├── setup-webhook.js    # Webhook configuration script
├── manage-bot.sh       # Management script for service control
├── .env                # Environment variables
├── package.json        # Dependencies and scripts
└── README.md           # This file
```

## Testing Checklist

- [ ] `/start` command shows main menu
- [ ] `/help` command shows help information
- [ ] `/test` command shows test menu
- [ ] All 4 test buttons work correctly
- [ ] "Back to Main" button functions
- [ ] Unknown commands show error message
- [ ] Bot responds to inline keyboard presses
- [ ] Webhook receives and processes updates correctly

## Dependencies

- `node-telegram-bot-api` - Telegram Bot API wrapper
- `express` - Web server framework
- `dotenv` - Environment variable management
- `nodemon` - Development auto-restart (dev dependency)

## Production Setup

This bot is configured to run on:
- **Domain**: https://tzen.ai
- **SSL**: Let's Encrypt certificates
- **Reverse Proxy**: Nginx
- **Process Manager**: systemd
- **Auto-restart**: Configured for high availability

## License

ISC