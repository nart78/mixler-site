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
from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape


SEO_DIR = Path(__file__).parent
REPO_ROOT = SEO_DIR.parent
TEMPLATES_DIR = SEO_DIR / 'templates'
DATA_ACTIVITIES_DIR = SEO_DIR / 'data' / 'activities'
DATA_GUIDES_DIR = SEO_DIR / 'data' / 'guides'
SITE_BASE_URL = 'https://www.mixler.ca'


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


def render_activity(env, page: dict, related_names: dict, output_root: Path, anon_key: str):
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

    html = template.render(page=page, related_names=related_names)
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


def write_sitemap(output_root: Path, activity_slugs: list[str], guide_slugs: list[str]):
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
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += '\n'.join(urls) + '\n'
    sitemap += '</urlset>\n'
    (output_root / 'sitemap.xml').write_text(sitemap, encoding='utf-8')
    print(f"  Created: sitemap.xml ({len(activity_slugs) + len(guide_slugs) + 2} URLs)")


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

    print(f"\nGenerating {len(activities)} activity pages...")
    for page in activities:
        render_activity(env, page, related_names, output_root, supabase_anon_key)

    print(f"\nGenerating {len(guides)} guide pages...")
    for page in guides:
        render_guide(env, page, related_names, output_root)

    print("\nGenerating hub pages...")
    render_activities_hub(env, activities, output_root)
    render_guides_hub(env, guides, output_root)

    print("\nWriting sitemap and robots.txt...")
    write_sitemap(output_root, [a['slug'] for a in activities], [g['slug'] for g in guides])
    write_robots_txt(output_root)

    total = len(activities) + len(guides)
    print(f"\nDone. {total} pages generated.\n")


if __name__ == '__main__':
    generate_pages()
