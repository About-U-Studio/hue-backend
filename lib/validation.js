/**
 * Input validation utilities for API endpoints
 */

// Email format validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid email format
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Validate name (alphanumeric, spaces, hyphens, apostrophes)
 * @param {string} name - Name to validate
 * @param {number} maxLength - Maximum length (default: 100)
 * @returns {boolean} - True if valid name format
 */
export function isValidName(name, maxLength = 100) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return false;
  // Allow letters, numbers, spaces, hyphens, apostrophes, and international characters
  return /^[\p{L}\p{N}\s'-]+$/u.test(trimmed);
}

/**
 * Validate message content
 * @param {string} message - Message to validate
 * @param {number} maxLength - Maximum length (default: 5000)
 * @param {number} minLength - Minimum length (default: 1)
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateMessage(message, maxLength = 5000, minLength = 1) {
  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'Message is required' };
  }
  
  const trimmed = message.trim();
  
  if (trimmed.length < minLength) {
    return { valid: false, error: `Message must be at least ${minLength} character(s)` };
  }
  
  if (trimmed.length > maxLength) {
    return { valid: false, error: `Message must not exceed ${maxLength} characters` };
  }
  
  return { valid: true };
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid URL format
 */
export function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sanitize string by removing potentially dangerous characters
 * Enhanced XSS protection - removes script tags, event handlers, and common XSS patterns
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
export function sanitizeString(str) {
  if (!str || typeof str !== 'string') return '';
  
  let sanitized = str;
  
  // Remove script tags (including nested ones)
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove style tags (can contain malicious CSS)
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');
  
  // Remove event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  
  // Remove iframe tags
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  
  // Remove object and embed tags
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');
  
  // Remove data: URLs that aren't images (potential XSS vectors)
  // Allow data:image/* but remove other data: URLs
  sanitized = sanitized.replace(/data:(?!image\/)[^;]*;base64,[^'")\s]+/gi, '');
  
  // Remove vbscript: protocol
  sanitized = sanitized.replace(/vbscript:/gi, '');
  
  // Remove expression() in CSS (IE vulnerability)
  sanitized = sanitized.replace(/expression\s*\(/gi, '');
  
  return sanitized.trim();
}

/**
 * Sanitize message content for storage and display
 * More aggressive sanitization for user-generated content
 * @param {string} message - Message to sanitize
 * @returns {string} - Sanitized message
 */
export function sanitizeMessage(message) {
  if (!message || typeof message !== 'string') return '';
  
  // First, apply basic sanitization
  let sanitized = sanitizeString(message);
  
  // Remove any remaining HTML tags (allow only basic formatting if needed)
  // For now, we'll strip all HTML tags for security
  // If you need formatting, use a markdown parser instead
  sanitized = sanitized.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities to prevent double encoding attacks
  sanitized = sanitized
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
  
  // Re-apply sanitization after decoding
  sanitized = sanitizeString(sanitized);
  
  return sanitized.trim();
}

/**
 * Validate request body has required fields
 * @param {object} body - Request body
 * @param {string[]} requiredFields - Array of required field names
 * @returns {{valid: boolean, missing?: string[]}} - Validation result
 */
export function validateRequiredFields(body, requiredFields) {
  const missing = requiredFields.filter(field => !body || body[field] === undefined || body[field] === null || body[field] === '');
  
  if (missing.length > 0) {
    return { valid: false, missing };
  }
  
  return { valid: true };
}
