import { Resend } from 'resend';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendWelcomeEmail(toEmail, firstName) {
  if (!resend) return;
  // Normalize email to lowercase (emails are case-insensitive, but normalize for consistency)
  const normalizedEmail = toEmail ? toEmail.toLowerCase().trim() : '';
  if (!normalizedEmail) {
    console.error('Invalid email address provided to sendWelcomeEmail');
    return;
  }
  const name = firstName ? ` ${firstName}` : '';
  try {
    await resend.emails.send({
      from: 'Hue <onboarding@resend.dev>',
      to: normalizedEmail,
      subject: 'Thanks for trying Hue',
      html: `<p>Hi${name},</p><p>Thanks for trying <b>Hue</b>! Reply with any feedback.</p>`
    });
  } catch (e) {
    console.error('Resend error', e);
  }
}

export async function sendVerificationEmail(toEmail, firstName, verificationToken) {
  if (!resend) {
    console.error('Resend API key not configured. Cannot send verification email.');
    throw new Error('Email service not configured. Please contact support.');
  }
  
  // Normalize email to lowercase (emails are case-insensitive, but normalize for consistency)
  const normalizedEmail = toEmail ? toEmail.toLowerCase().trim() : '';
  if (!normalizedEmail) {
    console.error('Invalid email address provided to sendVerificationEmail');
    throw new Error('Invalid email address');
  }
  
  const name = firstName ? ` ${firstName}` : '';
  
  // Get base URL - prioritize production domain, then fallback to Vercel URL
  // Always use HTTPS for production
  let baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  
  // If NEXT_PUBLIC_BASE_URL is not set, try VERCEL_URL (but ensure HTTPS)
  if (!baseUrl) {
    const vercelUrl = process.env.VERCEL_URL;
    if (vercelUrl) {
      // VERCEL_URL doesn't include protocol, add HTTPS
      baseUrl = `https://${vercelUrl}`;
    } else {
      // Fallback to localhost only in development
      baseUrl = process.env.NODE_ENV === 'production' 
        ? 'https://your-domain.com' // Replace with your actual domain
        : 'http://localhost:3000';
    }
  }
  
  // Ensure baseUrl uses HTTPS in production (unless it's localhost)
  if (!baseUrl.includes('localhost') && !baseUrl.startsWith('https://')) {
    baseUrl = baseUrl.replace(/^http:\/\//, 'https://');
    baseUrl = baseUrl.startsWith('https://') ? baseUrl : `https://${baseUrl}`;
  }
  
  // Remove trailing slash if present
  baseUrl = baseUrl.replace(/\/$/, '');
  
  // Use base64 encoding to combine token and email into a single parameter
  // This prevents email clients from stripping query parameters
  const combinedData = JSON.stringify({ token: verificationToken, email: normalizedEmail });
  const encodedData = Buffer.from(combinedData).toString('base64');
  const verificationUrl = `${baseUrl}/api/verify-email?data=${encodedData}`;
  
  // Also keep the old format as a fallback for manual link copying
  const encodedToken = encodeURIComponent(verificationToken);
  const encodedEmail = encodeURIComponent(normalizedEmail);
  const fallbackUrl = `${baseUrl}/api/verify-email?token=${encodedToken}&email=${encodedEmail}`;
  
  console.log('Sending verification email to:', normalizedEmail);
  console.log('Original email (if different):', toEmail !== normalizedEmail ? toEmail : 'same');
  console.log('Base URL used:', baseUrl);
  console.log('Verification URL (new format):', verificationUrl);
  console.log('Fallback URL (old format):', fallbackUrl);
  console.log('Token length:', verificationToken.length);
  
  try {
    const result = await resend.emails.send({
      from: 'Hue <onboarding@resend.dev>',
      to: normalizedEmail,
      subject: 'Verify your email for Hue',
      html: `
        <p>Hi${name},</p>
        <p>Thanks for signing up for <b>Hue</b>! Please verify your email address to get started.</p>
        <p><a href="${verificationUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 12px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 8px;">Verify Email</a></p>
        <p style="margin-top: 20px;">Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; font-family: monospace; font-size: 12px; background: #f5f5f5; padding: 10px; border-radius: 4px;">${fallbackUrl}</p>
        <p style="font-size: 12px; color: #666; margin-top: 20px;">This link will expire in 24 hours.</p>
        <p style="font-size: 11px; color: #999; margin-top: 10px;">If the button doesn't work, please use the link above.</p>
      `
    });
    console.log('Verification email sent successfully:', result);
    return result;
  } catch (e) {
    console.error('Resend verification email error:', e);
    console.error('Error details:', JSON.stringify(e, null, 2));
    throw e;
  }
}
