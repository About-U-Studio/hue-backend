import { applyCors } from '../../lib/cors';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
  // Handle CORS
  if (applyCors(req, res)) return;
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

    try {
        // Normalize email to lowercase for case-insensitive comparison
        const normalizedEmail = email.toLowerCase().trim();
        
        // Get user (case-insensitive email match)
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .ilike('email', normalizedEmail)
            .single();

        if (userError || !user) {
            return res.status(200).json({ history: [], user: null });
        }

        // CRITICAL: If user pressed "New Chat", only load history CREATED AFTER that timestamp
        let historyQuery = supabase
            .from('conversation_history')
            .select('*')
            .eq('user_id', user.id);

        // If user has pressed "New Chat" (last_new_chat_at exists), only get history after that
        if (user.last_new_chat_at) {
            historyQuery = historyQuery.gt('created_at', user.last_new_chat_at);
        }

        // Get conversation history
        const { data: history, error: historyError } = await historyQuery
            .order('created_at', { ascending: true })
            .limit(20);

        if (historyError) {
            console.error('History error:', historyError);
            return res.status(500).json({ error: 'Failed to load history' });
        }

        return res.status(200).json({ 
            history: history || [], 
            user: {
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                audience: user.audience,
                last_new_chat_at: user.last_new_chat_at || null
            }
        });
    } catch (error) {
        console.error('Load history error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
