]import { Resend } from 'resend';
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

export async function sendVerificationEmail(toEmail, firstName, verificationToken) {
  if (!resend) return;
  const name = firstName ? ` ${firstName}` : '';
  // Use Vercel URL with https:// prefix, or fallback to localhost
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || vercelUrl || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/api/verify-email?token=${verificationToken}&email=${encodeURIComponent(toEmail)}`;
  
  try {
    await resend.emails.send({
      from: 'Hue <onboarding@resend.dev>', // replace with your verified domain later
      to: toEmail,
      subject: 'Verify your email for Hue',
      html: `
        <p>Hi${name},</p>
        <p>Thanks for signing up for <b>Hue</b>! Please verify your email address to get started.</p>
        <p><a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 8px;">Verify Email</a></p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all;">${verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
      `
    });
  } catch (e) {
    console.error('Resend verification email error', e);
    throw e;
  }
}
