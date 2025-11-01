import { applyCors } from '../../lib/cors';
import { supabaseAdmin } from '../../lib/supabaseAdmin';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, firstName, lastName } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists (case-insensitive email match)
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name')
      .ilike('email', normalizedEmail) // Case-insensitive match
      .maybeSingle();

    console.log('Check email for:', normalizedEmail, 'Found user:', !!user, 'firstName:', firstName, 'lastName:', lastName);

    // If checking for duplicate names (only during registration)
    if (firstName && lastName && !user && !userError) {
      const normalizedFirstName = firstName.toLowerCase().trim();
      const normalizedLastName = lastName.toLowerCase().trim();
      
      // Check if first name + last name combination already exists (case-insensitive)
      const { data: nameMatches } = await supabaseAdmin
        .from('users')
        .select('id, email, first_name, last_name')
        .ilike('first_name', normalizedFirstName)
        .ilike('last_name', normalizedLastName)
        .limit(1);

      console.log('Checking duplicate name:', normalizedFirstName, normalizedLastName, 'Matches found:', nameMatches?.length || 0);

      if (nameMatches && nameMatches.length > 0) {
        const nameMatch = nameMatches[0];
        console.log('Returning duplicate name response');
        return res.status(200).json({ 
          exists: false, // Email doesn't exist
          duplicateName: true,
          existingEmail: nameMatch.email 
        });
      }
    }

    console.log('Returning standard response, exists:', !!user);
    return res.status(200).json({ 
      exists: !!user,
      duplicateName: false 
    });
  } catch (e) {
    console.error('Check email error:', e);
    // If error (e.g., user not found), return false
    return res.status(200).json({ exists: false, duplicateName: false });
  }
}
