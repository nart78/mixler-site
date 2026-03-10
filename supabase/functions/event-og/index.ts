import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');

  if (!slug) {
    return new Response('Missing slug', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: event } = await supabase
    .from('events')
    .select('title, description, image_url, event_date, start_time, location_name, price_cents')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (!event) {
    return new Response('Event not found', { status: 404 });
  }

  // Format date for display
  const dateStr = event.event_date && event.event_date < '2099-01-01'
    ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : 'Date TBD';

  // Build description: first 200 chars of description, stripped of HTML
  const rawDesc = (event.description || '').replace(/<[^>]*>/g, '').replace(/\n+/g, ' ').trim();
  const shortDesc = rawDesc.length > 200 ? rawDesc.substring(0, 197) + '...' : rawDesc;
  const ogDescription = `${dateStr}${event.location_name ? ' · ' + event.location_name : ''}${shortDesc ? '. ' + shortDesc : ''}`;

  const canonicalUrl = `https://mixler.ca/event?slug=${slug}`;
  // Ensure image URL is absolute
  let ogImage = event.image_url || 'https://mixler.ca/images/mixler-logo-wide-color.png';
  if (ogImage && !ogImage.startsWith('http')) {
    ogImage = `https://mixler.ca/${ogImage.replace(/^\//, '')}`;
  }
  const title = `${event.title} | Mixler`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${esc(title)}</title>
  <meta property="og:title" content="${esc(event.title)}">
  <meta property="og:description" content="${esc(ogDescription)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:url" content="${esc(canonicalUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Mixler">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(event.title)}">
  <meta name="twitter:description" content="${esc(ogDescription)}">
  <meta name="twitter:image" content="${esc(ogImage)}">
  <link rel="canonical" href="${esc(canonicalUrl)}">
</head>
<body>
  <p><a href="${esc(canonicalUrl)}">${esc(event.title)}</a></p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
});

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
