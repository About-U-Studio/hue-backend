import bcrypt from 'bcryptjs';

/**
 * Password validation and hashing utilities
 * Securely handles password creation and verification
 */

// Password strength requirements
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REQUIRE_UPPERCASE = true;
const PASSWORD_REQUIRE_LOWERCASE = true;
const PASSWORD_REQUIRE_NUMBER = true;
const PASSWORD_REQUIRE_SPECIAL = false; // Optional, set to true if you want special chars required

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }

  const trimmed = password.trim();

  // Check minimum length
  if (trimmed.length < PASSWORD_MIN_LENGTH) {
    return { 
      valid: false, 
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long` 
    };
  }

  // Check for uppercase letter
  if (PASSWORD_REQUIRE_UPPERCASE && !/[A-Z]/.test(trimmed)) {
    return { 
      valid: false, 
      error: 'Password must contain at least one uppercase letter' 
    };
  }

  // Check for lowercase letter
  if (PASSWORD_REQUIRE_LOWERCASE && !/[a-z]/.test(trimmed)) {
    return { 
      valid: false, 
      error: 'Password must contain at least one lowercase letter' 
    };
  }

  // Check for number
  if (PASSWORD_REQUIRE_NUMBER && !/[0-9]/.test(trimmed)) {
    return { 
      valid: false, 
      error: 'Password must contain at least one number' 
    };
  }

  // Check for special character (optional)
  if (PASSWORD_REQUIRE_SPECIAL && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(trimmed)) {
    return { 
      valid: false, 
      error: 'Password must contain at least one special character' 
    };
  }

  return { valid: true };
}

/**
 * Hash a password securely using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 */
export async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password is required');
  }

  // Use bcrypt with salt rounds (10 is a good balance of security and performance)
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password.trim(), saltRounds);
  return hashedPassword;
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password from database
 * @returns {Promise<boolean>} - True if password matches
 */
export async function verifyPassword(password, hash) {
  if (!password || !hash) {
    return false;
  }

  try {
    const matches = await bcrypt.compare(password.trim(), hash);
    return matches;
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

/**
 * Check if passwords match (for confirmation field)
 * @param {string} password - Original password
 * @param {string} confirmPassword - Confirmation password
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function passwordsMatch(password, confirmPassword) {
  if (!password || !confirmPassword) {
    return { valid: false, error: 'Both password fields are required' };
  }

  if (password.trim() !== confirmPassword.trim()) {
    return { valid: false, error: 'Passwords do not match' };
  }

  return { valid: true };
}
