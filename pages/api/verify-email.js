import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { applyCors } from '../../lib/cors';

export default async function handler(req, res) {
  // Handle CORS
  if (applyCors(req, res)) return;
  
  // Only allow GET requests (for email link clicks)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, email } = req.query;

    if (!token || !email) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Verification Failed</h2>
            <p>Missing token or email. Please check your verification link.</p>
          </body>
        </html>
      `);
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Find user with matching email and token
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, email_verified, verification_token, verification_token_expires_at')
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
      return res.status(200).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Already Verified</h2>
            <p>Your email has already been verified. You can now use Hue Chat!</p>
            <p><a href="https://aboutu-studio.framer.website">Go to Hue Chat</a></p>
          </body>
        </html>
      `);
    }

    // Check if token matches
    if (user.verification_token !== token) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>Verification Failed</h2>
            <p>Invalid verification token. The link may have expired or already been used.</p>
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
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        email_verified: true,
        verification_token: null, // Clear token after use
        verification_token_expires_at: null
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

    // Success!
    return res.status(200).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: green;">Email Verified!</h2>
          <p>Your email has been verified successfully. You can now use Hue Chat!</p>
          <p><a href="https://aboutu-studio.framer.website" style="display: inline-block; padding: 12px 24px; background-color: #0066ff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">Go to Hue Chat</a></p>
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
