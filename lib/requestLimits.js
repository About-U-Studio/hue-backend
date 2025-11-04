/**
 * Request Size Limits and Validation
 * Prevents oversized requests and potential DoS attacks
 */

// Maximum request body size (in bytes)
// 1MB = 1,024,000 bytes
// 5MB = 5,120,000 bytes (for images)
const MAX_REQUEST_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_JSON_SIZE = 1024 * 1024; // 1MB for JSON payloads

/**
 * Check if request body size is within limits
 * @param {object} req - Request object
 * @returns {{valid: boolean, error?: string, size?: number}} - Validation result
 */
export function validateRequestSize(req) {
  const contentLength = req.headers['content-length'];
  
  if (!contentLength) {
    // Content-Length header might not be present for chunked requests
    // This is okay, but we should still validate the actual body size
    return { valid: true };
  }
  
  const size = parseInt(contentLength, 10);
  
  if (isNaN(size)) {
    return { valid: false, error: 'Invalid Content-Length header' };
  }
  
  // For JSON requests, use smaller limit
  const contentType = req.headers['content-type'] || '';
  const isJson = contentType.includes('application/json');
  const maxSize = isJson ? MAX_JSON_SIZE : MAX_REQUEST_SIZE;
  
  if (size > maxSize) {
    return {
      valid: false,
      error: `Request body too large. Maximum size: ${Math.round(maxSize / 1024)}KB`,
      size
    };
  }
  
  return { valid: true, size };
}

/**
 * Middleware to check request size before processing
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @param {number} maxSize - Maximum size in bytes (optional, uses default if not provided)
 * @returns {boolean} - True if request should be rejected (response already sent)
 */
export function checkRequestSize(req, res, maxSize = null) {
  const sizeCheck = validateRequestSize(req);
  
  if (!sizeCheck.valid) {
    res.status(413).json({
      error: 'Payload Too Large',
      message: sizeCheck.error || 'Request body exceeds maximum size',
    });
    return true; // Request rejected
  }
  
  return false; // Request OK
}

