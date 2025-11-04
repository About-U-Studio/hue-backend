/**
 * Security Headers Middleware
 * Adds important security headers to API responses
 * This helps protect against common web vulnerabilities
 */

/**
 * Apply security headers to response
 * @param {object} res - Response object
 */
export function applySecurityHeaders(res) {
  // Prevent clickjacking attacks
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection (legacy, but still useful)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy - control how much referrer information is sent
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy - restrict browser features
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );
  
  // Content Security Policy - restrict what resources can be loaded
  // This is a basic CSP - you can customize it based on your needs
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com", // Allow Cloudflare Turnstile
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.openai.com https://*.supabase.co https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com", // Allow Cloudflare Turnstile
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  
  res.setHeader('Content-Security-Policy', csp);
  
  // Strict Transport Security (HSTS) - only add this if you're using HTTPS
  // Uncomment when deploying to production with HTTPS
  // res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
}

/**
 * Middleware function to apply security headers
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {function} next - Next function (optional)
 */
export function securityHeadersMiddleware(req, res, next) {
  applySecurityHeaders(res);
  if (next) next();
}
