```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    // Get user ID from email
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete conversation history
    const { error: deleteError } = await supabase
      .from('conversation_history')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return res.status(500).json({ error: 'Failed to clear history' });
    }

    return res.status(200).json({ success: true, message: 'History cleared' });
  } catch (error) {
    console.error('Clear history error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```
