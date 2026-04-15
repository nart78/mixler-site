#!/bin/bash
# Generate indexable static HTML files for event pages.
# Nginx serves these to search engine bots (via user-agent sniffing) so
# Google sees real content and Event schema instead of the JS-rendered SPA.
# Run on VPS: bash /var/www/mixler.ca/scripts/generate-og.sh

set -euo pipefail

SUPABASE_URL="https://dnuygqdmzjswroyzvkjb.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXlncWRtempzd3JveXp2a2piIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwODU0NDMsImV4cCI6MjA4NzY2MTQ0M30.c1ql6RXhutfX6_hw5GZq1FblD92_w1agLWqq8U6JKVs"

if [ -d "/var/www/mixler.ca" ]; then
  OG_DIR="/var/www/mixler.ca/og"
else
  OG_DIR="$(dirname "$(readlink -f "$0")")/../og"
fi
SITE="https://www.mixler.ca"

mkdir -p "$OG_DIR"

fields="slug,title,description,short_description,image_url,event_date,start_time,end_time,location_name,location_address,price_cents,capacity,tickets_sold,status"
events=$(curl -sf "${SUPABASE_URL}/rest/v1/events?select=${fields}&status=eq.published&apikey=${SUPABASE_KEY}")

if [ -z "$events" ] || [ "$events" = "[]" ]; then
  echo "No events found or API error"
  exit 1
fi

# Word-boundary truncation: cut at the last whole word within the limit.
trunc() {
  local text="$1"
  local limit="$2"
  local len=${#text}
  if (( len <= limit )); then
    printf '%s' "$text"
    return
  fi
  local cut="${text:0:limit}"
  cut="${cut% *}"
  printf '%s...' "$cut"
}

esc_html() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  printf '%s' "$s"
}

esc_json() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])'
}

# Calgary is America/Edmonton. DST roughly April-October.
tz_for_month() {
  local m="$1"
  if (( 10#$m >= 4 && 10#$m <= 10 )); then
    echo "-06:00"
  else
    echo "-07:00"
  fi
}

echo "$events" | jq -c '.[]' | while read -r event; do
  slug=$(echo "$event" | jq -r '.slug')
  title=$(echo "$event" | jq -r '.title')
  description=$(echo "$event" | jq -r '.description // ""')
  short_description=$(echo "$event" | jq -r '.short_description // ""')
  image_url=$(echo "$event" | jq -r '.image_url // ""')
  event_date=$(echo "$event" | jq -r '.event_date // ""')
  start_time=$(echo "$event" | jq -r '.start_time // ""')
  end_time=$(echo "$event" | jq -r '.end_time // ""')
  location_name=$(echo "$event" | jq -r '.location_name // ""')
  location_address=$(echo "$event" | jq -r '.location_address // ""')
  price_cents=$(echo "$event" | jq -r '.price_cents // 0')
  capacity=$(echo "$event" | jq -r '.capacity // 0')
  tickets_sold=$(echo "$event" | jq -r '.tickets_sold // 0')

  canonical="${SITE}/event.html?slug=${slug}"

  if [ -n "$event_date" ] && [ "$event_date" != "null" ] && [[ "$event_date" < "2099-01-01" ]]; then
    date_human=$(date -d "$event_date" "+%A, %B %-d, %Y")
    date_iso="$event_date"
  else
    date_human="Date to be announced"
    date_iso=""
  fi

  start_human=""
  end_human=""
  if [ -n "$start_time" ] && [ "$start_time" != "null" ]; then
    start_human=$(date -d "1970-01-01 $start_time" "+%-I:%M %p" 2>/dev/null || echo "$start_time")
  fi
  if [ -n "$end_time" ] && [ "$end_time" != "null" ]; then
    end_human=$(date -d "1970-01-01 $end_time" "+%-I:%M %p" 2>/dev/null || echo "$end_time")
  fi
  time_line=""
  if [ -n "$start_human" ] && [ -n "$end_human" ]; then
    time_line="${start_human} to ${end_human}"
  elif [ -n "$start_human" ]; then
    time_line="${start_human}"
  fi

  start_iso=""
  end_iso=""
  if [ -n "$date_iso" ]; then
    month="${date_iso:5:2}"
    tz=$(tz_for_month "$month")
    if [ -n "$start_time" ] && [ "$start_time" != "null" ]; then
      start_iso="${date_iso}T${start_time}${tz}"
    else
      start_iso="${date_iso}T00:00:00${tz}"
    fi
    if [ -n "$end_time" ] && [ "$end_time" != "null" ]; then
      end_iso="${date_iso}T${end_time}${tz}"
    else
      end_iso="$start_iso"
    fi
  fi

  if (( price_cents > 0 )); then
    dollars=$(awk "BEGIN { printf \"%.2f\", $price_cents / 100 }")
    price_display="\$${dollars}"
    price_value="$dollars"
  else
    price_display="Free"
    price_value="0.00"
  fi

  if (( capacity > 0 )) && (( tickets_sold >= capacity )); then
    availability="https://schema.org/SoldOut"
  else
    availability="https://schema.org/InStock"
  fi

  if [ -n "$image_url" ] && [ "$image_url" != "null" ]; then
    if [[ "$image_url" != http* ]]; then
      image_url="${SITE}/${image_url#/}"
    fi
  else
    image_url="${SITE}/images/mixler-logo-wide-color.png"
  fi

  if [ -n "$short_description" ] && [ "$short_description" != "null" ]; then
    meta_desc_raw="$short_description"
  else
    meta_desc_raw=$(echo "$description" | tr '\n' ' ' | sed 's/  */ /g')
    meta_desc_raw=$(trunc "$meta_desc_raw" 180)
  fi
  prefix="$date_human"
  if [ -n "$location_name" ] && [ "$location_name" != "null" ]; then
    prefix="${prefix} at ${location_name}"
  fi
  meta_desc="${prefix}. ${meta_desc_raw}"
  meta_desc=$(trunc "$meta_desc" 300)

  body_paragraphs=""
  while IFS= read -r para; do
    [ -z "$para" ] && continue
    body_paragraphs+="        <p>$(esc_html "$para")</p>"$'\n'
  done < <(echo "$description" | awk 'BEGIN{RS="\n\n"} {gsub(/\n/," "); gsub(/  +/," "); print}')

  e_title=$(esc_html "$title")
  e_meta_desc=$(esc_html "$meta_desc")
  e_image=$(esc_html "$image_url")
  e_canonical=$(esc_html "$canonical")
  e_location_name=$(esc_html "$location_name")
  e_location_address=$(esc_html "$location_address")
  e_date=$(esc_html "$date_human")
  e_time=$(esc_html "$time_line")
  e_price=$(esc_html "$price_display")

  j_title=$(esc_json "$title")
  j_description=$(esc_json "$(echo "$description" | tr '\n' ' ' | sed 's/  */ /g')")
  j_image=$(esc_json "$image_url")
  j_canonical=$(esc_json "$canonical")
  j_location_name=$(esc_json "${location_name:-Mixler Event}")
  j_location_address=$(esc_json "${location_address:-Calgary, AB, Canada}")

  event_schema=""
  if [ -n "$start_iso" ]; then
    event_schema=$(cat <<JSON
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "${j_title}",
  "description": "${j_description}",
  "startDate": "${start_iso}",
  "endDate": "${end_iso}",
  "eventStatus": "https://schema.org/EventScheduled",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "location": {
    "@type": "Place",
    "name": "${j_location_name}",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "${j_location_address}",
      "addressLocality": "Calgary",
      "addressRegion": "AB",
      "addressCountry": "CA"
    }
  },
  "image": "${j_image}",
  "offers": {
    "@type": "Offer",
    "url": "${j_canonical}",
    "price": "${price_value}",
    "priceCurrency": "CAD",
    "availability": "${availability}",
    "validFrom": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  },
  "organizer": {
    "@type": "Organization",
    "name": "Mixler",
    "url": "${SITE}/"
  }
}
JSON
)
  fi

  breadcrumb_schema=$(cat <<JSON
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE}/" },
    { "@type": "ListItem", "position": 2, "name": "Events", "item": "${SITE}/events.html" },
    { "@type": "ListItem", "position": 3, "name": "${j_title}", "item": "${j_canonical}" }
  ]
}
JSON
)

  details_html=""
  [ -n "$e_date" ] && details_html+="          <li><strong>Date:</strong> ${e_date}</li>"$'\n'
  [ -n "$e_time" ] && details_html+="          <li><strong>Time:</strong> ${e_time}</li>"$'\n'
  if [ -n "$e_location_name" ]; then
    loc_line="$e_location_name"
    [ -n "$e_location_address" ] && loc_line="${loc_line}, ${e_location_address}"
    details_html+="          <li><strong>Location:</strong> ${loc_line}</li>"$'\n'
  fi
  details_html+="          <li><strong>Price:</strong> ${e_price}</li>"$'\n'

  event_schema_block=""
  if [ -n "$event_schema" ]; then
    event_schema_block=$'<script type="application/ld+json">\n'"${event_schema}"$'\n</script>'
  fi

  cat > "${OG_DIR}/${slug}.html" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e_title} in Calgary | Mixler</title>
<meta name="description" content="${e_meta_desc}">
<link rel="canonical" href="${e_canonical}">
<meta property="og:title" content="${e_title} in Calgary">
<meta property="og:description" content="${e_meta_desc}">
<meta property="og:image" content="${e_image}">
<meta property="og:url" content="${e_canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Mixler">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e_title} in Calgary">
<meta name="twitter:description" content="${e_meta_desc}">
<meta name="twitter:image" content="${e_image}">
<script type="application/ld+json">
${breadcrumb_schema}
</script>
${event_schema_block}
</head>
<body>
  <header>
    <nav aria-label="Breadcrumb">
      <a href="${SITE}/">Home</a> &rsaquo;
      <a href="${SITE}/events.html">Events</a> &rsaquo;
      <span>${e_title}</span>
    </nav>
  </header>
  <main>
    <article>
      <h1>${e_title} in Calgary</h1>
      <img src="${e_image}" alt="${e_title}" width="1200" height="500">
      <section>
        <h2>Event details</h2>
        <ul class="event-details">
${details_html}        </ul>
      </section>
      <section>
        <h2>About this event</h2>
${body_paragraphs}      </section>
      <p><a href="${e_canonical}" class="cta">Get Tickets</a></p>
    </article>
  </main>
  <footer>
    <p>Hosted by <a href="${SITE}/">Mixler</a>. Calgary social events for people who want something to do.</p>
  </footer>
</body>
</html>
HTML

  echo "Generated: ${OG_DIR}/${slug}.html"
done

echo "Done. OG files in ${OG_DIR}/"
