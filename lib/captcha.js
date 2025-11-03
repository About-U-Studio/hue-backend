/**
 * Verify Cloudflare Turnstile CAPTCHA token
 * @param {string} token - CAPTCHA token from frontend
 * @returns {Promise<boolean>} - True if valid, false if invalid
 */
export async function verifyCaptcha(token) {
  if (!token) {
    return false;
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  
  if (!secretKey) {
    console.error('TURNSTILE_SECRET_KEY not set in environment variables');
    return false;
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
    });

    const data = await response.json();
    
    // Turnstile returns { success: true } if valid
    return data.success === true;
  } catch (error) {
    console.error('CAPTCHA verification error:', error);
    return false;
  }
}
