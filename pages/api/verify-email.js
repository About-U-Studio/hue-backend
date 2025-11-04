import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { applyCors } from '../../lib/cors';
import { sendWelcomeEmail } from '../../lib/mailer';
import { generateAuthToken, getAuthTokenExpiration } from '../../lib/auth';

export default async function handler(req, res) {
  // Handle CORS
  if (applyCors(req, res)) return;
  
  // Only allow GET requests (for email link clicks)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Support new format (single 'data' parameter with base64 encoded JSON)
    // and fallback to old format (separate 'token' and 'email' parameters)
    let token = null;
    let email = null;
    
    // Try new format first (single 'data' parameter)
    if (req.query.data) {
      try {
        const dataRaw = Array.isArray(req.query.data) ? req.query.data[0] : req.query.data;
        const decodedData = Buffer.from(dataRaw, 'base64').toString('utf-8');
        const data = JSON.parse(decodedData);
        token = data.token;
        email = data.email;
        console.log('Using new format (data parameter)');
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
        if (req.query.t) {
          // Base64 encoded token
          try {
            token = Buffer.from(rawValue, 'base64').toString('utf-8');
          } catch (e) {
            token = decodeURIComponent(rawValue);
          }
        } else {
          token = decodeURIComponent(rawValue);
        }
      }
      
      if (emailRaw) {
        const rawValue = Array.isArray(emailRaw) ? emailRaw[0] : emailRaw;
        if (req.query.e) {
          // Base64 encoded email
          try {
            email = Buffer.from(rawValue, 'base64').toString('utf-8');
          } catch (e) {
            email = decodeURIComponent(rawValue);
          }
        } else {
          email = decodeURIComponent(rawValue);
        }
      }
      if (token || email) {
        console.log('Using old format (separate parameters)');
      }
    }

    console.log('Verification request received:', { 
      hasDataParam: !!req.query.data,
      hasTokenParam: !!req.query.token,
      hasEmailParam: !!req.query.email,
      token: token ? 'present (' + token.length + ' chars)' : 'missing',
      email: email || 'missing',
      queryKeys: Object.keys(req.query),
      fullQuery: JSON.stringify(req.query)
    });

    if (!token || !email) {
      console.error('Missing token or email in verification request', {
        tokenRaw: req.query.token,
        emailRaw: req.query.email,
        allQuery: req.query
      });
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Verification Failed</h2>
            <p>Missing token or email. Please check your verification link.</p>
            <p>Token: ${token ? 'present' : 'missing'}</p>
            <p>Email: ${email || 'missing'}</p>
            <p style="font-size: 12px; color: #666; margin-top: 20px;">If the token is missing, try clicking the full link in the email instead of the button.</p>
          </body>
        </html>
      `);
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Find user with matching email and token
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, email_verified, verification_token, verification_token_expires_at')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Verification Failed</h2>
            <p>User not found. Please check your verification link.</p>
          </body>
        </html>
      `);
    }

    // Check if already verified
    if (user.email_verified) {
      // Generate new auth token for already verified users
      const authToken = generateAuthToken();
      const authTokenExpiresAt = getAuthTokenExpiration();
      
      // Update auth token
      await supabaseAdmin
        .from('users')
        .update({
          auth_token: authToken,
          auth_token_expires_at: authTokenExpiresAt
        })
        .eq('id', user.id);
      
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://aboutu-studio.framer.website';
      const encodedEmail = encodeURIComponent(normalizedEmail);
      const encodedToken = encodeURIComponent(authToken);
      const redirectUrl = `${frontendUrl}?verified=true&email=${encodedEmail}&token=${encodedToken}`;
      
      return res.status(200).send(`
        <html>
          <head>
            <title>Already Verified - Hue Chat</title>
          </head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Already Verified</h2>
            <p>Your email has already been verified. You can now use Hue Chat!</p>
            <p><a href="${redirectUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0066ff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">Go to Hue Chat</a></p>
            <script>
              setTimeout(function() {
                window.location.href = "${redirectUrl}";
              }, 2000);
            </script>
          </body>
        </html>
      `);
    }

    // Check if token matches (compare decoded token)
    const decodedToken = token.trim();
    const storedToken = user.verification_token ? user.verification_token.trim() : null;
    
    if (!storedToken || storedToken !== decodedToken) {
      console.error('Token mismatch:', { 
        storedTokenPresent: !!storedToken, 
        decodedTokenLength: decodedToken.length,
        storedTokenLength: storedToken?.length 
      });
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Verification Failed</h2>
            <p>Invalid verification token. The link may have expired or already been used.</p>
            <p>Please try clicking the full link in the email, or request a new verification email.</p>
          </body>
        </html>
      `);
    }

    // Check if token expired
    if (user.verification_token_expires_at) {
      const expiresAt = new Date(user.verification_token_expires_at);
      if (new Date() > expiresAt) {
        return res.status(400).send(`
          <html>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h2>Verification Expired</h2>
              <p>This verification link has expired. Please request a new one.</p>
            </body>
          </html>
        `);
      }
    }

    // Verify the email
    const authToken = generateAuthToken();
    const authTokenExpiresAt = getAuthTokenExpiration();
    
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        email_verified: true,
        verification_token: null, // Clear token after use
        verification_token_expires_at: null,
        auth_token: authToken, // Generate auth token for auto-login
        auth_token_expires_at: authTokenExpiresAt
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Verification update error:', updateError);
      return res.status(500).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Verification Failed</h2>
            <p>Something went wrong. Please try again later.</p>
          </body>
        </html>
      `);
    }

    // Send welcome email after successful verification
    try {
      await sendWelcomeEmail(email, user.first_name);
    } catch (e) {
      console.error('Failed to send welcome email:', e);
      // Don't fail verification if welcome email fails
    }

    // Get the frontend URL from environment variable or use default
    const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://aboutu-studio.framer.website';
    
    // Encode email and auth token for URL parameters
    const encodedEmail = encodeURIComponent(normalizedEmail);
    const encodedToken = encodeURIComponent(authToken);
    
    // Redirect URL with authentication parameters
    const redirectUrl = `${frontendUrl}?verified=true&email=${encodedEmail}&token=${encodedToken}`;

    // Success!
    return res.status(200).send(`
      <html>
        <head>
          <title>Email Verified - Hue Chat</title>
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: green;">Email Verified!</h2>
          <p>Your email has been verified successfully. You can now use Hue Chat!</p>
          <p><a href="${redirectUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0066ff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">Go to Hue Chat</a></p>
          <script>
            // Auto-redirect after 2 seconds
            setTimeout(function() {
              window.location.href = "${redirectUrl}";
            }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Verify email error:', error);
    return res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>Verification Failed</h2>
          <p>Something went wrong. Please try again later.</p>
        </body>
      </html>
    `);
  }
}

