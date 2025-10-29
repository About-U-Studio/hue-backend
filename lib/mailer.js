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
