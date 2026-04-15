#!/usr/bin/env python3
"""
Mixler pSEO Page Generator
Reads JSON files from seo/data/ and renders Jinja2 templates into
activities/ and guides/ directories. Also creates sitemap.xml and robots.txt.

Usage:
    python3 seo/generate.py

Run from repo root (~/mixler-site/).
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape


SEO_DIR = Path(__file__).parent
REPO_ROOT = SEO_DIR.parent
TEMPLATES_DIR = SEO_DIR / 'templates'
DATA_ACTIVITIES_DIR = SEO_DIR / 'data' / 'activities'
DATA_GUIDES_DIR = SEO_DIR / 'data' / 'guides'
SITE_BASE_URL = 'https://www.mixler.ca'
SUPABASE_URL = 'https://dnuygqdmzjswroyzvkjb.supabase.co'


def fetch_upcoming_events(anon_key: str) -> list[dict]:
    """Fetch published events with event_date >= today from Supabase REST.

    Returns an empty list on any failure -- build must not block on network.
    """
    if not anon_key:
        return []
    today = date.today().isoformat()
    fields = (
        'slug,title,description,short_description,image_url,event_date,'
        'start_time,end_time,location_name,location_address,price_cents,'
        'capacity,tickets_sold,updated_at'
    )
    qs = urllib.parse.urlencode({
        'select': fields,
        'status': 'eq.published',
        'event_date': f'gte.{today}',
        'order': 'event_date.asc',
    })
    url = f'{SUPABASE_URL}/rest/v1/events?{qs}'
    req = urllib.request.Request(url, headers={
        'apikey': anon_key,
        'Authorization': f'Bearer {anon_key}',
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as exc:
        print(f"  Warning: could not fetch upcoming events from Supabase: {exc}")
        return []


def calgary_tz_offset(month: int) -> str:
    """Approximate Calgary timezone. DST April-October: -06:00, else -07:00."""
    return '-06:00' if 4 <= month <= 10 else '-07:00'


def format_event_iso(event_date: str, start_time: str | None, end_time: str | None) -> tuple[str, str]:
    """Return (start_iso, end_iso) with Calgary timezone suffix."""
    if not event_date:
        return ('', '')
    month = int(event_date[5:7])
    tz = calgary_tz_offset(month)
    start = f"{event_date}T{(start_time or '00:00:00')}{tz}"
    end = f"{event_date}T{(end_time or start_time or '00:00:00')}{tz}"
    return (start, end)


def match_events_to_activity(events: list[dict], activity: dict) -> list[dict]:
    """Return events whose title contains the activity name (case-insensitive).

    Activity names like "Puppy Yoga" match events titled "Puppy Yoga", "Puppy Yoga Spring", etc.
    """
    name = (activity.get('name') or '').strip().lower()
    if not name:
        return []
    return [e for e in events if name in (e.get('title') or '').lower()]


def enrich_event_for_template(event: dict) -> dict:
    """Add computed fields (iso dates, price display, canonical, etc.) for templating."""
    e = {**event}
    e['canonical'] = f"{SITE_BASE_URL}/event.html?slug={event['slug']}"
    start_iso, end_iso = format_event_iso(
        event.get('event_date', ''),
        event.get('start_time'),
        event.get('end_time'),
    )
    e['start_iso'] = start_iso
    e['end_iso'] = end_iso

    # Human-readable date
    try:
        dt = datetime.strptime(event['event_date'], '%Y-%m-%d')
        e['date_human'] = dt.strftime('%A, %B %-d, %Y')
    except Exception:
        e['date_human'] = event.get('event_date', 'Date to be announced')

    # Price
    price_cents = event.get('price_cents') or 0
    if price_cents > 0:
        e['price_display'] = f"${price_cents / 100:.2f}"
        e['price_value'] = f"{price_cents / 100:.2f}"
    else:
        e['price_display'] = 'Free'
        e['price_value'] = '0.00'

    # Availability
    capacity = event.get('capacity') or 0
    sold = event.get('tickets_sold') or 0
    if capacity > 0 and sold >= capacity:
        e['availability'] = 'https://schema.org/SoldOut'
    else:
        e['availability'] = 'https://schema.org/InStock'

    # Absolute image URL
    image_url = event.get('image_url') or ''
    if image_url and not image_url.startswith('http'):
        image_url = f"{SITE_BASE_URL}/{image_url.lstrip('/')}"
    elif not image_url:
        image_url = f"{SITE_BASE_URL}/images/mixler-logo-wide-color.png"
    e['image_absolute'] = image_url

    # Description with collapsed whitespace (for JSON-LD)
    desc = (event.get('description') or '').replace('\n', ' ')
    while '  ' in desc:
        desc = desc.replace('  ', ' ')
    e['description_oneline'] = desc.strip()

    # validFrom timestamp
    e['valid_from'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    return e


def load_env():
    """Load SUPABASE_ANON_KEY from .env file in repo root."""
    env_path = REPO_ROOT / '.env'
    if not env_path.exists():
        print(f"Warning: .env not found at {env_path}. Anon key will be empty.")
        return ''
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith('SUPABASE_ANON_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    print("Warning: SUPABASE_ANON_KEY not found in .env")
    return ''


def load_json_files(directory: Path) -> list[dict]:
    """Load all .json files from a directory."""
    items = []
    for path in sorted(directory.glob('*.json')):
        with open(path) as f:
            items.append(json.load(f))
    return items


def build_related_names(activities: list[dict]) -> dict:
    """Build a slug -> display name map for related activity links."""
    return {a['slug']: a['name'] for a in activities}


def render_activity(env, page: dict, related_names: dict, output_root: Path, anon_key: str, upcoming_events: list[dict] | None = None):
    """Render one activity page and write to output_root/activities/{slug}/index.html."""
    template = env.get_template('activity.html')

    page = {**page}  # shallow copy to avoid mutating caller's dict
    page['content'] = {**page.get('content', {})}  # copy nested dict

    # Computed fields for the template
    page['canonical_path'] = f"activities/{page['slug']}"
    page['breadcrumb_section'] = 'Activities'
    page['breadcrumb_section_path'] = 'activities'
    if 'breadcrumb_label' not in page.get('content', {}):
        page['content']['breadcrumb_label'] = f"{page['name']} Calgary"

    # breadcrumb_label for base template
    page['breadcrumb_label'] = page['content']['breadcrumb_label']

    matched = []
    if upcoming_events:
        matched = [enrich_event_for_template(e) for e in match_events_to_activity(upcoming_events, page)]

    html = template.render(page=page, related_names=related_names, upcoming_events=matched, site_base_url=SITE_BASE_URL)
    # Inject actual anon key
    if 'REPLACED_BY_GENERATE_PY' not in html:
        print(f"  WARNING: anon key placeholder not found in {page['slug']} -- check activity.html template")
    html = html.replace('REPLACED_BY_GENERATE_PY', anon_key)

    out_dir = output_root / 'activities' / page['slug']
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'index.html').write_text(html, encoding='utf-8')
    print(f"  Generated: activities/{page['slug']}/index.html")


def render_guide(env, page: dict, related_names: dict, output_root: Path):
    """Render one guide page and write to output_root/guides/{slug}/index.html."""
    template = env.get_template('guide.html')

    page = {**page}
    page['content'] = {**page.get('content', {})}

    page['canonical_path'] = f"guides/{page['slug']}"
    page['breadcrumb_section'] = 'Guides'
    page['breadcrumb_section_path'] = 'guides'
    page['breadcrumb_label'] = page['content']['title']

    # Flatten faq from content if top-level faq is absent or empty
    if not page.get('faq') and 'faq' in page.get('content', {}):
        page['faq'] = page['content']['faq']

    html = template.render(page=page, related_names=related_names)

    out_dir = output_root / 'guides' / page['slug']
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'index.html').write_text(html, encoding='utf-8')
    print(f"  Generated: guides/{page['slug']}/index.html")


CATEGORY_LABELS = {
    'creative': 'Creative',
    'food-drink': 'Food & Drink',
    'games-social': 'Games & Social',
    'active-outdoors': 'Active & Outdoors',
    'learning-culture': 'Learning & Culture',
    'wellness': 'Wellness',
}


def render_activities_hub(env, activities: list[dict], output_root: Path):
    """Render the /activities/ hub index page."""
    template = env.get_template('activities-hub.html')

    # Group activities by category
    by_category: dict[str, list[dict]] = {}
    for a in activities:
        cat = a.get('category', 'other')
        by_category.setdefault(cat, []).append(a)

    # Build ordered list of (label, activities)
    categories = []
    for key, label in CATEGORY_LABELS.items():
        if key in by_category:
            categories.append((label, by_category[key]))
    # Catch any uncategorized
    for key, items in by_category.items():
        if key not in CATEGORY_LABELS:
            categories.append((key.replace('-', ' ').title(), items))

    page = {
        'meta': {
            'title': 'Things to Do in Calgary for Adults | Mixler Activities',
            'description': 'Browse fun activities for adults in Calgary. Paint nights, axe throwing, cooking classes, escape rooms, and more. All beginner-friendly.',
        },
        'og_image': 'images/mixler-logo-wide-color.png',
        'canonical_path': 'activities',
        'breadcrumb_section': 'Activities',
        'breadcrumb_section_path': 'activities',
        'breadcrumb_label': 'All Activities',
        'faq': None,
    }

    html = template.render(page=page, categories=categories)
    out_dir = output_root / 'activities'
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'index.html').write_text(html, encoding='utf-8')
    print("  Generated: activities/index.html (hub)")


def render_guides_hub(env, guides: list[dict], output_root: Path):
    """Render the /guides/ hub index page."""
    template = env.get_template('guides-hub.html')

    page = {
        'meta': {
            'title': 'Calgary Social Guides for Adults | Mixler',
            'description': 'Practical guides for making friends, finding fun, and getting the most out of Calgary social scene. Written by the Mixler team.',
        },
        'og_image': 'images/mixler-logo-wide-color.png',
        'canonical_path': 'guides',
        'breadcrumb_section': 'Guides',
        'breadcrumb_section_path': 'guides',
        'breadcrumb_label': 'All Guides',
        'faq': None,
    }

    html = template.render(page=page, guides=guides)
    out_dir = output_root / 'guides'
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'index.html').write_text(html, encoding='utf-8')
    print("  Generated: guides/index.html (hub)")


def write_sitemap(output_root: Path, activity_slugs: list[str], guide_slugs: list[str], upcoming_events: list[dict] | None = None):
    """Write sitemap.xml to output_root."""
    today = date.today().isoformat()
    urls = [
        f"  <url><loc>{SITE_BASE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>",
        f"  <url><loc>{SITE_BASE_URL}/events.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>",
        f"  <url><loc>{SITE_BASE_URL}/activities/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>",
        f"  <url><loc>{SITE_BASE_URL}/guides/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>",
    ]
    for slug in activity_slugs:
        urls.append(
            f"  <url><loc>{SITE_BASE_URL}/activities/{slug}/</loc>"
            f"<lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>"
        )
    for slug in guide_slugs:
        urls.append(
            f"  <url><loc>{SITE_BASE_URL}/guides/{slug}/</loc>"
            f"<lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>"
        )
    event_count = 0
    for event in upcoming_events or []:
        lastmod = (event.get('updated_at') or '')[:10] or today
        urls.append(
            f"  <url><loc>{SITE_BASE_URL}/event.html?slug={event['slug']}</loc>"
            f"<lastmod>{lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>"
        )
        event_count += 1
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += '\n'.join(urls) + '\n'
    sitemap += '</urlset>\n'
    (output_root / 'sitemap.xml').write_text(sitemap, encoding='utf-8')
    total = len(urls)
    print(f"  Created: sitemap.xml ({total} URLs, including {event_count} events)")


def write_robots_txt(output_root: Path):
    """Write robots.txt to output_root."""
    content = (
        "User-agent: *\n"
        "Allow: /\n"
        f"\nSitemap: {SITE_BASE_URL}/sitemap.xml\n"
    )
    (output_root / 'robots.txt').write_text(content, encoding='utf-8')
    print("  Created: robots.txt")


def generate_pages(
    activities: list[dict] | None = None,
    guides: list[dict] | None = None,
    output_root: Path | None = None,
    supabase_anon_key: str | None = None,
):
    """
    Core generation function. Can be called directly or via CLI.
    When called from CLI, loads data from disk. When called from tests, accepts data directly.
    """
    if output_root is None:
        output_root = REPO_ROOT
    if activities is None:
        activities = load_json_files(DATA_ACTIVITIES_DIR)
    if guides is None:
        guides = load_json_files(DATA_GUIDES_DIR)
    if supabase_anon_key is None:
        supabase_anon_key = load_env()

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(['html']),
    )

    related_names = build_related_names(activities)

    print("\nFetching upcoming events from Supabase...")
    upcoming_events = fetch_upcoming_events(supabase_anon_key)
    print(f"  Fetched {len(upcoming_events)} upcoming events")

    print(f"\nGenerating {len(activities)} activity pages...")
    for page in activities:
        render_activity(env, page, related_names, output_root, supabase_anon_key, upcoming_events)

    print(f"\nGenerating {len(guides)} guide pages...")
    for page in guides:
        render_guide(env, page, related_names, output_root)

    print("\nGenerating hub pages...")
    render_activities_hub(env, activities, output_root)
    render_guides_hub(env, guides, output_root)

    print("\nWriting sitemap and robots.txt...")
    write_sitemap(output_root, [a['slug'] for a in activities], [g['slug'] for g in guides], upcoming_events)
    write_robots_txt(output_root)

    total = len(activities) + len(guides)
    print(f"\nDone. {total} pages generated.\n")


if __name__ == '__main__':
    generate_pages()
