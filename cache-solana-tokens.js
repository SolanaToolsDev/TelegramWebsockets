require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const Bottleneck = require('bottleneck');
const path = require('path');
const redis = require('redis');

// Configuration
const DEXSCREENER_API = 'https://api.dexscreener.com/token-profiles/latest/v1';
const DEXSCREENER_SEARCH_API = 'https://api.dexscreener.com/latest/dex/search/?q=';
const HELIUS_BASE_URL = 'https://api.helius.xyz/v0';
const DB_PATH = path.join(__dirname, 'tokens.db');
const CACHE_EXPIRY = 300; // 5 minutes in seconds
const ENRICHED_CACHE_EXPIRY = 300; // 5 minutes in seconds
const MAX_TOKENS = 50; // Maximum tokens to store in database
const MIN_MARKET_CAP = 25000; // Minimum market cap in USD
const BATCH_SIZE = 20; // Number of tokens to process in each batch
const METADATA_CACHE_EXPIRY = 3600; // 1 hour for metadata (rarely changes)

// Redis configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const USE_REDIS = process.env.USE_REDIS === 'true'; // Default to false if not set

// Rate limiting for DexScreener API
const RATE_LIMIT_DELAY = 200; // 200ms between requests (more generous than Birdeye)
const MAX_CONCURRENT = 3; // Can handle more concurrent requests

// Initialize SQLite database
let db = null;
let dbConnected = false;

// Initialize Redis client
let redisClient = null;
let redisConnected = false;

async function ensureRedis() {
  if (!redisConnected && USE_REDIS) {
    try {
      redisClient = redis.createClient({
        url: REDIS_URL
      });
      
      redisClient.on('error', (err) => {
        console.error('❌ Redis Client Error:', err);
        redisConnected = false;
      });
      
      redisClient.on('connect', () => {
        console.log('🔗 Connected to Redis');
        redisConnected = true;
      });
      
      await redisClient.connect();
      return;
    } catch (error) {
      console.error('❌ Error connecting to Redis:', error.message);
      redisConnected = false;
    }
  }
}

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
          
          // Create tables if they don't exist
          db.serialize(() => {
            // Basic tokens table
            db.run(`CREATE TABLE IF NOT EXISTS basic_tokens (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              key_name TEXT UNIQUE,
              data TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              expires_at DATETIME
            )`);
            
            // Enriched tokens table
            db.run(`CREATE TABLE IF NOT EXISTS enriched_tokens (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              key_name TEXT UNIQUE,
              data TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              expires_at DATETIME
            )`);
          });
          
          resolve();
        }
      });
    });
  }
}

// Clean up expired records
async function cleanupExpiredRecords() {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM basic_tokens WHERE expires_at < datetime('now')`, (err) => {
      if (err) {
        console.error('❌ Error cleaning basic_tokens:', err.message);
        reject(err);
      } else {
        console.log('🧹 Cleaned expired basic_tokens records');
      }
    });
    
    db.run(`DELETE FROM enriched_tokens WHERE expires_at < datetime('now')`, (err) => {
      if (err) {
        console.error('❌ Error cleaning enriched_tokens:', err.message);
        reject(err);
      } else {
        console.log('🧹 Cleaned expired enriched_tokens records');
        resolve();
      }
    });
  });
}

// Close database connection
function closeDB() {
  if (db) {
    db.close((err) => {
      if (err) {
        console.error('❌ Error closing database:', err.message);
      } else {
        console.log('🔗 Database connection closed');
      }
    });
  }
}

// Close Redis connection
async function closeRedis() {
  if (redisClient && redisConnected) {
    try {
      await redisClient.quit();
      console.log('🔗 Redis connection closed');
      redisConnected = false;
    } catch (error) {
      console.error('❌ Error closing Redis connection:', error.message);
    }
  }
}

// Redis helper functions
async function redisGet(key) {
  if (!redisConnected || !USE_REDIS) return null;
  
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`❌ Redis GET error for ${key}:`, error.message);
    return null;
  }
}

async function redisSet(key, data, expirySeconds) {
  if (!redisConnected || !USE_REDIS) return false;
  
  try {
    await redisClient.setEx(key, expirySeconds, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error(`❌ Redis SET error for ${key}:`, error.message);
    return false;
  }
}

async function redisExists(key) {
  if (!redisConnected || !USE_REDIS) return false;
  
  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (error) {
    console.error(`❌ Redis EXISTS error for ${key}:`, error.message);
    return false;
  }
}

async function redisTTL(key) {
  if (!redisConnected || !USE_REDIS) return -1;
  
  try {
    const ttl = await redisClient.ttl(key);
    return ttl;
  } catch (error) {
    console.error(`❌ Redis TTL error for ${key}:`, error.message);
    return -1;
  }
}

// SQLite helper functions
async function dbGet(table, key) {
  // Try Redis first
  const redisKey = `${table}:${key}`;
  const redisData = await redisGet(redisKey);
  if (redisData) {
    return redisData;
  }
  
  // Fallback to SQLite
  return new Promise((resolve, reject) => {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (table === 'enriched_tokens' ? ENRICHED_CACHE_EXPIRY : CACHE_EXPIRY));
    
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

async function dbSet(table, key, data, expirySeconds) {
  // Set in Redis first
  const redisKey = `${table}:${key}`;
  await redisSet(redisKey, data, expirySeconds);
  
  // Also set in SQLite as backup
  return new Promise((resolve, reject) => {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expirySeconds);
    
    db.run(
      `INSERT OR REPLACE INTO ${table} (key_name, data, expires_at) VALUES (?, ?, ?)`,
      [key, JSON.stringify(data), expiresAt.toISOString()],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

async function dbExists(table, key) {
  // Try Redis first
  const redisKey = `${table}:${key}`;
  const redisExistsResult = await redisExists(redisKey);
  if (redisExistsResult) {
    return true;
  }
  
  // Fallback to SQLite
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT 1 FROM ${table} WHERE key_name = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      [key],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      }
    );
  });
}

function dbTTL(table, key) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT expires_at FROM ${table} WHERE key_name = ?`,
      [key],
      (err, row) => {
        if (err) {
          reject(err);
        } else if (!row || !row.expires_at) {
          resolve(-1); // No expiration
        } else {
          const expiresAt = new Date(row.expires_at);
          const now = new Date();
          const ttl = Math.max(0, Math.floor((expiresAt - now) / 1000));
          resolve(ttl);
        }
      }
    );
  });
}

// Helius API client
const heliusAPI = axios.create({
  baseURL: HELIUS_BASE_URL,
  headers: {
    'User-Agent': 'SolTools-Bot/1.0'
  },
  timeout: 10000
});

// Rate limiters with RPM reservoirs
const dexscreenerLimiter = new Bottleneck({
  reservoir: 50, // safe under 60 rpm
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60_000,
  maxConcurrent: 1
});

const heliusLimiter = new Bottleneck({
  reservoir: 60, // tune to your plan
  reservoirRefreshAmount: 60,
  reservoirRefreshInterval: 60_000,
  maxConcurrent: 2
});

async function dexGet(url) {
  return dexscreenerLimiter.schedule(async () => {
    try {
      return await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'SolTools-Bot/1.0' }
      });
    } catch (error) {
      if (error.response?.status === 429) {
        const ra = parseInt(error.response.headers['retry-after'] || '2', 10);
        await sleep((isNaN(ra) ? 2 : ra) * 1000);
      }
      throw error;
    }
  });
}

// Sleep function for rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Number normalization utility
const num = v => (typeof v === 'number' ? v : Number(v || 0));

// Single-flight protection for market data
async function getMarketDataWithLock(mint) {
  const lockKey = `lock:market:${mint}`;
  const recentlyKey = `recent:market:${mint}`;
  
  // Check if recently looked up (30s cache)
  const recently = await redisGet(recentlyKey);
  if (recently) {
    return recently;
  }
  
  // Try to acquire lock
  const lockAcquired = await redisClient.set(lockKey, '1', 'EX', 10, 'NX');
  if (!lockAcquired) {
    // Wait for other request to complete
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const result = await redisGet(recentlyKey);
      if (result) return result;
    }
    return null;
  }
  
  try {
    // Fetch fresh data
    const data = await fetchDexScreenerTokenData(mint);
    if (data) {
      await redisSet(recentlyKey, data, 30); // 30s cache
    }
    return data;
  } finally {
    // Release lock
    await redisClient.del(lockKey);
  }
}

// ETag-based DexScreener fetching
async function fetchDexLatest() {
  const etagKey = 'dex:latest:etag';
  const bodyKey = 'dex:latest:body';
  await ensureDB();
  await ensureRedis();

  const prevEtag = await dbGet('basic_tokens', etagKey);
  const headers = { 'User-Agent': 'SolTools-Bot/1.0' };
  if (prevEtag) headers['If-None-Match'] = prevEtag;

  try {
    const res = await axios.get(DEXSCREENER_API, { timeout: 10000, headers });
    
    // Only update cache on 200 response
    if (res.status === 200) {
      const etag = res.headers.etag;
      if (etag) await dbSet('basic_tokens', etagKey, etag, CACHE_EXPIRY);
      await dbSet('basic_tokens', bodyKey, res.data, CACHE_EXPIRY);
    }
    
    return res.data;
  } catch (e) {
    if (e.response?.status === 304) {
      console.log('📄 DexScreener data unchanged (304), using cached version');
      const cached = await dbGet('basic_tokens', bodyKey);
      if (cached) return cached;
    }
    throw e;
  }
}

// Fetch token metadata from Helius (uncached)
async function fetchTokenMetadata(tokenAddress) {
  try {
    const response = await heliusAPI.post('/token-metadata', {
      mintAccounts: [tokenAddress]
    }, {
      params: {
        'api-key': process.env.HELIUS_API_KEY
      }
    });
    
    return response.data?.[0] || null;
  } catch (error) {
    console.error(`❌ Error fetching metadata for ${tokenAddress}:`, error.response?.status, error.response?.statusText);
    return null;
  }
}

// Batch fetch token metadata from Helius
async function fetchTokenMetadataBatch(tokenAddresses) {
  if (tokenAddresses.length === 0) return [];
  
  try {
    const response = await heliusAPI.post('/token-metadata', {
      mintAccounts: tokenAddresses
    }, {
      params: {
        'api-key': process.env.HELIUS_API_KEY
      }
    });
    
    return response.data || [];
  } catch (error) {
    console.error(`❌ Error fetching batch metadata:`, error.response?.status, error.response?.statusText);
    return [];
  }
}

// Batch fetch token supply from Helius RPC
async function fetchTokenSupplyBatch(tokenAddresses) {
  if (tokenAddresses.length === 0) return [];
  
  // Use individual getTokenSupply calls with rate limiting
  const results = [];
  for (const address of tokenAddresses) {
    try {
      const result = await heliusLimiter.schedule(async () => {
        const response = await axios.post(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, {
          jsonrpc: '2.0',
          id: 'helius-supply',
          method: 'getTokenSupply',
          params: [address]
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });
        
        if (response.data?.error) {
          console.log(`⚠️  Supply RPC error for ${address}:`, response.data.error.message);
          return null;
        }
        
        return response.data?.result || null;
      });
      
      results.push(result);
    } catch (error) {
      console.error(`❌ Error fetching supply for ${address}:`, error.response?.status, error.response?.statusText);
      results.push(null);
    }
  }
  
  return results;
}

// Cached Helius metadata with stale-while-revalidate
async function getHeliusMetaCached(mint) {
  await ensureDB();
  await ensureRedis();
  
  const key = `solana:token:meta:${mint}`;
  const refreshingKey = `refreshing:meta:${mint}`;
  
  // Try to get cached data
  const hit = await dbGet('basic_tokens', key);
  
  // Check if we're already refreshing
  const isRefreshing = await redisExists(refreshingKey);
  
  if (hit && !isRefreshing) {
    // Return stale data and refresh in background
    setImmediate(async () => {
      try {
        await redisSet(refreshingKey, '1', 30); // 30s refresh lock
        const freshMeta = await fetchTokenMetadata(mint);
        if (freshMeta) {
          await dbSet('basic_tokens', key, freshMeta, METADATA_CACHE_EXPIRY);
        }
      } finally {
        await redisClient.del(refreshingKey);
      }
    });
    
    return hit;
  }
  
  // No cache or refreshing, fetch fresh
  const meta = await fetchTokenMetadata(mint);
  if (meta) await dbSet('basic_tokens', key, meta, METADATA_CACHE_EXPIRY);
  return meta;
}

// Fetch token data from DexScreener search API
async function fetchDexScreenerTokenData(tokenAddress) {
  try {
    const response = await dexGet(`${DEXSCREENER_SEARCH_API}${tokenAddress}`);
    
    // Find the Solana pair for this token
    const solanaPairs = response.data?.pairs?.filter(pair => 
      pair.chainId === 'solana' && 
      (pair.baseToken?.address === tokenAddress || pair.quoteToken?.address === tokenAddress)
    ) || [];
    
    if (solanaPairs.length === 0) {
      return null;
    }
    
    // Get the pair with highest liquidity or volume
    const bestPair = solanaPairs.reduce((best, current) => {
      const currentLiquidity = parseFloat(current.liquidity?.usd || 0);
      const bestLiquidity = parseFloat(best.liquidity?.usd || 0);
      return currentLiquidity > bestLiquidity ? current : best;
    });
    
    return bestPair;
  } catch (error) {
    console.error(`❌ Error fetching DexScreener data for ${tokenAddress}:`, error.response?.status, error.response?.statusText);
    return null;
  }
}

// Fetch token supply from Helius RPC
async function fetchTokenSupply(tokenAddress) {
  return heliusLimiter.schedule(async () => {
    try {
      const response = await axios.post(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, {
        jsonrpc: '2.0',
        id: 'helius-supply',
        method: 'getTokenSupply',
        params: [tokenAddress]
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000 // 10 second timeout
      });
      
      if (response.data?.error) {
        console.log(`⚠️  Supply RPC error for ${tokenAddress}:`, response.data.error.message);
        return null;
      }
      
      return response.data?.result || null;
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`⚠️  Token ${tokenAddress} supply not found (404)`);
      } else {
        console.error(`❌ Error fetching supply for ${tokenAddress}:`, error.response?.status, error.response?.statusText);
      }
      return null;
    }
  });
}

// Fetch token metadata from Helius (including mintable/freezable)
async function fetchTokenMetadata(tokenAddress) {
  return heliusLimiter.schedule(async () => {
    try {
      const response = await axios.post(`https://api.helius.xyz/v0/token-metadata?api-key=${process.env.HELIUS_API_KEY}`, {
        mintAccounts: [tokenAddress],
        includeOffChain: false,
        disableCache: false
      });
      
      if (response.data && response.data[0]) {
        const metadata = response.data[0];
        const freezeAuthority = metadata.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.freezeAuthority;
        const mintAuthority = metadata.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.mintAuthority;
        const isInitialized = metadata.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.isInitialized;
        
        return {
          mintable: mintAuthority && mintAuthority !== "" ? true : false, // If mint authority exists, it's mintable
          freezable: freezeAuthority && freezeAuthority !== "" ? true : false, // If freeze authority exists, it's freezable
          name: metadata.onChainMetadata?.metadata?.data?.name || metadata.legacyMetadata?.name,
          symbol: metadata.onChainMetadata?.metadata?.data?.symbol || metadata.legacyMetadata?.symbol
        };
      }
      
      return null;
    } catch (error) {
      console.log(`⚠️  Metadata error for ${tokenAddress}: ${error.message}`);
      return null;
    }
  });
}

// Note: Holder count functionality removed - focusing on reliable data sources

// Enrich a single token with DexScreener and Helius data
async function enrichToken(token) {
  console.log(`🔍 Enriching token: ${token.tokenAddress}`);
  
  try {
    // Fetch data from DexScreener and Helius in parallel
    const [dexData, supply, metadata] = await Promise.all([
      fetchDexScreenerTokenData(token.tokenAddress),
      fetchTokenSupply(token.tokenAddress),
      fetchTokenMetadata(token.tokenAddress)
    ]);
    
    // Extract token info from DexScreener pair data
    let name = 'Unknown';
    let ticker = 'N/A';
    let price = 0;
    let marketCap = 0;
    
    if (dexData) {
      // Check if our token is the base or quote token
      const isBaseToken = dexData.baseToken?.address === token.tokenAddress;
      const tokenInfo = isBaseToken ? dexData.baseToken : dexData.quoteToken;
      
      if (tokenInfo) {
        name = tokenInfo.name || 'Unknown';
        ticker = tokenInfo.symbol || 'N/A';
      }
      
      // Get price and market cap directly from DexScreener
      price = num(dexData.priceUsd);
      marketCap = num(dexData.marketCap);
    }
    
    // Use Helius metadata if DexScreener doesn't have name/ticker
    if (metadata && (name === 'Unknown' || ticker === 'N/A')) {
      name = metadata.name || name;
      ticker = metadata.symbol || ticker;
    }
    
    // Get total supply from Helius
    const totalSupply = supply?.value?.amount ? 
      parseInt(supply.value.amount) / Math.pow(10, supply.value.decimals || 9) : 0;
    
    // Extract required data with proper number normalization
    const enrichedToken = {
      // Original DexScreener data
      tokenAddress: token.tokenAddress,
      url: token.url,
      icon: token.icon,
      description: token.description,
      links: token.links,
      
      // DexScreener enriched data
      name: name,
      ticker: ticker,
      price: num(price),
      
      // Helius data
      totalSupply: num(totalSupply),
      decimals: supply?.value?.decimals || 9,
      mintable: metadata?.mintable || false,
      freezable: metadata?.freezable || false,
      
      // Calculated data
      marketCap: num(marketCap),
      
      // Processing info
      enrichedAt: new Date().toISOString(),
      success: !!(dexData || supply),
      hasDexData: !!dexData
    };
    
    console.log(`✅ Enriched: ${enrichedToken.name} (${enrichedToken.ticker})`);
    if (enrichedToken.hasDexData) {
      console.log(`   Price: $${enrichedToken.price} | MC: $${enrichedToken.marketCap.toLocaleString()} | Supply: ${enrichedToken.totalSupply.toLocaleString()}`);
      console.log(`   Mintable: ${enrichedToken.mintable ? 'Yes' : 'No'} | Freezable: ${enrichedToken.freezable ? 'Yes' : 'No'}`);
    }
    
    return enrichedToken;
    
  } catch (error) {
    console.error(`❌ Error enriching token ${token.tokenAddress}:`, error.message);
    
    // Return basic token with error flag - normalized numbers
    return {
      ...token,
      name: 'Error',
      ticker: 'ERR',
      price: num(0),
      totalSupply: num(0),
      marketCap: num(0),
      mintable: false,
      freezable: false,
      enrichedAt: new Date().toISOString(),
      success: false,
      hasDexData: false,
      error: error.message
    };
  }
}

// Optimized batch enrichment with early filtering
async function enrichTokensBatchOptimized(tokens, maxTokens = null) {
  const tokensToProcess = maxTokens ? tokens.slice(0, maxTokens) : tokens;
  const enrichedTokens = [];
  
  console.log(`🔄 Processing ${tokensToProcess.length} tokens with optimized batch processing...`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(tokensToProcess.length / BATCH_SIZE) * 2} seconds (batched API calls)`)
  
  // Process tokens in batches
  for (let i = 0; i < tokensToProcess.length; i += BATCH_SIZE) {
    const batch = tokensToProcess.slice(i, i + BATCH_SIZE);
    console.log(`\n📍 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(tokensToProcess.length / BATCH_SIZE)} (${batch.length} tokens)`);
    
    const batchResults = await processBatch(batch);
    enrichedTokens.push(...batchResults);
    
    // Early exit if we have enough tokens meeting criteria
    const validTokens = enrichedTokens.filter(token => 
      token.marketCap >= MIN_MARKET_CAP && 
      token.mintable === false && 
      token.freezable === false
    );
    
    if (validTokens.length >= MAX_TOKENS) {
      console.log(`🎯 Found ${validTokens.length} valid tokens, stopping early`);
      break;
    }
  }
  
  return enrichedTokens;
}

// Process a batch of tokens efficiently
async function processBatch(tokens) {
  const tokenAddresses = tokens.map(t => t.tokenAddress);
  
  try {
    // Fetch all data in parallel for the batch
    const [batchMetadata, batchSupply] = await Promise.all([
      fetchTokenMetadataBatch(tokenAddresses),
      fetchTokenSupplyBatch(tokenAddresses)
    ]);
    
    // Create lookup maps for quick access
    const metadataMap = new Map();
    batchMetadata.forEach((meta, index) => {
      if (meta) metadataMap.set(tokenAddresses[index], meta);
    });
    
    const supplyMap = new Map();
    batchSupply.forEach((supply, index) => {
      if (supply) supplyMap.set(tokenAddresses[index], supply);
    });
    
    // Process each token in the batch
    const batchResults = [];
    for (const token of tokens) {
      const enrichedToken = await enrichTokenWithData(token, metadataMap.get(token.tokenAddress), supplyMap.get(token.tokenAddress));
      batchResults.push(enrichedToken);
    }
    
    return batchResults;
    
  } catch (error) {
    console.error(`❌ Error processing batch:`, error.message);
    return tokens.map(token => ({
      ...token,
      name: 'Error',
      ticker: 'ERR',
      price: 0,
      totalSupply: 0,
      marketCap: 0,
      mintable: false,
      freezable: false,
      enrichedAt: new Date().toISOString(),
      success: false,
      hasDexData: false,
      error: error.message
    }));
  }
}

// Enrich a single token using pre-fetched data
async function enrichTokenWithData(token, metadata, supply) {
  try {
    // Fetch DexScreener data (this is still individual as it's search-based)
    const dexData = await fetchDexScreenerTokenData(token.tokenAddress);
    
    // Extract token info from DexScreener pair data
    let name = 'Unknown';
    let ticker = 'N/A';
    let price = 0;
    let marketCap = 0;
    
    if (dexData) {
      // Check if our token is the base or quote token
      const isBaseToken = dexData.baseToken?.address === token.tokenAddress;
      const tokenInfo = isBaseToken ? dexData.baseToken : dexData.quoteToken;
      
      if (tokenInfo) {
        name = tokenInfo.name || 'Unknown';
        ticker = tokenInfo.symbol || 'N/A';
      }
      
      // Get price and market cap directly from DexScreener
      price = num(dexData.priceUsd);
      marketCap = num(dexData.marketCap);
    }
    
    // Use Helius metadata if available
    if (metadata && (name === 'Unknown' || ticker === 'N/A')) {
      name = metadata.name || name;
      ticker = metadata.symbol || ticker;
    }
    
    // Get total supply from Helius
    const totalSupply = supply?.amount ? 
      parseInt(supply.amount) / Math.pow(10, supply.decimals || 9) : 0;
    
    // Extract mintable/freezable status from metadata
    const mintable = metadata?.mintable || false;
    const freezable = metadata?.freezable || false;
    
    // Early filtering - skip if doesn't meet criteria
    if (marketCap < MIN_MARKET_CAP || mintable || freezable) {
      return {
        ...token,
        name: name,
        ticker: ticker,
        price: num(price),
        totalSupply: num(totalSupply),
        decimals: supply?.decimals || 9,
        mintable: mintable,
        freezable: freezable,
        marketCap: num(marketCap),
        enrichedAt: new Date().toISOString(),
        success: !!(dexData || supply),
        hasDexData: !!dexData,
        filtered: true // Mark as filtered out
      };
    }
    
    const enrichedToken = {
      // Original DexScreener data
      tokenAddress: token.tokenAddress,
      url: token.url,
      icon: token.icon,
      description: token.description,
      links: token.links,
      
      // DexScreener enriched data
      name: name,
      ticker: ticker,
      price: num(price),
      
      // Helius data
      totalSupply: num(totalSupply),
      decimals: supply?.decimals || 9,
      mintable: mintable,
      freezable: freezable,
      
      // Calculated data
      marketCap: num(marketCap),
      
      // Processing info
      enrichedAt: new Date().toISOString(),
      success: !!(dexData || supply),
      hasDexData: !!dexData,
      filtered: false
    };
    
    console.log(`✅ Enriched: ${enrichedToken.name} (${enrichedToken.ticker}) - MC: $${enrichedToken.marketCap.toLocaleString()}`);
    
    return enrichedToken;
    
  } catch (error) {
    console.error(`❌ Error enriching token ${token.tokenAddress}:`, error.message);
    
    return {
      ...token,
      name: 'Error',
      ticker: 'ERR',
      price: num(0),
      totalSupply: num(0),
      marketCap: num(0),
      mintable: false,
      freezable: false,
      enrichedAt: new Date().toISOString(),
      success: false,
      hasDexData: false,
      error: error.message,
      filtered: true
    };
  }
}

async function fetchAndCacheSolanaTokens() {
  try {
    console.log('🔍 Fetching token profiles from DexScreener...');
    
    // Use ETag-based fetching
    const allTokens = await fetchDexLatest();
    console.log(`📊 Received ${allTokens.length} total tokens`);
    
    // Filter and dedupe Solana tokens
    const solanaTokens = Array.from(
      new Map(
        allTokens
          .filter(t => t.chainId === 'solana' && t.tokenAddress)
          .map(t => [t.tokenAddress, t])
      ).values()
    );
    
    console.log(`⚡ Found ${solanaTokens.length} Solana tokens`);
    
    if (solanaTokens.length === 0) {
      console.log('⚠️  No Solana tokens found in response');
      return;
    }
    
    // Ensure database connection
    await ensureDB();
    
    // Prepare cache data with metadata
    const cacheData = {
      timestamp: new Date().toISOString(),
      count: solanaTokens.length,
      tokens: solanaTokens.map(token => ({
        tokenAddress: token.tokenAddress,
        url: token.url,
        icon: token.icon,
        header: token.header,
        description: token.description,
        links: token.links || []
      }))
    };
    
    // Cache to SQLite with expiration
    await dbSet('basic_tokens', 'solana:tokens:latest', cacheData, CACHE_EXPIRY);
    
    // Clean up expired records
    await cleanupExpiredRecords();
    
    console.log(`✅ Cached ${solanaTokens.length} Solana tokens to SQLite`);
    console.log(`🕐 Cache expires in ${CACHE_EXPIRY} seconds`);
    
    // Log some sample tokens
    console.log('\n📋 Sample cached tokens:');
    solanaTokens.slice(0, 3).forEach((token, index) => {
      console.log(`${index + 1}. ${token.tokenAddress}`);
      console.log(`   Description: ${token.description?.substring(0, 80)}...`);
      console.log(`   Links: ${token.links?.length || 0}`);
    });
    
  } catch (error) {
    console.error('❌ Error fetching/caching tokens:', error.message);
    
    if (error.code === 'ENOENT') {
      console.error('💡 Make sure the database directory is writable');
    }
    
    if (error.response) {
      console.error(`🌐 API Error: ${error.response.status} - ${error.response.statusText}`);
    }
  }
}

// Fetch, enrich and cache tokens in one step
async function fetchEnrichAndCache(maxTokens = null) {
  try {
    console.log('🚀 Starting fetch, enrich and cache process...');
    
    // Use ETag-based fetching
    console.log('🔍 Fetching token profiles from DexScreener...');
    const allTokens = await fetchDexLatest();
    console.log(`📊 Received ${allTokens.length} total tokens`);
    
    // Filter and dedupe Solana tokens
    const solanaTokens = Array.from(
      new Map(
        allTokens
          .filter(t => t.chainId === 'solana' && t.tokenAddress)
          .map(t => [t.tokenAddress, t])
      ).values()
    );
    
    console.log(`⚡ Found ${solanaTokens.length} Solana tokens`);
    
    if (solanaTokens.length === 0) {
      console.log('⚠️  No Solana tokens found in response');
      return;
    }
    
    // Ensure database connection
    await ensureDB();
    
    // Cache basic tokens first
    const basicCacheData = {
      timestamp: new Date().toISOString(),
      count: solanaTokens.length,
      tokens: solanaTokens.map(token => ({
        tokenAddress: token.tokenAddress,
        url: token.url,
        icon: token.icon,
        header: token.header,
        description: token.description,
        links: token.links || []
      }))
    };
    
    await dbSet('basic_tokens', 'solana:tokens:latest', basicCacheData, CACHE_EXPIRY);
    
    console.log(`✅ Cached ${solanaTokens.length} basic Solana tokens to SQLite`);
    
    // Enrich tokens with DexScreener and Helius data
    if (process.env.HELIUS_API_KEY) {
      console.log('\n🔬 Starting optimized enrichment with DexScreener + Helius APIs...');
      const enrichedTokens = await enrichTokensBatchOptimized(basicCacheData.tokens, maxTokens);
      
      // Prepare enriched cache data
      const enrichedData = {
        timestamp: new Date().toISOString(),
        originalTimestamp: basicCacheData.timestamp,
        count: enrichedTokens.length,
        successCount: enrichedTokens.filter(t => t.success).length,
        tokens: enrichedTokens
      };
      
      // Filter tokens that meet all criteria and sort by market cap
      const filteredTokens = enrichedTokens
        .filter(token => !token.filtered) // Only include tokens that passed early filtering
        .sort((a, b) => b.marketCap - a.marketCap) // Sort by market cap descending
        .slice(0, MAX_TOKENS); // Take only top 50 tokens
      
      // Cache filtered tokens to SQLite
      const filteredData = {
        ...enrichedData,
        tokens: filteredTokens,
        totalTokens: filteredTokens.length,
        maxTokens: MAX_TOKENS,
        minMarketCap: MIN_MARKET_CAP,
        filteredAt: new Date().toISOString()
      };
      
      await dbSet('enriched_tokens', 'solana:tokens:enriched', filteredData, ENRICHED_CACHE_EXPIRY);
      
      // Clean up expired records
      await cleanupExpiredRecords();
      
      const processedCount = enrichedTokens.length;
      const validCount = enrichedTokens.filter(t => !t.filtered).length;
      const successCount = enrichedTokens.filter(t => t.success).length;
      
      console.log(`\n✅ Enriched and cached ${processedCount} tokens`);
      console.log(`📈 Success rate: ${successCount}/${processedCount} (${Math.round(successCount/processedCount*100)}%)`);
      console.log(`🎯 Valid tokens: ${validCount}/${processedCount} (MC >= $${MIN_MARKET_CAP.toLocaleString()}, not mintable, not freezable)`);
      console.log(`🏆 Final result: ${filteredTokens.length} tokens (max ${MAX_TOKENS})`);
      
      // Show sample filtered tokens
      const sampleTokens = filteredTokens
        .filter(t => t.success)
        .slice(0, 5);
      
      if (sampleTokens.length > 0) {
        console.log(`\n🏆 Sample filtered tokens (MC >= $${MIN_MARKET_CAP.toLocaleString()}, top ${MAX_TOKENS}):`);
        sampleTokens.forEach((token, index) => {
          console.log(`${index + 1}. ${token.name} (${token.ticker})`);
          console.log(`   Price: $${token.price} | MC: $${token.marketCap.toLocaleString()} | Supply: ${token.totalSupply.toLocaleString()}`);
          console.log(`   Mintable: ${token.mintable ? 'Yes' : 'No'} | Freezable: ${token.freezable ? 'Yes' : 'No'}`);
        });
      } else {
        console.log(`\n⚠️  No tokens found with MC >= $${MIN_MARKET_CAP.toLocaleString()}`);
      }
    } else {
      console.log('⚠️  HELIUS_API_KEY not found, skipping enrichment');
    }
    
  } catch (error) {
    console.error('❌ Error during fetch/enrich/cache:', error.message);
    
    if (error.code === 'ENOENT') {
      console.error('💡 Make sure the database directory is writable');
    }
    
    if (error.response) {
      console.error(`🌐 API Error: ${error.response.status} - ${error.response.statusText}`);
    }
  }
}

// Function to retrieve cached tokens
async function getCachedSolanaTokens() {
  try {
    await ensureDB();
    
    const cachedData = await dbGet('basic_tokens', 'solana:tokens:latest');
    
    if (!cachedData) {
      console.log('❌ No cached data found');
      return null;
    }
    
    console.log(`✅ Retrieved ${cachedData.count} cached Solana tokens`);
    console.log(`🕐 Cached at: ${cachedData.timestamp}`);
    
    return cachedData;
    
  } catch (error) {
    console.error('❌ Error retrieving cached tokens:', error.message);
    return null;
  }
}

// Get enriched tokens from cache
async function getEnrichedTokens() {
  try {
    await ensureDB();
    
    const enrichedData = await dbGet('enriched_tokens', 'solana:tokens:enriched');
    
    if (!enrichedData) {
      console.log('❌ No enriched data found');
      return null;
    }
    
    console.log(`✅ Retrieved ${enrichedData.count} enriched tokens`);
    console.log(`🕐 Enriched at: ${enrichedData.timestamp}`);
    console.log(`📈 Success rate: ${enrichedData.successCount}/${enrichedData.count}`);
    
    return enrichedData;
    
  } catch (error) {
    console.error('❌ Error retrieving enriched tokens:', error.message);
    return null;
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'fetch':
      await fetchAndCacheSolanaTokens();
      break;
      
    case 'enrich':
      const maxTokens = process.argv[3] ? parseInt(process.argv[3]) : null;
      await fetchEnrichAndCache(maxTokens);
      break;
      
    case 'test':
      console.log('🧪 Test mode: Processing first 3 tokens only');
      await fetchEnrichAndCache(3);
      break;
      
    case 'get':
      const cached = await getCachedSolanaTokens();
      if (cached) {
        console.log(JSON.stringify(cached, null, 2));
      }
      break;
      
    case 'enriched':
      const enriched = await getEnrichedTokens();
      if (enriched) {
        console.log(JSON.stringify(enriched, null, 2));
      }
      break;
      
    case 'list':
      const data = await getEnrichedTokens();
      if (data) {
        const tokens = data.tokens
          .filter(t => t.success)
          .sort((a, b) => b.marketCap - a.marketCap); // Sort by market cap
        
        console.log(`\n🏆 Top ${tokens.length} tokens by market cap (min $${MIN_MARKET_CAP.toLocaleString()}):`);
        tokens.forEach((token, index) => {
          console.log(`${index + 1}. ${token.name} (${token.ticker})`);
          console.log(`   Address: ${token.tokenAddress}`);
          console.log(`   Market Cap: $${token.marketCap?.toLocaleString() || '0'}`);
          console.log(`   Price: $${token.price || '0'}`);
          console.log(`   Supply: ${token.totalSupply?.toLocaleString() || '0'}`);
          console.log(`   Mintable: ${token.mintable ? 'Yes' : 'No'} | Freezable: ${token.freezable ? 'Yes' : 'No'}`);
        });
      }
      break;
      
    case 'cleanup':
      try {
        await ensureDB();
        await cleanupExpiredRecords();
        console.log('✅ Database cleanup completed');
      } catch (error) {
        console.error('❌ Error during cleanup:', error.message);
      }
      break;
      
    case 'stats':
      try {
        await ensureDB();
        const enrichedData = await dbGet('enriched_tokens', 'solana:tokens:enriched');
        
        if (enrichedData) {
          const totalProcessed = enrichedData.count;
          const validTokens = enrichedData.tokens.filter(t => !t.filtered);
          const successTokens = enrichedData.tokens.filter(t => t.success);
          
          console.log(`📊 Optimization Statistics:`);
          console.log(`   Total Processed: ${totalProcessed}`);
          console.log(`   Successful: ${successTokens.length} (${Math.round(successTokens.length/totalProcessed*100)}%)`);
          console.log(`   Valid (meets criteria): ${validTokens.length} (${Math.round(validTokens.length/totalProcessed*100)}%)`);
          console.log(`   Final Result: ${enrichedData.tokens.length} tokens`);
          console.log(`   Filtered Out: ${totalProcessed - validTokens.length} tokens`);
          
          if (validTokens.length > 0) {
            const avgMarketCap = validTokens.reduce((sum, t) => sum + t.marketCap, 0) / validTokens.length;
            console.log(`   Average Market Cap: $${avgMarketCap.toLocaleString()}`);
            console.log(`   Highest Market Cap: $${Math.max(...validTokens.map(t => t.marketCap)).toLocaleString()}`);
          }
        } else {
          console.log('❌ No enriched data found');
        }
      } catch (error) {
        console.error('❌ Error getting stats:', error.message);
      }
      break;
      
    case 'info':
      try {
        await ensureDB();
        const basicTtl = await dbTTL('basic_tokens', 'solana:tokens:latest');
        const basicExists = await dbExists('basic_tokens', 'solana:tokens:latest');
        const enrichedTtl = await dbTTL('enriched_tokens', 'solana:tokens:enriched');
        const enrichedExists = await dbExists('enriched_tokens', 'solana:tokens:enriched');
        
        console.log(`📊 Cache Status:`);
        console.log(`   Basic Cache: ${basicExists ? '✅ Yes' : '❌ No'}`);
        console.log(`   Basic TTL: ${basicTtl > 0 ? `${basicTtl} seconds` : 'No expiration'}`);
        console.log(`   Enriched Cache: ${enrichedExists ? '✅ Yes' : '❌ No'}`);
        console.log(`   Enriched TTL: ${enrichedTtl > 0 ? `${enrichedTtl} seconds` : 'No expiration'}`);
        
        if (basicExists) {
          const data = await dbGet('basic_tokens', 'solana:tokens:latest');
          console.log(`   Basic Count: ${data.count} tokens`);
          console.log(`   Basic Cached: ${data.timestamp}`);
        }
        
        if (enrichedExists) {
          const enrichedData = await dbGet('enriched_tokens', 'solana:tokens:enriched');
          console.log(`   Enriched Count: ${enrichedData.count} tokens`);
          console.log(`   Enriched Success: ${enrichedData.successCount}/${enrichedData.count}`);
          console.log(`   Enriched Cached: ${enrichedData.timestamp}`);
          console.log(`   Max Tokens: ${enrichedData.maxTokens || MAX_TOKENS}`);
          console.log(`   Min Market Cap: $${enrichedData.minMarketCap?.toLocaleString() || MIN_MARKET_CAP.toLocaleString()}`);
        }
        
      } catch (error) {
        console.error('❌ Error checking cache info:', error.message);
      }
      break;
      
    default:
      console.log(`
🚀 Solana Token Cache & Enrichment Manager

Usage:
  node cache-solana-tokens.js fetch         # Fetch and cache basic tokens only
  node cache-solana-tokens.js enrich [N]    # Fetch, enrich and cache tokens (optionally limit to N)
  node cache-solana-tokens.js test          # Test mode: fetch and enrich first 3 tokens
  node cache-solana-tokens.js get           # Retrieve basic cached tokens
  node cache-solana-tokens.js enriched      # Retrieve enriched cached tokens as JSON
  node cache-solana-tokens.js list          # List enriched tokens with names and tickers
  node cache-solana-tokens.js info          # Show cache status
  node cache-solana-tokens.js cleanup       # Remove expired records from database
  node cache-solana-tokens.js stats         # Show optimization statistics

Environment Variables:
  HELIUS_API_KEY=your_key     # Helius API key for enrichment

Cache Settings:
  Database: ${DB_PATH}
  Basic Expiry: ${CACHE_EXPIRY} seconds (${Math.floor(CACHE_EXPIRY/60)} minutes)
  Enriched Expiry: ${ENRICHED_CACHE_EXPIRY} seconds (${Math.floor(ENRICHED_CACHE_EXPIRY/60)} minutes)
  Max Tokens: ${MAX_TOKENS} (top by market cap)
  Min Market Cap: $${MIN_MARKET_CAP.toLocaleString()}
      `);
      break;
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  closeDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  closeDB();
  process.exit(0);
});

// Export functions for use in other modules
module.exports = {
  fetchAndCacheSolanaTokens,
  fetchEnrichAndCache,
  getCachedSolanaTokens,
  getEnrichedTokens,
  cleanupExpiredRecords,
  enrichTokensBatchOptimized,
  CACHE_EXPIRY,
  ENRICHED_CACHE_EXPIRY,
  METADATA_CACHE_EXPIRY,
  MAX_TOKENS,
  MIN_MARKET_CAP,
  BATCH_SIZE
};

// Run if called directly
if (require.main === module) {
  main();
}