import crypto from 'crypto';

/**
 * Generate a secure authentication token
 * @returns {string} - Random token
 */
export function generateAuthToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Get token expiration date (30 days from now)
 * @returns {Date} - Expiration date
 */
export function getAuthTokenExpiration() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now
  return expiresAt;
}

/**
 * Verify if token is expired
 * @param {Date} expiresAt - Expiration date
 * @returns {boolean} - True if expired
 */
export function isTokenExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date() > new Date(expiresAt);
}

/**
 * Verify authentication token and return user
 * @param {string} token - Auth token
 * @param {object} supabaseClient - Supabase client
 * @returns {Promise<object|null>} - User object if valid, null if invalid
 */
export async function verifyAuthToken(token, supabaseClient) {
  if (!token) {
    return null;
  }

  try {
    // Find user with matching token
    const { data: user, error } = await supabaseClient
      .from('users')
      .select('id, email, email_verified, auth_token, auth_token_expires_at')
      .eq('auth_token', token)
      .single();

    if (error || !user) {
      return null;
    }

    // Check if token expired
    if (isTokenExpired(user.auth_token_expires_at)) {
      return null;
    }

    // Return user (without sensitive data)
    return {
      id: user.id,
      email: user.email,
      email_verified: user.email_verified,
    };
  } catch (error) {
    console.error('Auth verification error:', error);
    return null;
  }
}
