import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { isValidEmail, sanitizeString } from '../../lib/validation';
import { applySecurityHeaders } from '../../lib/securityHeaders';

/**
 * Reset Password Page Handler
 * Shows a form to reset password when user clicks reset link from email
 */
export default async function handler(req, res) {
  applySecurityHeaders(res);
  
  if (applyCors(req, res)) return;
  
  // Support both GET (for showing form) and POST (for processing)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  
  // Handle GET - show reset password form
  if (req.method === 'GET') {
    try {
      // Extract token and email from query parameters
      let token = null;
      let email = null;
      
      // Try new format (single 'data' parameter with base64 encoded JSON)
      if (req.query.data) {
        try {
          const dataRaw = Array.isArray(req.query.data) ? req.query.data[0] : req.query.data;
          const decodedData = Buffer.from(dataRaw, 'base64').toString('utf-8');
          const data = JSON.parse(decodedData);
          token = data.token;
          email = data.email;
        } catch (e) {
          console.error('Failed to decode data parameter:', e);
        }
      }
      
      // Fallback to old format (separate token and email parameters)
      if (!token || !email) {
        const tokenRaw = req.query.token || req.query.t;
        const emailRaw = req.query.email || req.query.e;
        
        if (tokenRaw) {
          const rawValue = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw;
          token = decodeURIComponent(rawValue);
        }
        
        if (emailRaw) {
          const rawValue = Array.isArray(emailRaw) ? emailRaw[0] : emailRaw;
          email = decodeURIComponent(rawValue);
        }
      }
      
      if (!token || !email) {
        // Redirect to frontend with error parameter
        const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://aboutu-studio.framer.website';
        const redirectUrl = `${frontendUrl}?resetPassword=invalid`;
        console.log('🔐 Missing reset parameters, redirecting:', redirectUrl);
        
        return res.status(200).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Redirecting...</title>
              <script>
                window.location.href = ${JSON.stringify(redirectUrl)};
              </script>
            </head>
            <body>
              <p>Redirecting...</p>
            </body>
          </html>
        `);
      }
      
      // Verify token is valid (don't reveal if email exists)
      const normalizedEmail = email.toLowerCase().trim();
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('id, password_reset_token, password_reset_token_expires_at')
        .ilike('email', normalizedEmail)
        .single();
      
      if (!user || !user.password_reset_token || user.password_reset_token.trim() !== token.trim()) {
        // Redirect to frontend with error parameter
        const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://aboutu-studio.framer.website';
        const redirectUrl = `${frontendUrl}?resetPassword=invalid`;
        console.log('🔐 Invalid reset token, redirecting:', redirectUrl);
        
        return res.status(200).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Redirecting...</title>
              <script>
                // Store error in sessionStorage as backup
                try {
                  sessionStorage.setItem('huechat_reset_active', 'invalid');
                } catch (e) {
                  console.error('Failed to store reset error:', e);
                }
                window.location.href = ${JSON.stringify(redirectUrl)};
              </script>
            </head>
            <body>
              <p>Redirecting...</p>
            </body>
          </html>
        `);
      }
      
      // Check if token expired
      if (user.password_reset_token_expires_at) {
        const expiresAt = new Date(user.password_reset_token_expires_at);
        if (new Date() > expiresAt) {
          // Redirect to frontend with error parameter
          const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://aboutu-studio.framer.website';
          const redirectUrl = `${frontendUrl}?resetPassword=expired`;
          console.log('🔐 Expired reset token, redirecting:', redirectUrl);
          
          return res.status(200).send(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Redirecting...</title>
                <script>
                  // Store error in sessionStorage as backup
                  try {
                    sessionStorage.setItem('huechat_reset_active', 'expired');
                  } catch (e) {
                    console.error('Failed to store reset error:', e);
                  }
                  window.location.href = ${JSON.stringify(redirectUrl)};
                </script>
              </head>
              <body>
                <p>Redirecting...</p>
              </body>
            </html>
          `);
        }
      }
      
      // Token is valid - redirect to frontend with reset parameters
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://aboutu-studio.framer.website';
      const encodedEmail = encodeURIComponent(normalizedEmail);
      const encodedToken = encodeURIComponent(token);
      
      // Use hash-based URL as fallback (more reliable than query params)
      const hashData = btoa(JSON.stringify({ email: normalizedEmail, token: token }));
      const redirectUrl = `${frontendUrl}?resetPassword=true&email=${encodedEmail}&token=${encodedToken}`;
      const hashRedirectUrl = `${frontendUrl}#resetPassword=${hashData}`;
      
      console.log('🔐 Redirecting to frontend for password reset:', redirectUrl);
      console.log('🔐 Hash fallback URL:', hashRedirectUrl);
      
      // Use HTML redirect with sessionStorage fallback to preserve reset data
      // Store in sessionStorage as backup in case query params get stripped
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Redirecting...</title>
            <script>
              // Store reset data in sessionStorage FIRST (before redirect)
              try {
                sessionStorage.setItem('huechat_reset_email', ${JSON.stringify(normalizedEmail)});
                sessionStorage.setItem('huechat_reset_token', ${JSON.stringify(token)});
                sessionStorage.setItem('huechat_reset_active', 'true');
                console.log('🔐 Stored reset data in sessionStorage');
              } catch (e) {
                console.error('Failed to store reset data:', e);
              }
              
              // Immediate redirect - use replace to avoid back button issues
              window.location.replace(${JSON.stringify(redirectUrl)});
            </script>
            <meta http-equiv="refresh" content="0;url=${redirectUrl}">
          </head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <p>Redirecting to password reset page...</p>
            <p>If you are not redirected, <a href="${redirectUrl}">click here</a>.</p>
            <script>
              // Fallback: redirect after 500ms if JavaScript didn't work
              setTimeout(function() {
                window.location.replace(${JSON.stringify(redirectUrl)});
              }, 500);
            </script>
          </body>
        </html>
      `);
      
      // OLD CODE - Keep for reference but commented out
      /*
      // Show reset password form
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Reset Password - Hue</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                margin: 0;
                padding: 0;
                background: #f5f5f5;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                max-width: 400px;
                width: 100%;
              }
              h1 {
                margin: 0 0 10px 0;
                font-size: 24px;
                color: #111;
              }
              p {
                color: #666;
                font-size: 14px;
                margin: 0 0 24px 0;
              }
              input {
                width: 100%;
                padding: 12px;
                border: 1px solid #ddd;
                border-radius: 8px;
                font-size: 14px;
                box-sizing: border-box;
                margin-bottom: 16px;
              }
              button {
                width: 100%;
                padding: 12px;
                background: #111;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                cursor: pointer;
                font-weight: 500;
              }
              button:hover {
                background: #333;
              }
              button:disabled {
                background: #ccc;
                cursor: not-allowed;
              }
              .error {
                color: #ff0000;
                font-size: 14px;
                margin-top: 8px;
                display: none;
              }
              .success {
                color: green;
                font-size: 14px;
                margin-top: 8px;
                display: none;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Reset Your Password</h1>
              <p>Enter your new password below.</p>
              <form id="resetForm">
                <input type="password" id="password" placeholder="New Password (min 8 chars, uppercase, lowercase, number)" required>
                <input type="password" id="confirmPassword" placeholder="Confirm Password" required>
                <button type="submit" id="submitBtn">Reset Password</button>
                <div class="error" id="error"></div>
                <div class="success" id="success"></div>
              </form>
            </div>
            <script>
              const form = document.getElementById('resetForm');
              const errorDiv = document.getElementById('error');
              const successDiv = document.getElementById('success');
              const submitBtn = document.getElementById('submitBtn');
              
              form.addEventListener('submit', async (e) => {
                e.preventDefault();
                errorDiv.style.display = 'none';
                successDiv.style.display = 'none';
                submitBtn.disabled = true;
                submitBtn.textContent = 'Resetting...';
                
                const password = document.getElementById('password').value;
                const confirmPassword = document.getElementById('confirmPassword').value;
                
                if (password !== confirmPassword) {
                  errorDiv.textContent = 'Passwords do not match';
                  errorDiv.style.display = 'block';
                  submitBtn.disabled = false;
                  submitBtn.textContent = 'Reset Password';
                  return;
                }
                
                try {
                  const response = await fetch('/api/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      email: '${email}',
                      token: '${token}',
                      newPassword: password
                    })
                  });
                  
                  const data = await response.json();
                  
                  if (data.ok) {
                    successDiv.textContent = 'Password reset successful! Redirecting...';
                    successDiv.style.display = 'block';
                    setTimeout(() => {
                      window.location.href = '/';
                    }, 2000);
                  } else {
                    errorDiv.textContent = data.message || 'Failed to reset password';
                    errorDiv.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Reset Password';
                  }
                } catch (err) {
                  errorDiv.textContent = 'Something went wrong. Please try again.';
                  errorDiv.style.display = 'block';
                  submitBtn.disabled = false;
                  submitBtn.textContent = 'Reset Password';
                }
              });
            </script>
          </body>
        </html>
      `);
      */
    } catch (e) {
      console.error('Reset password page error:', e);
      return res.status(500).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Error</h2>
            <p>Something went wrong. Please try again later.</p>
          </body>
        </html>
      `);
    }
  }
  
  // POST requests are handled by reset-password.js API endpoint
  return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
}

