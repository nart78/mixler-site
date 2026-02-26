// Supabase Client - Mixler Event Platform
// Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'https://dnuygqdmzjswroyzvkjb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXlncWRtempzd3JveXp2a2piIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwODU0NDMsImV4cCI6MjA4NzY2MTQ0M30.c1ql6RXhutfX6_hw5GZq1FblD92_w1agLWqq8U6JKVs';

// Import Supabase from CDN (loaded via script tag in HTML)
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { db, SUPABASE_URL, SUPABASE_ANON_KEY };
