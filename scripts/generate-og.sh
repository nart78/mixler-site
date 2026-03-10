#!/bin/bash
# Generate static OG HTML files for event link previews
# Run on VPS: bash /var/www/mixler.ca/scripts/generate-og.sh

SUPABASE_URL="https://dnuygqdmzjswroyzvkjb.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXlncWRtempzd3JveXp2a2piIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwODU0NDMsImV4cCI6MjA4NzY2MTQ0M30.c1ql6RXhutfX6_hw5GZq1FblD92_w1agLWqq8U6JKVs"
OG_DIR="/var/www/mixler.ca/og"
SITE="https://mixler.ca"

mkdir -p "$OG_DIR"

# Fetch all published events
events=$(curl -s "${SUPABASE_URL}/rest/v1/events?select=slug,title,description,image_url,event_date,start_time,location_name,price_cents&status=eq.published&apikey=${SUPABASE_KEY}")

if [ -z "$events" ] || [ "$events" = "[]" ]; then
  echo "No events found or API error"
  exit 1
fi

# Parse each event with jq
echo "$events" | jq -c '.[]' | while read -r event; do
  slug=$(echo "$event" | jq -r '.slug')
  title=$(echo "$event" | jq -r '.title')
  description=$(echo "$event" | jq -r '.description // ""' | sed 's/<[^>]*>//g' | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-200)
  image_url=$(echo "$event" | jq -r '.image_url // ""')
  event_date=$(echo "$event" | jq -r '.event_date // ""')
  location_name=$(echo "$event" | jq -r '.location_name // ""')

  # Format date
  if [ -n "$event_date" ] && [ "$event_date" != "null" ] && [[ "$event_date" < "2099-01-01" ]]; then
    date_str=$(date -d "$event_date" "+%A, %B %-d, %Y" 2>/dev/null || echo "$event_date")
  else
    date_str="Date TBD"
  fi

  # Build OG description
  og_desc="$date_str"
  [ -n "$location_name" ] && [ "$location_name" != "null" ] && og_desc="${og_desc} · ${location_name}"
  [ -n "$description" ] && og_desc="${og_desc}. ${description}"

  # Ensure absolute image URL
  if [ -n "$image_url" ] && [ "$image_url" != "null" ]; then
    if [[ "$image_url" != http* ]]; then
      image_url="${SITE}/${image_url#/}"
    fi
  else
    image_url="${SITE}/images/mixler-logo-wide-color.png"
  fi

  # Escape HTML entities
  esc_title=$(echo "$title" | sed 's/&/\&amp;/g; s/"/\&quot;/g; s/</\&lt;/g; s/>/\&gt;/g')
  esc_desc=$(echo "$og_desc" | sed 's/&/\&amp;/g; s/"/\&quot;/g; s/</\&lt;/g; s/>/\&gt;/g')
  esc_image=$(echo "$image_url" | sed 's/&/\&amp;/g; s/"/\&quot;/g')
  canonical="${SITE}/event?slug=${slug}"

  cat > "${OG_DIR}/${slug}.html" <<OGHTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc_title} | Mixler</title>
<meta property="og:title" content="${esc_title}">
<meta property="og:description" content="${esc_desc}">
<meta property="og:image" content="${esc_image}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Mixler">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc_title}">
<meta name="twitter:description" content="${esc_desc}">
<meta name="twitter:image" content="${esc_image}">
<link rel="canonical" href="${canonical}">
</head>
<body>
<p><a href="${canonical}">${esc_title}</a></p>
</body>
</html>
OGHTML

  echo "Generated: ${OG_DIR}/${slug}.html"
done

echo "Done. OG files in ${OG_DIR}/"
