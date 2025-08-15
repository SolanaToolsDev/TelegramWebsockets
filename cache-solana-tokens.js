require('dotenv').config();
const redis = require('redis');
const axios = require('axios');

// Configuration
const DEXSCREENER_API = 'https://api.dexscreener.com/token-profiles/latest/v1';
const HELIUS_BASE_URL = 'https://api.helius.xyz/v0';
const REDIS_KEY = 'solana:tokens:latest';
const REDIS_ENRICHED_KEY = 'solana:tokens:enriched';
const CACHE_EXPIRY = 300; // 5 minutes in seconds
const ENRICHED_CACHE_EXPIRY = 600; // 10 minutes

// Rate limiting for Helius API
const RATE_LIMIT_DELAY = 200; // 200ms between requests
const MAX_CONCURRENT = 5; // Can handle more concurrent requests

// Initialize Redis client
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
});

// Error handling for Redis
redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('🔗 Connected to Redis');
});

// Helius API client
const heliusAPI = axios.create({
  baseURL: HELIUS_BASE_URL,
  headers: {
    'User-Agent': 'SolTools-Bot/1.0'
  },
  timeout: 10000
});

// Sleep function for rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch token metadata from Helius
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

// Enrich a single token with Helius data
async function enrichToken(token) {
  console.log(`🔍 Enriching token: ${token.tokenAddress}`);
  
  try {
    // Fetch only metadata (name and ticker)
    const metadata = await fetchTokenMetadata(token.tokenAddress);
    
    // Extract required data
    const enrichedToken = {
      // Original DexScreener data
      tokenAddress: token.tokenAddress,
      url: token.url,
      icon: token.icon,
      description: token.description,
      links: token.links,
      
      // Helius enriched data (name and ticker only)
      name: metadata?.onChainMetadata?.metadata?.data?.name || 
            metadata?.legacyMetadata?.name || 'Unknown',
      ticker: metadata?.onChainMetadata?.metadata?.data?.symbol || 
              metadata?.legacyMetadata?.symbol || 'N/A',
      
      // Processing info
      enrichedAt: new Date().toISOString(),
      success: !!metadata
    };
    
    console.log(`✅ Enriched: ${enrichedToken.name} (${enrichedToken.ticker})`);
    
    return enrichedToken;
    
  } catch (error) {
    console.error(`❌ Error enriching token ${token.tokenAddress}:`, error.message);
    
    // Return basic token with error flag
    return {
      ...token,
      name: 'Error',
      ticker: 'ERR',
      enrichedAt: new Date().toISOString(),
      success: false,
      error: error.message
    };
  }
}

// Process tokens in batches
async function enrichTokensBatch(tokens, batchSize = MAX_CONCURRENT, maxTokens = null) {
  const tokensToProcess = maxTokens ? tokens.slice(0, maxTokens) : tokens;
  const enrichedTokens = [];
  
  console.log(`🔄 Processing ${tokensToProcess.length} tokens in batches of ${batchSize}...`);
  console.log(`⏱️  Estimated time: ${Math.ceil(tokensToProcess.length / batchSize * RATE_LIMIT_DELAY / 1000)} seconds`);
  
  for (let i = 0; i < tokensToProcess.length; i += batchSize) {
    const batch = tokensToProcess.slice(i, i + batchSize);
    console.log(`\n📦 Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(tokensToProcess.length/batchSize)} (${batch.length} tokens)`);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (token, index) => {
      // Small stagger to avoid overwhelming the API
      await sleep(index * 50);
      return enrichToken(token);
    });
    
    const batchResults = await Promise.all(batchPromises);
    enrichedTokens.push(...batchResults);
    
    // Rate limit between batches
    if (i + batchSize < tokensToProcess.length) {
      console.log(`⏳ Waiting ${RATE_LIMIT_DELAY}ms before next batch...`);
      await sleep(RATE_LIMIT_DELAY);
    }
  }
  
  return enrichedTokens;
}

async function fetchAndCacheSolanaTokens() {
  try {
    console.log('🔍 Fetching token profiles from DexScreener...');
    
    // Fetch data from DexScreener API
    const response = await axios.get(DEXSCREENER_API, {
      timeout: 10000,
      headers: {
        'User-Agent': 'SolTools-Bot/1.0'
      }
    });
    
    const allTokens = response.data;
    console.log(`📊 Received ${allTokens.length} total tokens`);
    
    // Filter for Solana tokens only
    const solanaTokens = allTokens.filter(token => 
      token.chainId === 'solana'
    );
    
    console.log(`⚡ Found ${solanaTokens.length} Solana tokens`);
    
    if (solanaTokens.length === 0) {
      console.log('⚠️  No Solana tokens found in response');
      return;
    }
    
    // Connect to Redis
    await redisClient.connect();
    
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
    
    // Cache to Redis with expiration
    await redisClient.setEx(
      REDIS_KEY, 
      CACHE_EXPIRY, 
      JSON.stringify(cacheData)
    );
    
    console.log(`✅ Cached ${solanaTokens.length} Solana tokens to Redis`);
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
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Make sure Redis is running: sudo systemctl start redis');
    }
    
    if (error.response) {
      console.error(`🌐 API Error: ${error.response.status} - ${error.response.statusText}`);
    }
    
  } finally {
    // Close Redis connection
    if (redisClient.isOpen) {
      await redisClient.quit();
      console.log('🔌 Redis connection closed');
    }
  }
}

// Fetch, enrich and cache tokens in one step
async function fetchEnrichAndCache(maxTokens = null) {
  try {
    console.log('🚀 Starting fetch, enrich and cache process...');
    
    // Fetch data from DexScreener API
    console.log('🔍 Fetching token profiles from DexScreener...');
    const response = await axios.get(DEXSCREENER_API, {
      timeout: 10000,
      headers: {
        'User-Agent': 'SolTools-Bot/1.0'
      }
    });
    
    const allTokens = response.data;
    console.log(`📊 Received ${allTokens.length} total tokens`);
    
    // Filter for Solana tokens only
    const solanaTokens = allTokens.filter(token => 
      token.chainId === 'solana'
    );
    
    console.log(`⚡ Found ${solanaTokens.length} Solana tokens`);
    
    if (solanaTokens.length === 0) {
      console.log('⚠️  No Solana tokens found in response');
      return;
    }
    
    // Connect to Redis
    await redisClient.connect();
    
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
    
    await redisClient.setEx(
      REDIS_KEY, 
      CACHE_EXPIRY, 
      JSON.stringify(basicCacheData)
    );
    
    console.log(`✅ Cached ${solanaTokens.length} basic Solana tokens to Redis`);
    
    // Enrich tokens with Helius data
    if (process.env.HELIUS_API_KEY) {
      console.log('\n🔬 Starting enrichment with Helius API...');
      const enrichedTokens = await enrichTokensBatch(basicCacheData.tokens, MAX_CONCURRENT, maxTokens);
      
      // Prepare enriched cache data
      const enrichedData = {
        timestamp: new Date().toISOString(),
        originalTimestamp: basicCacheData.timestamp,
        count: enrichedTokens.length,
        successCount: enrichedTokens.filter(t => t.success).length,
        tokens: enrichedTokens
      };
      
      // Cache enriched data
      await redisClient.setEx(
        REDIS_ENRICHED_KEY,
        ENRICHED_CACHE_EXPIRY,
        JSON.stringify(enrichedData)
      );
      
      console.log(`\n✅ Enriched and cached ${enrichedTokens.length} tokens`);
      console.log(`📈 Success rate: ${enrichedData.successCount}/${enrichedTokens.length} (${Math.round(enrichedData.successCount/enrichedTokens.length*100)}%)`);
      
      // Show sample enriched tokens
      const sampleTokens = enrichedTokens
        .filter(t => t.success)
        .slice(0, 5);
      
      if (sampleTokens.length > 0) {
        console.log('\n🏆 Sample enriched tokens:');
        sampleTokens.forEach((token, index) => {
          console.log(`${index + 1}. ${token.name} (${token.ticker})`);
        });
      }
    } else {
      console.log('⚠️  HELIUS_API_KEY not found, skipping enrichment');
    }
    
  } catch (error) {
    console.error('❌ Error during fetch/enrich/cache:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Make sure Redis is running: sudo systemctl start redis');
    }
    
    if (error.response) {
      console.error(`🌐 API Error: ${error.response.status} - ${error.response.statusText}`);
    }
    
  } finally {
    // Close Redis connection
    if (redisClient.isOpen) {
      await redisClient.quit();
      console.log('🔌 Redis connection closed');
    }
  }
}

// Function to retrieve cached tokens
async function getCachedSolanaTokens() {
  try {
    await redisClient.connect();
    
    const cachedData = await redisClient.get(REDIS_KEY);
    
    if (!cachedData) {
      console.log('❌ No cached data found');
      return null;
    }
    
    const data = JSON.parse(cachedData);
    console.log(`✅ Retrieved ${data.count} cached Solana tokens`);
    console.log(`🕐 Cached at: ${data.timestamp}`);
    
    return data;
    
  } catch (error) {
    console.error('❌ Error retrieving cached tokens:', error.message);
    return null;
    
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  }
}

// Get enriched tokens from cache
async function getEnrichedTokens() {
  try {
    await redisClient.connect();
    
    const enrichedData = await redisClient.get(REDIS_ENRICHED_KEY);
    
    if (!enrichedData) {
      console.log('❌ No enriched data found');
      return null;
    }
    
    const data = JSON.parse(enrichedData);
    console.log(`✅ Retrieved ${data.count} enriched tokens`);
    console.log(`🕐 Enriched at: ${data.timestamp}`);
    console.log(`📈 Success rate: ${data.successCount}/${data.count}`);
    
    return data;
    
  } catch (error) {
    console.error('❌ Error retrieving enriched tokens:', error.message);
    return null;
    
  } finally {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
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
        const tokens = data.tokens.filter(t => t.success);
        console.log('\n🏆 Enriched tokens:');
        tokens.forEach((token, index) => {
          console.log(`${index + 1}. ${token.name} (${token.ticker})`);
          console.log(`   Address: ${token.tokenAddress}`);
        });
      }
      break;
      
    case 'info':
      try {
        await redisClient.connect();
        const ttl = await redisClient.ttl(REDIS_KEY);
        const exists = await redisClient.exists(REDIS_KEY);
        const enrichedTtl = await redisClient.ttl(REDIS_ENRICHED_KEY);
        const enrichedExists = await redisClient.exists(REDIS_ENRICHED_KEY);
        
        console.log(`📊 Cache Status:`);
        console.log(`   Basic Cache: ${exists ? '✅ Yes' : '❌ No'}`);
        console.log(`   Basic TTL: ${ttl > 0 ? `${ttl} seconds` : 'No expiration'}`);
        console.log(`   Enriched Cache: ${enrichedExists ? '✅ Yes' : '❌ No'}`);
        console.log(`   Enriched TTL: ${enrichedTtl > 0 ? `${enrichedTtl} seconds` : 'No expiration'}`);
        
        if (exists) {
          const data = JSON.parse(await redisClient.get(REDIS_KEY));
          console.log(`   Basic Count: ${data.count} tokens`);
          console.log(`   Basic Cached: ${data.timestamp}`);
        }
        
        if (enrichedExists) {
          const enrichedData = JSON.parse(await redisClient.get(REDIS_ENRICHED_KEY));
          console.log(`   Enriched Count: ${enrichedData.count} tokens`);
          console.log(`   Enriched Success: ${enrichedData.successCount}/${enrichedData.count}`);
          console.log(`   Enriched Cached: ${enrichedData.timestamp}`);
        }
        
      } catch (error) {
        console.error('❌ Error checking cache info:', error.message);
      } finally {
        if (redisClient.isOpen) {
          await redisClient.quit();
        }
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

Environment Variables:
  REDIS_HOST=localhost        # Redis host
  REDIS_PORT=6379             # Redis port  
  REDIS_PASSWORD=             # Redis password (optional)
  HELIUS_API_KEY=your_key     # Helius API key for enrichment

Cache Settings:
  Basic Key: ${REDIS_KEY}
  Basic Expiry: ${CACHE_EXPIRY} seconds (${Math.floor(CACHE_EXPIRY/60)} minutes)
  Enriched Key: ${REDIS_ENRICHED_KEY}
  Enriched Expiry: ${ENRICHED_CACHE_EXPIRY} seconds (${Math.floor(ENRICHED_CACHE_EXPIRY/60)} minutes)
      `);
      break;
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
  process.exit(0);
});

// Export functions for use in other modules
module.exports = {
  fetchAndCacheSolanaTokens,
  fetchEnrichAndCache,
  getCachedSolanaTokens,
  getEnrichedTokens,
  REDIS_KEY,
  REDIS_ENRICHED_KEY,
  CACHE_EXPIRY,
  ENRICHED_CACHE_EXPIRY
};

// Run if called directly
if (require.main === module) {
  main();
}