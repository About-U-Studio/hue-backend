export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = [
    'https://aboutu-studio.framer.website',   // your Framer preview/published domain
    'https://framer.website',                 // optional
    'http://localhost:3000'                   // local testing, optional
  ];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true; // handled
  }
  return false; // continue
}
