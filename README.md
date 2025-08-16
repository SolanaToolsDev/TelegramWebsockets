# 🚀 Solana Token Cache & Enrichment API

A high-performance **Solana token data aggregation and caching system** that fetches, processes, and serves token information from multiple sources for efficient access by Telegram bots.

## 📊 Overview

This API acts as a **high-performance data layer** between your Telegram bot and external APIs, ensuring fast, reliable access to curated Solana token data with market information, metadata, and supply details.

## 🎯 Main Purpose

Aggregates and caches Solana token data with:
- **Market Data**: Price, market cap, liquidity, trading pairs
- **Token Metadata**: Mintable/freezable status, supply, decimals, names
- **Smart Filtering**: Only high-quality, locked tokens (not mintable, not freezable)
- **Fast Access**: Cached data served in < 100ms

## 📊 Data Sources

### 1. DexScreener API
- **Token Profiles**: `https://api.dexscreener.com/token-profiles/latest/v1`
- **Market Data**: `https://api.dexscreener.com/latest/dex/search/?q={address}`
- **Provides**: Price, market cap, liquidity, trading pairs

### 2. Helius API
- **Token Metadata**: `https://api.helius.xyz/v0/token-metadata`
- **Token Supply**: RPC calls to `mainnet.helius-rpc.com`
- **Provides**: Mintable/freezable status, supply, decimals, names

## 🗄️ Storage System

### Dual Cache Strategy
- **Redis**: Fast, in-memory cache (primary)
- **SQLite**: Persistent backup storage
- **Fallback**: If Redis fails, uses SQLite

### Cache Structure
```
basic_tokens:     Basic token profiles from DexScreener
enriched_tokens:  Enhanced data with market cap, supply, metadata
```

## ⚡ Key Features

### 1. Smart Rate Limiting
- **DexScreener**: 50 RPM (requests per minute)
- **Helius**: 60 RPM
- **Prevents**: API rate limit violations

### 2. Batch Processing
- **Batch Size**: 20 tokens per batch
- **Parallel**: Metadata and supply calls run simultaneously
- **Efficient**: Reduces API calls by ~83%

### 3. Filtering & Limits
- **Market Cap**: Minimum $25,000
- **Token Limits**: Maximum 50 tokens stored
- **Criteria**: Not mintable, not freezable

### 4. Caching Strategy
- **Basic Data**: 5-minute expiry
- **Enriched Data**: 5-minute expiry  
- **Metadata**: 1-hour expiry (rarely changes)

## 🔄 Processing Flow

### Step 1: Fetch Basic Tokens
```bash
node cache-solana-tokens.js fetch
```
- Gets all Solana tokens from DexScreener
- Stores basic info (description, links, icons)
- Uses ETag for efficient updates

### Step 2: Enrich with Market Data
```bash
node cache-solana-tokens.js enrich
```
- Fetches market data for each token
- Gets supply and metadata from Helius
- Filters by market cap and token properties
- Stores top 50 qualifying tokens

### Step 3: Serve to Bot
- Telegram bot reads cached data
- Fast response times (< 100ms)
- No API calls during bot requests

## 📈 Optimization Features

### 1. Single-Flight Protection
- Prevents multiple requests for same token
- Uses Redis locks to avoid dogpiling

### 2. Stale-While-Revalidate
- Serves cached data immediately
- Refreshes in background
- Prevents stampede effects

### 3. Request Collapse
- 30-second cache for recent lookups
- Skips duplicate API calls

## 🛠️ Installation

### Prerequisites
- Node.js 16+
- Redis (optional, for enhanced performance)
- Helius API key

### Setup
```bash
# Clone the repository
git clone <repository-url>
cd Dexscreenerbot

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys
```

### Environment Variables
```env
# Required
HELIUS_API_KEY=your_helius_api_key

# Optional
USE_REDIS=true                    # Enable Redis (default: false)
REDIS_URL=redis://localhost:6379  # Redis connection string
BOT_TOKEN=your_telegram_bot_token
WEBHOOK_URL=your_webhook_url
```

## 🚀 Usage

### Available Commands

```bash
# Core Operations
node cache-solana-tokens.js fetch         # Get basic tokens
node cache-solana-tokens.js enrich        # Add market data
node cache-solana-tokens.js test          # Test with 3 tokens

# Data Retrieval
node cache-solana-tokens.js get           # Get basic tokens
node cache-solana-tokens.js enriched      # Get enhanced tokens
node cache-solana-tokens.js list          # Pretty print tokens

# Maintenance
node cache-solana-tokens.js info          # Cache status
node cache-solana-tokens.js cleanup       # Remove expired data
node cache-solana-tokens.js stats         # Performance metrics
```

### Automated Token Updates with Systemd

The system includes systemd service and timer files for automated token data updates every 4 minutes.

#### Setup Systemd Service

```bash
# Copy systemd files to system directory
sudo cp soltools-cache.* /etc/systemd/system/

# Reload systemd daemon
sudo systemctl daemon-reload

# Enable and start the timer (runs every 4 minutes)
sudo systemctl enable --now soltools-cache.timer

# Check timer status
systemctl status soltools-cache.timer
```

#### Systemd Service Details

- **Service**: `soltools-cache.service` - Runs the enrichment job
- **Timer**: `soltools-cache.timer` - Triggers service every 4 minutes
- **Schedule**: Runs 30 seconds after boot, then every 4 minutes
- **User**: Runs as root (adjust paths in service file if needed)
- **Logs**: Available via `journalctl -u soltools-cache.service`

#### Management Commands

```bash
# Check timer status
systemctl status soltools-cache.timer

# Check service status
systemctl status soltools-cache.service

# View recent logs
journalctl -u soltools-cache.service -f

# Manually trigger a cache update
systemctl start soltools-cache.service

# Disable automatic updates
systemctl disable soltools-cache.timer

# Stop the timer
systemctl stop soltools-cache.timer
```

#### Timer Configuration

The timer runs:
- **On Boot**: 30 seconds after system startup
- **Interval**: Every 4 minutes
- **Accuracy**: ±10 seconds
- **Persistent**: Resumes schedule after system restart

### Example Workflow
```bash
# 1. Fetch basic token data
node cache-solana-tokens.js fetch

# 2. Enrich with market data (this will filter to top 50 tokens)
node cache-solana-tokens.js enrich

# 3. Check cache status
node cache-solana-tokens.js info

# 4. List all cached tokens
node cache-solana-tokens.js list
```

## 🔧 Configuration

### Cache Settings
- **Max Tokens**: 50 (top by market cap)
- **Min Market Cap**: $25,000
- **Cache Expiry**: 5 minutes
- **Batch Size**: 20 tokens

### Rate Limits
- **DexScreener**: 50 RPM (safe under 60 RPM limit)
- **Helius**: 60 RPM (adjustable based on plan)

## 📊 Performance

### API Call Reduction
- **Before**: ~3001 calls for 1000 tokens
- **After**: ~101 calls for 1000 tokens
- **Improvement**: 83% reduction

### Processing Time
- **Before**: ~5 minutes for 1000 tokens
- **After**: ~2 minutes for 1000 tokens
- **Improvement**: 60% faster

### Cost Savings
- **Before**: ~$0.06 for 1000 tokens
- **After**: ~$0.01 for 1000 tokens
- **Savings**: 83% cost reduction

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DexScreener   │    │     Helius      │    │   Telegram Bot  │
│     API         │    │      API        │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cache & Enrichment API                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │    Redis    │  │   SQLite    │  │ Rate Limit  │            │
│  │   (Fast)    │  │ (Backup)    │  │   Manager   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## 🔍 API Endpoints

### Cache Management
- `GET /health` - Health check
- `POST /webhook` - Telegram webhook endpoint

### Data Access
- `getCachedSolanaTokens()` - Get basic tokens
- `getEnrichedTokens()` - Get enhanced tokens
- `cleanupExpiredRecords()` - Clean up expired data

## 🐛 Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Check if Redis is running: `redis-cli ping`
   - Verify `REDIS_URL` in environment
   - System will fallback to SQLite

2. **API Rate Limits**
   - Check rate limiter settings
   - Reduce batch size if needed
   - Monitor API usage

3. **No Token Data**
   - Verify `HELIUS_API_KEY` is set
   - Check API endpoints are accessible
   - Run `node cache-solana-tokens.js info`

### Debug Commands
```bash
# Check cache status
node cache-solana-tokens.js info

# View optimization stats
node cache-solana-tokens.js stats

# Test with small dataset
node cache-solana-tokens.js test

# Clean up expired data
node cache-solana-tokens.js cleanup
```

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
- Create an issue on GitHub
- Check the troubleshooting section
- Review the configuration options

---

**Built with ❤️ for the Solana ecosystem**