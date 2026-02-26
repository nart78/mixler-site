// Supabase Client - Mixler Event Platform
// Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Import Supabase from CDN (loaded via script tag in HTML)
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { db, SUPABASE_URL, SUPABASE_ANON_KEY };
