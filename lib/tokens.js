import crypto from 'crypto';

/**
 * Generate a secure random token for email verification
 * @returns {string} - Random token
 */
export function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate token expiration date (24 hours from now)
 * @returns {Date} - Expiration date
 */
export function getTokenExpiration() {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours from now
  return expiresAt;
}


