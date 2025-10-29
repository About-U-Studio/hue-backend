export async function appendToSheet(payload) {
  const url = process.env.SHEETS_WEBHOOK_URL;
  if (!url) {
    console.error('SHEETS_WEBHOOK_URL missing');
    return;
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Sheets webhook error', e);
  }
}
