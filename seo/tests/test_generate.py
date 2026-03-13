"""Tests for seo/generate.py"""
import json
import os
import pytest
from pathlib import Path

# Fixtures directory
FIXTURES_DIR = Path(__file__).parent / 'fixtures'
SEO_DIR = Path(__file__).parent.parent
REPO_ROOT = SEO_DIR.parent


@pytest.fixture(autouse=True)
def fixture_dirs(tmp_path):
    """Create temp output dirs and point generator at them."""
    (tmp_path / 'activities').mkdir()
    (tmp_path / 'guides').mkdir()
    return tmp_path


SAMPLE_ACTIVITY = {
    "slug": "painting-calgary",
    "name": "Painting Events",
    "category": "creative",
    "category_slug": "painting",
    "og_image": "images/mixler-logo-wide-color.png",
    "tags": ["All Skill Levels", "Groups Welcome"],
    "meta": {
        "title": "Painting Events in Calgary | Mixler",
        "description": "Find group painting events in Calgary.",
        "keywords": ["painting events Calgary"]
    },
    "content": {
        "subtitle": "Group art nights for adults",
        "intro": "Painting events are fun.",
        "breadcrumb_label": "Painting Events Calgary",
        "what_to_expect": [
            {"icon": "🎨", "heading": "No Experience Needed", "body": "Anyone can join."}
        ],
        "tips": ["Wear old clothes."],
        "waitlist_heading": "Not seeing your date?",
        "waitlist_body": "Join the waitlist.",
        "related_activities": ["pottery-calgary"]
    },
    "faq": [
        {"q": "Do I need to bring anything?", "a": "Just yourself."}
    ]
}

SAMPLE_GUIDE = {
    "slug": "how-to-meet-people-calgary",
    "type": "authority",
    "og_image": "images/mixler-logo-wide-color.png",
    "meta": {
        "title": "How to Meet People in Calgary | Mixler",
        "description": "Real advice on meeting people in Calgary.",
        "keywords": ["how to meet people Calgary"]
    },
    "content": {
        "title": "How to Meet People in Calgary",
        "subtitle": "Real talk from the Mixler team.",
        "read_time": "5 min read",
        "updated_date": "March 2026",
        "intro": "Making friends as an adult is hard.",
        "sections": [
            {
                "label": "The Problem",
                "heading": "Why It's Hard",
                "paragraphs": ["Calgary is transient."],
                "tip_box": {"label": "Key insight", "body": "Structured settings work better."}
            }
        ],
        "mixler_cta": {
            "heading": "That's what Mixler does.",
            "body": "Small group events in Calgary.",
            "button_text": "See Upcoming Events"
        },
        "related_activities": ["painting-calgary"],
        "sidebar_cta": {
            "heading": "Ready to get out there?",
            "body": "Mixler runs events every month.",
            "button_text": "Browse Events"
        },
        "faq": [
            {"q": "Is Calgary friendly for newcomers?", "a": "Generally yes."}
        ]
    }
}


def run_generator(activity_data, guide_data, output_dir):
    """Import and run generate.py against fixture data."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("generate", SEO_DIR / "generate.py")
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    gen.generate_pages(
        activities=[activity_data],
        guides=[guide_data],
        output_root=output_dir,
        supabase_anon_key='test-anon-key',
    )


def test_activity_page_generates(tmp_path):
    """Activity page HTML file is created at the correct path."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    out = tmp_path / 'activities' / 'painting-calgary' / 'index.html'
    assert out.exists(), "Activity page not created"


def test_activity_page_contains_title(tmp_path):
    """Activity page has correct <title> tag."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    html = (tmp_path / 'activities' / 'painting-calgary' / 'index.html').read_text()
    assert 'Painting Events in Calgary | Mixler' in html


def test_activity_page_contains_events_slot(tmp_path):
    """Activity page has #events-slot with correct data-category-slug."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    html = (tmp_path / 'activities' / 'painting-calgary' / 'index.html').read_text()
    assert 'id="events-slot"' in html
    assert 'data-category-slug="painting"' in html


def test_activity_page_contains_faq_schema(tmp_path):
    """Activity page has FAQ schema JSON-LD."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    html = (tmp_path / 'activities' / 'painting-calgary' / 'index.html').read_text()
    assert '"@type": "FAQPage"' in html
    assert 'Do I need to bring anything?' in html


def test_activity_page_contains_anon_key(tmp_path):
    """Activity page has Supabase anon key injected (not the placeholder string)."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    html = (tmp_path / 'activities' / 'painting-calgary' / 'index.html').read_text()
    assert 'test-anon-key' in html
    assert 'REPLACED_BY_GENERATE_PY' not in html


def test_guide_page_generates(tmp_path):
    """Guide page HTML file is created at the correct path."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    out = tmp_path / 'guides' / 'how-to-meet-people-calgary' / 'index.html'
    assert out.exists(), "Guide page not created"


def test_guide_page_contains_title(tmp_path):
    """Guide page has correct <title> tag."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    html = (tmp_path / 'guides' / 'how-to-meet-people-calgary' / 'index.html').read_text()
    assert 'How to Meet People in Calgary | Mixler' in html


def test_sitemap_created(tmp_path):
    """sitemap.xml is created and contains activity and guide URLs."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    sitemap = (tmp_path / 'sitemap.xml').read_text()
    assert 'painting-calgary' in sitemap
    assert 'how-to-meet-people-calgary' in sitemap


def test_robots_txt_created(tmp_path):
    """robots.txt is created and references sitemap."""
    run_generator(SAMPLE_ACTIVITY, SAMPLE_GUIDE, tmp_path)
    robots = (tmp_path / 'robots.txt').read_text()
    assert 'Sitemap:' in robots
    assert 'sitemap.xml' in robots
