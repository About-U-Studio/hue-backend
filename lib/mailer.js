import { Resend } from 'resend';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendWelcomeEmail(toEmail, firstName) {
  if (!resend) return;
  const name = firstName ? ` ${firstName}` : '';
  try {
    await resend.emails.send({
      from: 'Hue <onboarding@resend.dev>', // replace with your verified domain later
      to: toEmail,
      subject: 'Thanks for trying Hue',
      html: `<p>Hi${name},</p><p>Thanks for trying <b>Hue</b>! Reply with any feedback.</p>`
    });
  } catch (e) {
    console.error('Resend error', e);
  }
}

/**
 * Send email verification link
 * @param {string} email - User's email
 * @param {string} verificationToken - Verification token
 * @returns {Promise} - Email send result
 */
export async function sendVerificationEmail(email, verificationToken) {
  if (!resend) {
    console.error('Resend not configured');
    return null;
  }

  // Create verification URL - CHANGE THIS TO YOUR ACTUAL URL
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : 'https://hue-backend.vercel.app'; // CHANGE THIS
  const verificationUrl = `${baseUrl}/api/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;

  try {
    const { data, error } = await resend.emails.send({
      from: 'Hue <hello@aboutu.studio>', // CHANGE THIS TO YOUR EMAIL
      to: email,
      subject: 'Verify your email for Hue Chat',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Verify Your Email</h2>
          <p>Thanks for signing up for Hue Chat! Please click the button below to verify your email address:</p>
          <a href="${verificationUrl}" 
             style="display: inline-block; padding: 12px 24px; background-color: #0066ff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0;">
            Verify Email
          </a>
          <p>Or copy and paste this link into your browser:</p>
          <p style="color: #666; font-size: 12px; word-break: break-all;">${verificationUrl}</p>
          <p style="color: #666; font-size: 12px;">This link will expire in 24 hours.</p>
          <p style="color: #666; font-size: 12px; margin-top: 40px;">If you didn't sign up for Hue Chat, you can safely ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      console.error('Verification email error:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Send verification email error:', error);
    return null;
  }
}

