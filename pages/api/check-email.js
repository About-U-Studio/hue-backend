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
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name')
      .ilike('email', normalizedEmail) // Case-insensitive match
      .single();

    // If checking for duplicate names
    if (firstName && lastName && !user) {
      const normalizedFirstName = firstName.toLowerCase().trim();
      const normalizedLastName = lastName.toLowerCase().trim();
      
      // Check if first name + last name combination already exists (case-insensitive)
      const { data: nameMatches, error: nameError } = await supabaseAdmin
        .from('users')
        .select('id, email, first_name, last_name')
        .ilike('first_name', normalizedFirstName)
        .ilike('last_name', normalizedLastName)
        .limit(1);

      // If we found a match (even if query had an error, check the data)
      if (nameMatches && nameMatches.length > 0) {
        const nameMatch = nameMatches[0];
        return res.status(200).json({ 
          exists: false, // Email doesn't exist
          duplicateName: true,
          existingEmail: nameMatch.email 
        });
      }
    }

    return res.status(200).json({ 
      exists: !!user,
      duplicateName: false 
    });
  } catch (e) {
    // If error (e.g., user not found), return false
    return res.status(200).json({ exists: false, duplicateName: false });
  }
}

