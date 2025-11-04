/**
 * Rate limiting utility for API endpoints
 * Uses in-memory store (for serverless, consider Redis or Upstash for production)
 */

// In-memory rate limit store
// In production, use Redis or Upstash for distributed rate limiting
const rateLimitStore = new Map();

/**
 * Rate limit configuration
 */
const RATE_LIMITS = {
  registration: {
    requests: 100,    // 100 registrations/login attempts (INCREASED FOR TESTING)
    window: 60 * 60 * 1000, // per hour (1 hour in milliseconds)
  },
  checkEmail: {
    requests: 100,    // 100 email checks (INCREASED FOR TESTING)
    window: 60 * 60 * 1000, // per hour
  },
  chat: {
    requests: 200,     // 200 messages
    window: 60 * 60 * 1000, // per hour (in addition to daily limit)
  },
  submitReview: {
    requests: 50,     // 50 reviews (INCREASED FOR TESTING)
    window: 60 * 60 * 1000, // per hour
  },
  reviewPerUser: {
    requests: 3,      // 3 reviews per user
    window: 24 * 60 * 60 * 1000, // per day
  },
};

/**
 * Get client IP address from request
 * @param {object} req - Request object
 * @returns {string} - IP address
 */
export function getClientIP(req) {
  // Check various headers for IP (Vercel, Cloudflare, etc.)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }
  
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Clean up old entries from rate limit store
 * Removes entries older than 24 hours to prevent memory leaks
 */
function cleanupRateLimitStore() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [key, data] of rateLimitStore.entries()) {
    const oldestTimestamp = Math.min(...data.timestamps);
    if (now - oldestTimestamp > maxAge) {
      rateLimitStore.delete(key);
    }
  }
}

// Clean up every hour
setInterval(cleanupRateLimitStore, 60 * 60 * 1000);

/**
 * Check if request should be rate limited
 * @param {string} identifier - IP address or user identifier
 * @param {string} type - Rate limit type (registration, checkEmail, chat, submitReview, reviewPerUser)
 * @returns {{allowed: boolean, remaining: number, resetAt: number}} - Rate limit result
 */
export function checkRateLimit(identifier, type) {
  // DISABLE RATE LIMITING FOR TESTING (set DISABLE_RATE_LIMIT=true in Vercel env vars)
  const disableRateLimit = process.env.DISABLE_RATE_LIMIT?.toLowerCase().trim();
  if (disableRateLimit === 'true' || disableRateLimit === '1' || disableRateLimit === 'yes') {
    console.log('[RATE_LIMIT] Rate limiting DISABLED via DISABLE_RATE_LIMIT env var');
    return { allowed: true, remaining: Infinity, resetAt: Date.now() + 3600000 };
  }
  
  // Log if we're checking (for debugging)
  console.log('[RATE_LIMIT] Checking rate limit:', { 
    type, 
    identifier, 
    disableRateLimit: process.env.DISABLE_RATE_LIMIT 
  });

  const config = RATE_LIMITS[type];
  
  if (!config) {
    // If no config for type, allow request
    return { allowed: true, remaining: Infinity, resetAt: Date.now() + config?.window };
  }
  
  const key = `${type}:${identifier}`;
  const now = Date.now();
  
  // Get or create rate limit entry
  let entry = rateLimitStore.get(key);
  
  if (!entry || now - entry.windowStart > config.window) {
    // New window or first request
    entry = {
      timestamps: [now],
      windowStart: now,
    };
  } else {
    // Existing window - filter out old timestamps
    entry.timestamps = entry.timestamps.filter(ts => now - ts < config.window);
  }
  
  // Check if limit exceeded
  const count = entry.timestamps.length;
  const allowed = count < config.requests;
  
  if (allowed) {
    // Add current timestamp
    entry.timestamps.push(now);
  }
  
  // Update store
  rateLimitStore.set(key, entry);
  
  const remaining = Math.max(0, config.requests - count);
  const resetAt = entry.windowStart + config.window;
  
  return {
    allowed,
    remaining,
    resetAt,
  };
}

/**
 * Clear rate limit store (useful for testing)
 * Call this function to reset all rate limits
 */
export function clearRateLimitStore() {
  rateLimitStore.clear();
  console.log('Rate limit store cleared');
}

/**
 * Middleware function for rate limiting API endpoints
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {string} type - Rate limit type
 * @param {string} identifier - Optional custom identifier (defaults to IP)
 * @returns {boolean} - True if rate limited (response already sent)
 */
export function rateLimitMiddleware(req, res, type, identifier = null) {
  const id = identifier || getClientIP(req);
  const result = checkRateLimit(id, type);
  
  if (!result.allowed) {
    const secondsUntilReset = Math.ceil((result.resetAt - Date.now()) / 1000);
    
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Too many requests. Please try again in ${secondsUntilReset} seconds.`,
      retryAfter: secondsUntilReset,
    });
    
    return true; // Rate limited, response sent
  }
  
  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', RATE_LIMITS[type].requests);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());
  
  return false; // Not rate limited
}

