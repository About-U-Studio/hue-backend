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
 * Basic XSS protection - removes script tags and common XSS patterns
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
export function sanitizeString(str) {
  if (!str || typeof str !== 'string') return '';
  
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
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
