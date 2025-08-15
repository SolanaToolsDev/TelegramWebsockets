# SolTools Test Bot (@soltoolsdexpaidbot)

A Telegram test bot with integrated Solana token caching and enrichment functionality.

## Features

- 🤖 Telegram bot with inline keyboard support
- 🧪 Test button functionality for development
- 📱 Interactive inline keyboards
- 🔧 Simple webhook-based architecture
- ⚡ Solana token caching from DexScreener API
- 🔬 Token enrichment with Helius API (names & tickers)
- 📊 Redis caching with automatic expiration
- ⏰ Automated background token updates via systemd

## Setup

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the bot token you receive

### 2. Configure Environment Variables

Edit the `.env` file and replace the placeholder values:

```env
# Telegram Bot Configuration
BOT_TOKEN=your_actual_bot_token_here
WEBHOOK_URL=https://your-domain.com/webhook

# Server Configuration
PORT=3000

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=your_redis_password_here

# Helius API Configuration
HELIUS_API_KEY=your_helius_api_key
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Install Redis (Required for token caching)

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install redis-server

# Start Redis service
sudo systemctl start redis
sudo systemctl enable redis
```

### 5. Set up Webhook (Production)

For production deployment, set up the webhook:

```bash
# Update WEBHOOK_URL in .env file first
npm run setup-webhook
```

### 6. Run the Bot

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

## Token Caching & Enrichment

The bot includes a powerful token caching system that fetches Solana tokens from DexScreener and enriches them with metadata from Helius API.

### Manual Token Operations

```bash
# Fetch and cache basic token data only
node cache-solana-tokens.js fetch

# Fetch, enrich with names/tickers, and cache
node cache-solana-tokens.js enrich

# Test mode (process first 3 tokens)
node cache-solana-tokens.js test

# Limit enrichment to specific number
node cache-solana-tokens.js enrich 10

# View basic cached tokens
node cache-solana-tokens.js get

# View enriched tokens as JSON
node cache-solana-tokens.js enriched

# List enriched tokens with names and tickers
node cache-solana-tokens.js list

# Show cache status and info
node cache-solana-tokens.js info
```

### Automated Token Updates

The system includes a systemd service that automatically updates token data every 4 minutes:

```bash
# Check service status
sudo systemctl status soltools-cache.service

# View service logs
sudo journalctl -u soltools-cache.service -f

# Restart service
sudo systemctl restart soltools-cache.service
```

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