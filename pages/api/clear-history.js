import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req, res) {
  // Apply CORS
  if (applyCors(req, res)) return;

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user by email
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (userError || !user) {
      console.error('User not found:', userError);
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete all conversation history for this user
    const { error: deleteError } = await supabaseAdmin
      .from('conversation_history')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Error deleting conversation history:', deleteError);
      return res.status(500).json({ error: 'Failed to clear history' });
    }

    console.log(`Cleared conversation history for user ${email}`);
    
    return res.status(200).json({ success: true, message: 'Conversation history cleared' });
  } catch (err) {
    console.error('Clear history error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

