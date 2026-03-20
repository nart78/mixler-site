# Mixler pSEO Pages Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ~96 programmatic SEO pages for mixler.ca -- activity pages and guide pages -- with static HTML generated from JSON data files, live Supabase event injection, and an activity waitlist system backed by Supabase and MailerLite.

**Architecture:** Python/Jinja2 generator reads JSON content files from `seo/data/` and renders static HTML pages into `activities/` and `guides/` directories. Activity pages inject live Mixler events via client-side JS using a Supabase PostgREST join. When no events exist, a waitlist form POSTs to a new Supabase Edge Function that writes to a Supabase table and subscribes the user to a per-activity MailerLite group.

**Tech Stack:** Python 3.12, Jinja2 3.1, pytest 9.0, Supabase (PostgREST + Edge Functions Deno), MailerLite API v3, vanilla JS (ES modules, same pattern as existing site)

---

## File Map

### New files to create

| File | Responsibility |
|---|---|
| `seo/templates/_base.html` | Shared Jinja2 base: head, nav placeholder, footer placeholder, CSS links |
| `seo/templates/activity.html` | Activity page template extending _base.html |
| `seo/templates/guide.html` | Guide page template extending _base.html |
| `seo/generate.py` | Reads all JSON from `seo/data/`, renders templates, writes HTML pages, creates sitemap.xml and robots.txt |
| `seo/tests/test_generate.py` | pytest tests for the generator |
| `js/pseo-activity.js` | Client-side JS: Supabase event injection + waitlist form submission for activity pages |
| `supabase/migrations/005_activity_waitlist.sql` | Creates `activity_waitlist` and `activity_waitlist_groups` tables with RLS policies |
| `supabase/functions/join-activity-waitlist/index.ts` | Edge function: validates email, writes to DB, creates/reuses MailerLite group, subscribes user |
| `seo/data/activities/painting.json` | Content for painting events page |
| `seo/data/activities/pottery.json` | Content for pottery classes page |
| ... (69 more activity JSON files) | One per activity in taxonomy |
| `seo/data/guides/how-to-meet-people-calgary.json` | Content for guide page |
| ... (24 more guide JSON files) | One per guide in taxonomy |

### Files to modify

| File | Change |
|---|---|
| `CLAUDE.md` | Update rsync command to add `--exclude='seo'` |

---

## Chunk 1: Generator Infrastructure

Templates, generator script, client-side JS, and tests. No content files yet -- tests use fixture JSON.

---

### Task 1: Supabase client config reference

The generator and templates need the Supabase URL and anon key. These are already in `js/supabase-client.js`. The pSEO templates will read them from `.env` at generation time (baked into HTML) for the anon key only.

- [ ] **Step 1.1: Read `.env` to confirm env var names**

```bash
cat ~/mixler-site/.env
```

Expected: file contains `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

---

### Task 2: Base Jinja2 template

- [ ] **Step 2.1: Create `seo/` directory structure**

```bash
mkdir -p ~/mixler-site/seo/templates
mkdir -p ~/mixler-site/seo/data/activities
mkdir -p ~/mixler-site/seo/data/guides
mkdir -p ~/mixler-site/seo/tests
```

- [ ] **Step 2.2: Write `seo/templates/_base.html`**

Create `~/mixler-site/seo/templates/_base.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ page.meta.title }}</title>
  <meta name="description" content="{{ page.meta.description }}">
  <link rel="canonical" href="https://mixler.ca/{{ page.canonical_path }}/">

  <!-- OG Tags -->
  <meta property="og:title" content="{{ page.meta.title }}">
  <meta property="og:description" content="{{ page.meta.description }}">
  <meta property="og:image" content="https://mixler.ca/{{ page.og_image }}">
  <meta property="og:url" content="https://mixler.ca/{{ page.canonical_path }}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Mixler">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{ page.meta.title }}">
  <meta name="twitter:description" content="{{ page.meta.description }}">
  <meta name="twitter:image" content="https://mixler.ca/{{ page.og_image }}">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=League+Spartan:wght@400;500;600;700;800;900&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">

  <!-- CSS -->
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/css/home.css">
  <link rel="stylesheet" href="/css/pseo.css">

  <!-- Supabase -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

  <!-- BreadcrumbList Schema -->
  {% autoescape false %}
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://mixler.ca/" },
      { "@type": "ListItem", "position": 2, "name": {{ page.breadcrumb_section | tojson }}, "item": "https://mixler.ca/{{ page.breadcrumb_section_path }}/" },
      { "@type": "ListItem", "position": 3, "name": {{ page.breadcrumb_label | tojson }}, "item": "https://mixler.ca/{{ page.canonical_path }}/" }
    ]
  }
  </script>
  {% endautoescape %}

  <!-- FAQ Schema -->
  {% if page.faq %}
  {% autoescape false %}
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {% for item in page.faq %}
      {
        "@type": "Question",
        "name": {{ item.q | tojson }},
        "acceptedAnswer": { "@type": "Answer", "text": {{ item.a | tojson }} }
      }{% if not loop.last %},{% endif %}
      {% endfor %}
    ]
  }
  </script>
  {% endautoescape %}
  {% endif %}
</head>
<body class="dark-body">

  <div id="site-nav"></div>

  {% block content %}{% endblock %}

  <div id="site-footer"></div>

  <script type="module">
    import { renderNav, renderFooter } from '/js/components.js';
    renderNav('events', { headerClass: 'dark-header' });
    renderFooter();
  </script>

  {% block page_scripts %}{% endblock %}

</body>
</html>
```

---

### Task 3: Activity page Jinja2 template

- [ ] **Step 3.1: Write `seo/templates/activity.html`**

Create `~/mixler-site/seo/templates/activity.html`:

```html
{% extends "_base.html" %}

{% block content %}
<!-- Breadcrumb -->
<div class="pseo-breadcrumb">
  <div class="container">
    <div class="pseo-breadcrumb-inner">
      <a href="/">Home</a>
      <span>›</span>
      <a href="/activities/">Activities</a>
      <span>›</span>
      <span>{{ page.content.breadcrumb_label }}</span>
    </div>
  </div>
</div>

<!-- Hero -->
<div class="pseo-hero pseo-hero--activity">
  <div class="container">
    <div class="pseo-hero-eyebrow"><span class="pseo-eyebrow-dot"></span> Calgary Activity Guide</div>
    <h1>{{ page.name }} in Calgary</h1>
    <p class="pseo-hero-subtitle">{{ page.content.subtitle }}</p>
    <div class="pseo-hero-tags">
      {% for tag in page.tags %}
      <span class="pseo-hero-tag">{{ tag }}</span>
      {% endfor %}
    </div>
  </div>
</div>

<!-- Body -->
<div class="pseo-body">
  <div class="container">
    <div class="pseo-grid">

      <!-- Main column -->
      <div class="pseo-main">

        <p class="pseo-intro">{{ page.content.intro }}</p>

        <!-- Events slot: injected by pseo-activity.js -->
        <div id="events-slot" data-category-slug="{{ page.category_slug }}" data-activity-name="{{ page.name }}"></div>

        <!-- What to Expect -->
        <div class="pseo-section-label">What It's Like</div>
        <h2 class="pseo-section-title">What to Expect</h2>
        <div class="pseo-expect-grid">
          {% for item in page.content.what_to_expect %}
          <div class="pseo-expect-card">
            <div class="pseo-expect-icon">{{ item.icon }}</div>
            <h4>{{ item.heading }}</h4>
            <p>{{ item.body }}</p>
          </div>
          {% endfor %}
        </div>

        <!-- Tips -->
        <div class="pseo-section-label">Insider Advice</div>
        <h2 class="pseo-section-title">Tips for Your First {{ page.name }} Event</h2>
        <ul class="pseo-tips-list">
          {% for tip in page.content.tips %}
          <li>
            <span class="pseo-tip-num">{{ loop.index }}</span>
            {{ tip }}
          </li>
          {% endfor %}
        </ul>

        <!-- FAQ -->
        <div class="pseo-section-label">Common Questions</div>
        <h2 class="pseo-section-title">FAQ</h2>
        {% for item in page.faq %}
        <div class="pseo-faq-item">
          <div class="pseo-faq-q">{{ item.q }} <span>+</span></div>
          <div class="pseo-faq-a">{{ item.a }}</div>
        </div>
        {% endfor %}

      </div>

      <!-- Sidebar -->
      <div class="pseo-sidebar">
        <div class="pseo-sidebar-card">
          <h3>{{ page.content.waitlist_heading }}</h3>
          <p>{{ page.content.waitlist_body }}</p>
          <a href="/events.html" class="pseo-btn-white">Browse All Events</a>
        </div>

        <div class="pseo-related-card">
          <h4>Similar Activities</h4>
          {% for slug in page.content.related_activities %}
          <a href="/activities/{{ slug }}/" class="pseo-related-link">
            {{ related_names[slug] if related_names and slug in related_names else slug | replace('-calgary', '') | replace('-', ' ') | title }}
            <span class="pseo-related-arrow">›</span>
          </a>
          {% endfor %}
        </div>
      </div>

    </div>
  </div>
</div>
{% endblock %}

{% block page_scripts %}
<script type="module" src="/js/pseo-activity.js"></script>
{% endblock %}
```

---

### Task 4: Guide page Jinja2 template

- [ ] **Step 4.1: Write `seo/templates/guide.html`**

Create `~/mixler-site/seo/templates/guide.html`:

```html
{% extends "_base.html" %}

{% block content %}
<!-- Breadcrumb -->
<div class="pseo-breadcrumb">
  <div class="container">
    <div class="pseo-breadcrumb-inner">
      <a href="/">Home</a>
      <span>›</span>
      <a href="/guides/">Guides</a>
      <span>›</span>
      <span>{{ page.content.title }}</span>
    </div>
  </div>
</div>

<!-- Hero -->
<div class="pseo-hero pseo-hero--guide">
  <div class="container">
    <div class="pseo-hero-eyebrow"><span class="pseo-eyebrow-dot"></span> Mixler Guide</div>
    <h1>{{ page.content.title }}</h1>
    <p class="pseo-hero-subtitle">{{ page.content.subtitle }}</p>
    <div class="pseo-hero-meta">
      <span>{{ page.content.read_time }}</span>
      <span>·</span>
      <span>By <strong>the Mixler Team</strong></span>
      <span>·</span>
      <span>Updated <strong>{{ page.content.updated_date }}</strong></span>
    </div>
  </div>
</div>

<!-- Body -->
<div class="pseo-body">
  <div class="container">
    <div class="pseo-grid">

      <!-- Main column -->
      <div class="pseo-main">

        <p class="pseo-guide-intro">{{ page.content.intro }}</p>

        {% for section in page.content.sections %}
        <div class="pseo-guide-section" id="section-{{ loop.index }}">
          <div class="pseo-section-label">{{ section.label }}</div>
          <h2>{{ section.heading }}</h2>
          {% for para in section.paragraphs %}
          <p>{{ para }}</p>
          {% endfor %}
          {% if section.tip_box %}
          <div class="pseo-tip-box">
            <div class="pseo-tip-box-label">{{ section.tip_box.label }}</div>
            <p>{{ section.tip_box.body }}</p>
          </div>
          {% endif %}
        </div>

        {% if loop.index == 2 %}
        <!-- Inline Mixler CTA (after second section) -->
        <div class="pseo-mixler-cta">
          <div class="pseo-mixler-cta-text">
            <h3>{{ page.content.mixler_cta.heading }}</h3>
            <p>{{ page.content.mixler_cta.body }}</p>
          </div>
          <a href="/events.html" class="pseo-btn-pink">{{ page.content.mixler_cta.button_text }}</a>
        </div>
        {% endif %}

        {% endfor %}

        <!-- Related Activities -->
        <h3 class="pseo-related-heading">Calgary Activities Worth Trying</h3>
        <div class="pseo-related-grid">
          {% for slug in page.content.related_activities %}
          <a href="/activities/{{ slug }}/" class="pseo-related-activity">
            {{ related_names[slug] if related_names and slug in related_names else slug | replace('-calgary', '') | replace('-', ' ') | title }}
            <span>›</span>
          </a>
          {% endfor %}
        </div>

        <!-- FAQ -->
        <div class="pseo-section-label">Common Questions</div>
        <h2 class="pseo-section-title" style="margin-bottom:8px">FAQ</h2>
        {% for item in page.faq %}
        <div class="pseo-faq-item">
          <div class="pseo-faq-q">{{ item.q }} <em>+</em></div>
          <div class="pseo-faq-a">{{ item.a }}</div>
        </div>
        {% endfor %}

      </div>

      <!-- Sidebar -->
      <div class="pseo-sidebar">

        <!-- Table of Contents -->
        <div class="pseo-toc-card">
          <h4>In This Guide</h4>
          {% for section in page.content.sections %}
          <a href="#section-{{ loop.index }}" class="pseo-toc-link">
            <span class="pseo-toc-num">0{{ loop.index }}</span>
            {{ section.heading }}
          </a>
          {% endfor %}
        </div>

        <div class="pseo-sidebar-card">
          <h3>{{ page.content.sidebar_cta.heading }}</h3>
          <p>{{ page.content.sidebar_cta.body }}</p>
          <a href="/events.html" class="pseo-btn-white">{{ page.content.sidebar_cta.button_text }}</a>
        </div>

      </div>

    </div>
  </div>
</div>
{% endblock %}
```

---

### Task 5: CSS for pSEO pages

- [ ] **Step 5.1: Create `css/pseo.css`**

Create `~/mixler-site/css/pseo.css` with all styles needed by both page types. These match the approved mockups exactly.

```css
/* =============================================
   Mixler pSEO Pages
   Activity pages + Guide pages
   ============================================= */

/* Breadcrumb */
.pseo-breadcrumb { background: #f5f5f7; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
.pseo-breadcrumb-inner { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: #6b7280; }
.pseo-breadcrumb-inner a { color: #153db6; font-weight: 500; }
.pseo-breadcrumb-inner span { color: #9ca3af; }

/* Hero shared */
.pseo-hero { padding: 56px 0 60px; position: relative; overflow: hidden; }
.pseo-hero-eyebrow { display: inline-flex; align-items: center; gap: 8px; color: #ff3465; font-size: 0.85rem; font-weight: 600; font-style: italic; margin-bottom: 16px; }
.pseo-eyebrow-dot { width: 8px; height: 8px; background: #ff3465; border-radius: 50%; display: inline-block; }
.pseo-hero h1 { font-family: 'League Spartan', sans-serif; font-size: 3rem; font-weight: 800; letter-spacing: -1px; margin-bottom: 16px; }
.pseo-hero-subtitle { font-size: 1.05rem; max-width: 560px; line-height: 1.7; }

/* Activity hero */
.pseo-hero--activity { background: #153db6; }
.pseo-hero--activity::before { content: ''; position: absolute; top: -80px; right: -80px; width: 320px; height: 320px; background: rgba(255,52,101,0.08); border-radius: 50%; }
.pseo-hero--activity h1 { color: #fff; }
.pseo-hero--activity .pseo-hero-subtitle { color: rgba(255,255,255,0.7); }
.pseo-hero-tags { display: flex; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
.pseo-hero-tag { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.85); padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 500; }

/* Guide hero */
.pseo-hero--guide { background: #0f1a3d; }
.pseo-hero--guide::before { content: ''; position: absolute; top: 0; left: 0; width: 5px; height: 100%; background: #ff3465; }
.pseo-hero--guide::after { content: ''; position: absolute; top: -100px; right: -80px; width: 360px; height: 360px; background: rgba(21,61,182,0.25); border-radius: 50%; }
.pseo-hero--guide h1 { color: #fff; font-size: 2.8rem; max-width: 600px; }
.pseo-hero--guide .pseo-hero-subtitle { color: rgba(255,255,255,0.65); font-size: 1rem; }
.pseo-hero-meta { display: flex; align-items: center; gap: 20px; margin-top: 24px; color: rgba(255,255,255,0.55); font-size: 0.8rem; }
.pseo-hero-meta strong { color: rgba(255,255,255,0.85); }

/* Body layout */
.pseo-body { padding: 56px 0 80px; }
.pseo-grid { display: grid; grid-template-columns: 1fr 320px; gap: 48px; }

/* Main column */
.pseo-intro { font-size: 1.05rem; color: #4b5563; line-height: 1.8; margin-bottom: 48px; }
.pseo-guide-intro { font-size: 1.05rem; color: #4b5563; line-height: 1.85; margin-bottom: 48px; border-left: 3px solid #ff3465; padding-left: 20px; }
.pseo-section-label { font-family: 'League Spartan', sans-serif; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #ff3465; margin-bottom: 8px; }
.pseo-section-title { font-size: 1.8rem; font-weight: 800; color: #153db6; margin-bottom: 24px; }

/* What to Expect */
.pseo-expect-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 48px; }
.pseo-expect-card { background: #f9fafb; border-radius: 12px; padding: 20px; border: 1px solid #e5e7eb; }
.pseo-expect-icon { font-size: 1.5rem; margin-bottom: 10px; }
.pseo-expect-card h4 { font-family: 'League Spartan', sans-serif; font-size: 1rem; font-weight: 700; color: #153db6; margin-bottom: 6px; }
.pseo-expect-card p { font-size: 0.85rem; color: #6b7280; line-height: 1.6; }

/* Tips */
.pseo-tips-list { list-style: none; margin-bottom: 48px; }
.pseo-tips-list li { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid #f3f4f6; font-size: 0.92rem; color: #4b5563; align-items: flex-start; }
.pseo-tips-list li:last-child { border-bottom: none; }
.pseo-tip-num { background: #153db6; color: #fff; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; flex-shrink: 0; margin-top: 1px; font-family: 'League Spartan', sans-serif; }

/* FAQ */
.pseo-faq-item { border-bottom: 1px solid #e5e7eb; padding: 18px 0; }
.pseo-faq-q { font-family: 'League Spartan', sans-serif; font-size: 1rem; font-weight: 700; color: #1f2937; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
.pseo-faq-q span, .pseo-faq-q em { color: #153db6; font-size: 1.2rem; font-style: normal; }
.pseo-faq-a { font-size: 0.88rem; color: #6b7280; margin-top: 10px; line-height: 1.7; }

/* Guide sections */
.pseo-guide-section { margin-bottom: 48px; }
.pseo-guide-section h2 { font-size: 1.7rem; font-weight: 800; color: #153db6; margin-bottom: 16px; }
.pseo-guide-section p { font-size: 0.95rem; color: #4b5563; line-height: 1.8; margin-bottom: 14px; }
.pseo-tip-box { background: #f0f4ff; border: 1px solid #c7d4ff; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
.pseo-tip-box-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #153db6; margin-bottom: 8px; }
.pseo-tip-box p { font-size: 0.88rem; color: #374151; margin: 0; line-height: 1.7; }

/* Guide inline Mixler CTA */
.pseo-mixler-cta { background: linear-gradient(135deg, #153db6, #1a4fd6); border-radius: 16px; padding: 28px 32px; margin: 32px 0; display: flex; align-items: center; gap: 24px; }
.pseo-mixler-cta-text h3 { font-family: 'League Spartan', sans-serif; font-size: 1.2rem; font-weight: 800; color: #fff; margin-bottom: 6px; }
.pseo-mixler-cta-text p { font-size: 0.85rem; color: rgba(255,255,255,0.7); margin: 0; }
.pseo-btn-pink { background: #ff3465; color: #fff; padding: 10px 22px; border-radius: 24px; font-weight: 700; font-size: 0.85rem; font-family: 'League Spartan', sans-serif; white-space: nowrap; flex-shrink: 0; display: inline-block; }

/* Related activities (guide) */
.pseo-related-heading { font-size: 1.3rem; font-weight: 800; color: #153db6; margin-bottom: 20px; }
.pseo-related-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 48px; }
.pseo-related-activity { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; display: flex; align-items: center; justify-content: space-between; font-size: 0.88rem; font-weight: 600; color: #153db6; }
.pseo-related-activity:hover { background: #f0f4ff; border-color: #c7d4ff; }

/* Sidebar */
.pseo-sidebar-card { background: #ff3465; border-radius: 16px; padding: 28px; color: #fff; margin-bottom: 24px; }
.pseo-sidebar-card h3 { font-family: 'League Spartan', sans-serif; font-size: 1.3rem; font-weight: 800; color: #fff; margin-bottom: 10px; }
.pseo-sidebar-card p { font-size: 0.85rem; color: rgba(255,255,255,0.75); line-height: 1.6; margin-bottom: 20px; }
.pseo-btn-white { display: block; background: #fff; color: #ff3465; text-align: center; padding: 12px; border-radius: 24px; font-weight: 700; font-size: 0.88rem; font-family: 'League Spartan', sans-serif; }

/* Related activities sidebar (activity pages) */
.pseo-related-card { background: #f9fafb; border-radius: 12px; padding: 16px; border: 1px solid #e5e7eb; }
.pseo-related-card h4 { font-family: 'League Spartan', sans-serif; font-size: 0.9rem; font-weight: 700; color: #153db6; margin-bottom: 12px; }
.pseo-related-link { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 0.85rem; color: #4b5563; font-weight: 500; }
.pseo-related-link:last-child { border-bottom: none; }
.pseo-related-link:hover { color: #153db6; }
.pseo-related-arrow { color: #153db6; }

/* TOC card (guide sidebar) */
.pseo-toc-card { background: #f9fafb; border-radius: 12px; padding: 20px; border: 1px solid #e5e7eb; margin-bottom: 24px; }
.pseo-toc-card h4 { font-family: 'League Spartan', sans-serif; font-size: 0.88rem; font-weight: 700; color: #153db6; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 1px; }
.pseo-toc-link { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 0.83rem; color: #4b5563; align-items: flex-start; }
.pseo-toc-link:last-child { border-bottom: none; }
.pseo-toc-link:hover { color: #153db6; }
.pseo-toc-num { color: #153db6; font-weight: 700; font-family: 'League Spartan', sans-serif; font-size: 0.8rem; flex-shrink: 0; }

/* Events slot: states */
.pseo-events-loading { padding: 24px; text-align: center; color: #9ca3af; font-size: 0.9rem; }
.pseo-events-live { background: #f0f4ff; border: 1px solid #c7d4ff; border-radius: 16px; padding: 28px; margin-bottom: 48px; }
.pseo-events-live-label { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; font-weight: 600; color: #153db6; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
.pseo-live-dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; animation: pseo-pulse 2s infinite; }
@keyframes pseo-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.pseo-event-card { background: #fff; border-radius: 12px; padding: 20px; display: flex; align-items: center; gap: 16px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); border: 1px solid #e5e7eb; }
.pseo-event-date { background: #153db6; color: #fff; border-radius: 8px; padding: 8px 12px; text-align: center; min-width: 52px; }
.pseo-event-date .day { font-family: 'League Spartan', sans-serif; font-size: 1.4rem; font-weight: 800; line-height: 1; }
.pseo-event-date .month { font-size: 0.7rem; font-weight: 600; opacity: 0.85; text-transform: uppercase; margin-top: 2px; }
.pseo-event-info h4 { font-size: 0.95rem; font-weight: 600; color: #1f2937; font-family: 'Inter', sans-serif; margin-bottom: 4px; }
.pseo-event-info p { font-size: 0.8rem; color: #6b7280; }
.pseo-event-price { margin-left: auto; font-family: 'League Spartan', sans-serif; font-size: 1.1rem; font-weight: 700; color: #153db6; }
.pseo-events-cta { margin-top: 16px; display: flex; gap: 12px; flex-wrap: wrap; }

/* Waitlist form */
.pseo-waitlist { background: #f0f4ff; border: 1px solid #c7d4ff; border-radius: 16px; padding: 28px; margin-bottom: 48px; }
.pseo-waitlist h3 { font-family: 'League Spartan', sans-serif; font-size: 1.3rem; color: #153db6; margin-bottom: 8px; }
.pseo-waitlist p { font-size: 0.9rem; color: #4b5563; margin-bottom: 20px; }
.pseo-waitlist-form { display: flex; gap: 10px; }
.pseo-waitlist-input { flex: 1; padding: 12px 16px; border: 1px solid #c7d4ff; border-radius: 8px; font-size: 0.9rem; font-family: 'Inter', sans-serif; outline: none; }
.pseo-waitlist-input:focus { border-color: #153db6; }
.pseo-waitlist-btn { background: #153db6; color: #fff; padding: 12px 20px; border-radius: 8px; font-weight: 600; font-size: 0.88rem; font-family: 'League Spartan', sans-serif; border: none; cursor: pointer; white-space: nowrap; }
.pseo-waitlist-btn:hover { background: #1a4fd6; }
.pseo-waitlist-success { color: #16a34a; font-size: 0.9rem; font-weight: 600; margin-top: 12px; }
.pseo-waitlist-error { color: #dc2626; font-size: 0.85rem; margin-top: 8px; }

/* Responsive */
@media (max-width: 768px) {
  .pseo-grid { grid-template-columns: 1fr; }
  .pseo-sidebar { order: -1; }
  .pseo-expect-grid { grid-template-columns: 1fr; }
  .pseo-related-grid { grid-template-columns: 1fr; }
  .pseo-hero h1 { font-size: 2.2rem; }
  .pseo-hero--guide h1 { font-size: 2rem; }
  .pseo-mixler-cta { flex-direction: column; }
  .pseo-waitlist-form { flex-direction: column; }
}
```

---

### Task 6: Client-side JS for activity pages

- [ ] **Step 6.1: Write `js/pseo-activity.js`**

Create `~/mixler-site/js/pseo-activity.js`:

```javascript
// pseo-activity.js
// Handles two jobs on activity pSEO pages:
// 1. Inject live Mixler events from Supabase into #events-slot
// 2. Handle waitlist form submission

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://dnuygqdmzjswroyzvkjb.supabase.co';
const SUPABASE_ANON_KEY = 'REPLACED_BY_GENERATE_PY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function initEventsSlot() {
  const slot = document.getElementById('events-slot');
  if (!slot) return;

  const categorySlug = slot.dataset.categorySlug;
  const activityName = slot.dataset.activityName;
  if (!categorySlug) return;

  slot.innerHTML = '<div class="pseo-events-loading">Loading upcoming events...</div>';

  const today = new Date().toISOString().split('T')[0];

  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, event_date, start_time, end_time, location_name, price_cents, tickets_sold, capacity, slug, event_categories!inner(slug)')
    .eq('event_categories.slug', categorySlug)
    .eq('status', 'published')
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .limit(3);

  if (error) {
    console.error('pseo-activity: events fetch error', error);
    renderWaitlist(slot, activityName, categorySlug);
    return;
  }

  if (!events || events.length === 0) {
    renderWaitlist(slot, activityName, categorySlug);
    return;
  }

  renderEvents(slot, events);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    day: d.getDate(),
    month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
  };
}

function formatPrice(cents) {
  if (!cents) return 'Free';
  return '$' + (cents / 100).toFixed(0);
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function renderEvents(slot, events) {
  const cards = events.map(ev => {
    const { day, month } = formatDate(ev.event_date);
    const spotsLeft = ev.capacity - (ev.tickets_sold || 0);
    const timeStr = ev.start_time ? `${formatTime(ev.start_time)}${ev.end_time ? ' – ' + formatTime(ev.end_time) : ''}` : '';
    return `
      <div class="pseo-event-card">
        <div class="pseo-event-date">
          <div class="day">${day}</div>
          <div class="month">${month}</div>
        </div>
        <div class="pseo-event-info">
          <h4>${ev.title}</h4>
          <p>${ev.location_name || ''}${timeStr ? ' · ' + timeStr : ''}${spotsLeft > 0 && spotsLeft <= 20 ? ' · ' + spotsLeft + ' spots left' : ''}</p>
        </div>
        <div class="pseo-event-price">${formatPrice(ev.price_cents)}</div>
      </div>
    `;
  }).join('');

  slot.innerHTML = `
    <div class="pseo-section-label">Upcoming in Calgary</div>
    <h2 class="pseo-section-title">Mixler Events</h2>
    <div class="pseo-events-live">
      <div class="pseo-events-live-label">
        <span class="pseo-live-dot"></span> Live events
      </div>
      ${cards}
      <div class="pseo-events-cta">
        <a href="/events.html" class="pseo-btn-pink" style="text-decoration:none">Grab Your Spot</a>
        <a href="/events.html" style="border:2px solid #153db6;color:#153db6;padding:10px 24px;border-radius:28px;font-weight:600;font-size:0.88rem;font-family:'League Spartan',sans-serif;text-decoration:none">See All Events</a>
      </div>
    </div>
  `;
}

function renderWaitlist(slot, activityName, categorySlug) {
  slot.innerHTML = `
    <div class="pseo-section-label">Stay in the Loop</div>
    <h2 class="pseo-section-title">No Events Right Now</h2>
    <div class="pseo-waitlist">
      <h3>Want to know when we run ${activityName} events?</h3>
      <p>Join the waitlist and we'll email you when we add one. We use this to plan what events to run next.</p>
      <form class="pseo-waitlist-form" id="waitlist-form">
        <input type="email" class="pseo-waitlist-input" placeholder="your@email.com" required>
        <button type="submit" class="pseo-waitlist-btn">Join Waitlist</button>
      </form>
      <div id="waitlist-msg"></div>
    </div>
  `;

  document.getElementById('waitlist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = e.target.querySelector('input[type=email]').value.trim();
    const btn = e.target.querySelector('button');
    const msg = document.getElementById('waitlist-msg');

    btn.disabled = true;
    btn.textContent = 'Joining...';
    msg.innerHTML = '';

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/join-activity-waitlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email, activity_slug: categorySlug, activity_name: activityName }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        msg.innerHTML = '<div class="pseo-waitlist-success">You\'re on the list! We\'ll email you when we add this event.</div>';
        e.target.style.display = 'none';
      } else {
        msg.innerHTML = `<div class="pseo-waitlist-error">${data.error || 'Something went wrong. Try again.'}</div>`;
        btn.disabled = false;
        btn.textContent = 'Join Waitlist';
      }
    } catch (err) {
      msg.innerHTML = '<div class="pseo-waitlist-error">Something went wrong. Try again.</div>';
      btn.disabled = false;
      btn.textContent = 'Join Waitlist';
    }
  });
}

initEventsSlot();
```

**Note:** `REPLACED_BY_GENERATE_PY` is a literal placeholder that `generate.py` replaces with the actual anon key read from `.env` when generating each activity page's HTML. The key is not stored in this JS source file.

---

### Task 7: Generator script

- [ ] **Step 7.1: Write the failing test first**

Create `~/mixler-site/seo/tests/test_generate.py`:

```python
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
        }
    },
    "faq": [
        {"q": "Is Calgary friendly for newcomers?", "a": "Generally yes."}
    ]
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
```

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
cd ~/mixler-site && python3 -m pytest seo/tests/test_generate.py -v 2>&1 | head -30
```

Expected: All tests FAIL with ImportError or ModuleNotFoundError (generate.py doesn't exist yet).

- [ ] **Step 7.3: Write `seo/generate.py`**

Create `~/mixler-site/seo/generate.py`:

```python
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
SITE_BASE_URL = 'https://mixler.ca'


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

    # Computed fields for the template
    page['canonical_path'] = f"activities/{page['slug']}"
    page['breadcrumb_section'] = 'Activities'
    page['breadcrumb_section_path'] = 'activities'
    if 'breadcrumb_label' not in page.get('content', {}):
        page['content']['breadcrumb_label'] = f"{page['name']} Calgary"

    html = template.render(page=page, related_names=related_names)
    # Inject actual anon key
    html = html.replace('REPLACED_BY_GENERATE_PY', anon_key)

    out_dir = output_root / 'activities' / page['slug']
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'index.html').write_text(html, encoding='utf-8')
    print(f"  Generated: activities/{page['slug']}/index.html")


def render_guide(env, page: dict, related_names: dict, output_root: Path):
    """Render one guide page and write to output_root/guides/{slug}/index.html."""
    template = env.get_template('guide.html')

    page['canonical_path'] = f"guides/{page['slug']}"
    page['breadcrumb_section'] = 'Guides'
    page['breadcrumb_section_path'] = 'guides'

    # Flatten faq from content if top-level faq is absent or empty
    if not page.get('faq') and 'faq' in page.get('content', {}):
        page['faq'] = page['content']['faq']

    html = template.render(page=page, related_names=related_names)

    out_dir = output_root / 'guides' / page['slug']
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'index.html').write_text(html, encoding='utf-8')
    print(f"  Generated: guides/{page['slug']}/index.html")


def write_sitemap(output_root: Path, activity_slugs: list[str], guide_slugs: list[str]):
    """Write sitemap.xml to output_root."""
    today = date.today().isoformat()
    urls = [
        f"  <url><loc>{SITE_BASE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>",
        f"  <url><loc>{SITE_BASE_URL}/events.html</loc><changefreq>daily</changefreq><priority>0.9</priority></url>",
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

    print("\nWriting sitemap and robots.txt...")
    write_sitemap(output_root, [a['slug'] for a in activities], [g['slug'] for g in guides])
    write_robots_txt(output_root)

    total = len(activities) + len(guides)
    print(f"\nDone. {total} pages generated.\n")


if __name__ == '__main__':
    generate_pages()
```

- [ ] **Step 7.4: Run tests to verify they pass**

```bash
cd ~/mixler-site && python3 -m pytest seo/tests/test_generate.py -v
```

Expected: All 9 tests PASS.

- [ ] **Step 7.5: Commit**

```bash
cd ~/mixler-site && git add seo/ css/pseo.css js/pseo-activity.js && git commit -m "feat: add pSEO generator infrastructure, templates, CSS, and client JS"
```

---

## Chunk 2: Waitlist Backend

Supabase migration and edge function for the activity waitlist.

---

### Task 8: Supabase migration for waitlist tables

- [ ] **Step 8.1: Write `supabase/migrations/005_activity_waitlist.sql`**

Create `~/mixler-site/supabase/migrations/005_activity_waitlist.sql`:

```sql
-- Activity waitlist: stores email signups per activity for demand analytics
-- activity_waitlist_groups: stores MailerLite group IDs per activity (idempotent group creation)

CREATE TABLE IF NOT EXISTS activity_waitlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  activity_slug TEXT NOT NULL,
  activity_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_waitlist_slug ON activity_waitlist(activity_slug);
CREATE INDEX IF NOT EXISTS idx_activity_waitlist_email ON activity_waitlist(email);

-- Allow duplicate email+slug (user may sign up again after months)
-- No unique constraint intentionally -- dedup at query time if needed.

CREATE TABLE IF NOT EXISTS activity_waitlist_groups (
  activity_slug TEXT PRIMARY KEY,
  activity_name TEXT NOT NULL,
  mailerlite_group_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE activity_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_waitlist_groups ENABLE ROW LEVEL SECURITY;

-- Public: no direct access (all writes go through the edge function with service role key)
-- No SELECT policy needed on activity_waitlist (analytics only, admin use)
-- activity_waitlist_groups is read-only for the edge function (service role bypasses RLS)

-- Allow public SELECT on event_categories so the PostgREST join works with anon key
-- (needed by pseo-activity.js to filter events by category slug)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_categories' AND policyname = 'Public read event_categories'
  ) THEN
    CREATE POLICY "Public read event_categories"
      ON event_categories FOR SELECT
      USING (true);
  END IF;
END $$;
```

- [ ] **Step 8.2: Apply migration to Supabase**

```bash
source ~/mixler-site/.env && \
curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/sql" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{"query": "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('activity_waitlist','activity_waitlist_groups')"}
EOF
```

If tables don't exist yet, apply via Supabase dashboard SQL editor or CLI:
```bash
# Via Supabase CLI (if installed):
cd ~/mixler-site && supabase db push

# Or paste contents of 005_activity_waitlist.sql into Supabase dashboard > SQL Editor
```

Expected: Both tables exist, RLS enabled, `event_categories` has public SELECT policy.

- [ ] **Step 8.3: Verify event_categories public SELECT works with anon key**

```bash
source ~/mixler-site/.env && \
curl -s "${SUPABASE_URL}/rest/v1/event_categories?select=id,name,slug&limit=5" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}"
```

Expected: JSON array (may be empty if no categories seeded yet, but no 403 error).

---

### Task 9: Edge function `join-activity-waitlist`

Follows exact same pattern as `newsletter-subscribe/index.ts` and `create-mailerlite-group/index.ts`.

- [ ] **Step 9.1: Create edge function directory**

```bash
mkdir -p ~/mixler-site/supabase/functions/join-activity-waitlist
```

- [ ] **Step 9.2: Write `supabase/functions/join-activity-waitlist/index.ts`**

Create `~/mixler-site/supabase/functions/join-activity-waitlist/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, activity_slug, activity_name } = await req.json();

    if (!email || !isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: 'Valid email required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!activity_slug || !activity_name) {
      return new Response(
        JSON.stringify({ error: 'activity_slug and activity_name required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const mailerliteToken = Deno.env.get('MAILERLITE_API_TOKEN');

    // 1. Insert into activity_waitlist (demand analytics)
    const { error: insertError } = await supabase
      .from('activity_waitlist')
      .insert({ email, activity_slug, activity_name });

    if (insertError) {
      console.error('activity_waitlist insert error:', insertError);
      // Non-fatal: continue to MailerLite
    }

    if (!mailerliteToken) {
      console.log('MAILERLITE_API_TOKEN not set — skipping MailerLite subscription');
      return new Response(
        JSON.stringify({ success: true, mailerlite: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get or create MailerLite group for this activity
    let groupId: string | null = null;

    const { data: existingGroup } = await supabase
      .from('activity_waitlist_groups')
      .select('mailerlite_group_id')
      .eq('activity_slug', activity_slug)
      .single();

    if (existingGroup?.mailerlite_group_id) {
      groupId = existingGroup.mailerlite_group_id;
    } else {
      // Create new group in MailerLite
      const groupName = `Waitlist: ${activity_name} Calgary`;
      const createRes = await fetch('https://connect.mailerlite.com/api/groups', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mailerliteToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: groupName }),
      });

      if (createRes.ok) {
        const groupData = await createRes.json();
        groupId = groupData?.data?.id ? String(groupData.data.id) : null;

        if (groupId) {
          await supabase
            .from('activity_waitlist_groups')
            .insert({ activity_slug, activity_name, mailerlite_group_id: groupId });
        }
      } else {
        const errBody = await createRes.text();
        console.error('MailerLite group creation failed:', errBody);
      }
    }

    // 3. Upsert subscriber in MailerLite
    const subscriberRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mailerliteToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, status: 'active' }),
    });

    if (!subscriberRes.ok) {
      const errBody = await subscriberRes.text();
      console.error('MailerLite subscriber upsert failed:', errBody);
      return new Response(
        JSON.stringify({ success: true, mailerlite: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const subData = await subscriberRes.json();
    const subscriberId = subData?.data?.id;

    // 4. Add subscriber to the activity's waitlist group
    if (groupId && subscriberId) {
      const groupAddRes = await fetch(
        `https://connect.mailerlite.com/api/subscribers/${subscriberId}/groups/${groupId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mailerliteToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!groupAddRes.ok) {
        const errBody = await groupAddRes.text();
        console.error('MailerLite group add failed:', errBody);
      } else {
        console.log(`Added ${email} to waitlist group for ${activity_slug}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, mailerlite: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('join-activity-waitlist error:', err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 9.3: Deploy the edge function**

```bash
cd ~/mixler-site && supabase functions deploy join-activity-waitlist
```

Expected output: `Deployed Function join-activity-waitlist`

- [ ] **Step 9.4: Smoke test the edge function**

```bash
source ~/mixler-site/.env && \
curl -s -X POST "${SUPABASE_URL}/functions/v1/join-activity-waitlist" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","activity_slug":"axe-throwing-calgary","activity_name":"Axe Throwing"}'
```

Expected: `{"success":true,"mailerlite":true}` (or `mailerlite:false` if token not configured)

Verify DB row:
```bash
source ~/mixler-site/.env && \
curl -s "${SUPABASE_URL}/rest/v1/activity_waitlist?activity_slug=eq.axe-throwing-calgary&select=email,activity_slug,created_at" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}"
```

Expected: JSON array containing the test signup row.

- [ ] **Step 9.5: Commit**

```bash
cd ~/mixler-site && git add supabase/migrations/005_activity_waitlist.sql supabase/functions/join-activity-waitlist/ && git commit -m "feat: add activity waitlist tables and edge function with MailerLite integration"
```

---

## Chunk 3: Activity Content (JSON Files)

Generate all 68 activity JSON files. Each file lives at `seo/data/activities/{slug-without-calgary}.json`.

**Complete JSON schema** (all fields required unless noted):

```json
{
  "slug": "{activity}-calgary",
  "name": "{Activity Name}",
  "category": "creative|food-drink|games-social|active-outdoors|learning-culture|wellness",
  "category_slug": "{mailerlite-slug}",
  "og_image": "images/mixler-logo-wide-color.png",
  "tags": ["Tag 1", "Tag 2", "Tag 3"],
  "meta": {
    "title": "{Activity Name} in Calgary | Mixler",
    "description": "One sentence (150-160 chars). Include primary keyword naturally. Warm, inviting tone.",
    "keywords": ["primary keyword Calgary", "variant 1", "variant 2"]
  },
  "content": {
    "subtitle": "One line describing the event experience (max 100 chars)",
    "intro": "2-3 sentences. What this activity is, why it's popular in Calgary, who it's for. Warm, local voice. No em dashes.",
    "breadcrumb_label": "{Activity Name} Calgary",
    "what_to_expect": [
      {"icon": "emoji", "heading": "Short heading", "body": "1-2 sentences."},
      {"icon": "emoji", "heading": "Short heading", "body": "1-2 sentences."},
      {"icon": "emoji", "heading": "Short heading", "body": "1-2 sentences."},
      {"icon": "emoji", "heading": "Short heading", "body": "1-2 sentences."}
    ],
    "tips": [
      "Tip 1 as a full sentence.",
      "Tip 2 as a full sentence.",
      "Tip 3 as a full sentence.",
      "Tip 4 as a full sentence.",
      "Tip 5 mentioning Mixler naturally."
    ],
    "waitlist_heading": "Want to know when we run {activity} events?",
    "waitlist_body": "Join the waitlist and we'll email you when we add one. We use this to plan what to run next.",
    "related_activities": ["slug-1-calgary", "slug-2-calgary", "slug-3-calgary", "slug-4-calgary"]
  },
  "faq": [
    {"q": "Question?", "a": "Answer."},
    {"q": "Question?", "a": "Answer."},
    {"q": "Question?", "a": "Answer."},
    {"q": "Question?", "a": "Answer."}
  ]
}
```

**Writing voice rules (from Mixler brand):**
- Warm, inviting, casual but not sloppy. Calgary local feel.
- Never use em dashes. Use commas or periods instead.
- Mention Calgary or "in Calgary" naturally in intro and tips.
- Mixler tip always comes last in the tips list.
- Tags: 3 tags max. Examples: "All Skill Levels", "Great for Solo", "Groups Welcome", "Outdoors", "No Experience Needed", "Adults 21+", "Active"

**Complete example 1 -- `seo/data/activities/painting.json`:**

```json
{
  "slug": "painting-calgary",
  "name": "Painting Events",
  "category": "creative",
  "category_slug": "painting",
  "og_image": "images/mixler-logo-wide-color.png",
  "tags": ["All Skill Levels", "Groups Welcome", "Great for Solo"],
  "meta": {
    "title": "Painting Events in Calgary | Mixler",
    "description": "Find group painting events and paint and sip nights in Calgary. All skill levels welcome. Book your spot through Mixler.",
    "keywords": ["painting events Calgary", "paint and sip Calgary", "art night Calgary adults"]
  },
  "content": {
    "subtitle": "Group art nights, paint and sip events, and creative socials for adults",
    "intro": "Painting events have become one of Calgary's most popular ways for adults to get out, unwind, and actually talk to people. You show up, grab a brush, follow a loose guide, and somehow leave with a painting you're oddly proud of. No art experience needed. Most events include wine, snacks, and a group of strangers who become table friends by the second pour.",
    "breadcrumb_label": "Painting Events Calgary",
    "what_to_expect": [
      {"icon": "🎨", "heading": "No Experience Needed", "body": "Events are guided step by step. If you can hold a brush, you're qualified."},
      {"icon": "🕰️", "heading": "About 2 Hours", "body": "Most events run 2 to 2.5 hours. Relaxed pace, no rush."},
      {"icon": "🍷", "heading": "Drinks Included or Available", "body": "Most Calgary painting events are BYOB or include a drink with your ticket."},
      {"icon": "👥", "heading": "Table Seating", "body": "You sit with a small group. Solo attendees get placed with others. Conversations happen naturally."}
    ],
    "tips": [
      "Wear something you don't mind getting paint on. Aprons are usually provided but accidents happen.",
      "Go solo. Seriously. You'll meet more people than if you go with a group and stay in your lane.",
      "Don't stress about the painting. The point is the experience, not the art. Some of the funniest moments come from creative interpretations.",
      "Book early. Calgary painting events sell out fast, especially Friday and Saturday nights in spring and fall.",
      "Mixler painting events are specifically designed for adults who want to meet people, not just paint. Group sizes are kept intentionally small."
    ],
    "waitlist_heading": "Want to know when we run painting events?",
    "waitlist_body": "Join the waitlist and we'll email you when we add one. We use this to plan what to run next.",
    "related_activities": ["pottery-calgary", "wine-tasting-calgary", "cooking-classes-calgary", "candle-making-calgary"]
  },
  "faq": [
    {"q": "Do I need to bring anything?", "a": "Just yourself. All supplies are provided. If the event is BYOB, that info will be in the listing. Mixler events typically include a welcome drink."},
    {"q": "Can I come alone?", "a": "Absolutely, and we encourage it. A big chunk of Mixler attendees come solo. That's kind of the whole point: meeting new people is the event."},
    {"q": "What's the refund policy?", "a": "Tickets are refundable up to 48 hours before the event. After that, you can transfer your ticket to a friend."},
    {"q": "What age range attends these events?", "a": "Mixler events are for adults 21+. Most attendees are in the 25 to 45 range, though it varies by event."}
  ]
}
```

**Complete example 2 -- `seo/data/activities/axe-throwing.json`:**

```json
{
  "slug": "axe-throwing-calgary",
  "name": "Axe Throwing",
  "category": "active-outdoors",
  "category_slug": "axe-throwing",
  "og_image": "images/mixler-logo-wide-color.png",
  "tags": ["Active", "Groups Welcome", "No Experience Needed"],
  "meta": {
    "title": "Axe Throwing in Calgary | Mixler",
    "description": "Find axe throwing events and group nights in Calgary. No experience needed. Book social axe throwing through Mixler.",
    "keywords": ["axe throwing Calgary", "axe throwing group Calgary", "axe throwing social Calgary"]
  },
  "content": {
    "subtitle": "Social axe throwing nights for adults who want to try something different",
    "intro": "Axe throwing has gone from niche to one of Calgary's go-to group activities. You get a few minutes of instruction, a lane to yourself, and a lot of satisfaction when you actually stick the axe. It's loud, it's fun, and it's surprisingly easy to talk to strangers when you're all cheering each other on.",
    "breadcrumb_label": "Axe Throwing Calgary",
    "what_to_expect": [
      {"icon": "🪓", "heading": "Coached From the Start", "body": "Instructors walk you through technique before you throw. You'll be sticking axes within 10 minutes."},
      {"icon": "🕐", "heading": "1 to 2 Hours", "body": "Most social sessions run 60 to 90 minutes. Competitive nights can go longer."},
      {"icon": "👟", "heading": "Closed-Toe Shoes Required", "body": "This is the main dress code rule. Everything else is casual."},
      {"icon": "🍺", "heading": "Food and Drinks Available", "body": "Most Calgary axe throwing venues serve food and drinks. Check your event listing for details."}
    ],
    "tips": [
      "Wear closed-toe shoes. This is non-negotiable at every Calgary axe throwing venue.",
      "Don't overthink the technique. Instructors will show you. Trust the motion and let the axe do the work.",
      "Go with people you don't know. Axe throwing breaks social barriers fast. A few throws in and everyone is talking.",
      "Challenge someone to a one-on-one round. Friendly competition is what makes the night memorable.",
      "Mixler axe throwing events are specifically sized for small groups so you actually interact with everyone there, not just the people you came with."
    ],
    "waitlist_heading": "Want to know when we run axe throwing events?",
    "waitlist_body": "Join the waitlist and we'll email you when we add one. We use this to plan what to run next.",
    "related_activities": ["archery-calgary", "bowling-calgary", "rock-climbing-calgary", "pickleball-calgary"]
  },
  "faq": [
    {"q": "Is axe throwing safe?", "a": "Yes. Calgary venues have strict safety protocols, trained staff supervising at all times, and clear lanes between throwers. Accidents are extremely rare."},
    {"q": "How strong do I need to be?", "a": "Not very. Most people are surprised by how little strength is needed. Technique matters more than force."},
    {"q": "Can I come alone?", "a": "Yes, and Mixler events are designed for solo attendees. You'll be grouped with others and it's a great way to meet people."},
    {"q": "What should I wear?", "a": "Casual clothes and closed-toe shoes. That's really it."}
  ]
}
```

**Full activity file list to generate** (68 files):

Create one JSON file per row following the schema and examples above. Voice must stay warm, local, and avoid em dashes.

| File | slug | name | category |
|---|---|---|---|
| `painting.json` | `painting-calgary` | Painting Events | creative |
| `pottery.json` | `pottery-calgary` | Pottery Classes | creative |
| `candle-making.json` | `candle-making-calgary` | Candle Making | creative |
| `macrame.json` | `macrame-calgary` | Macrame Workshops | creative |
| `flower-arranging.json` | `flower-arranging-calgary` | Flower Arranging | creative |
| `leather-craft.json` | `leather-craft-calgary` | Leather Craft | creative |
| `resin-art.json` | `resin-art-calgary` | Resin Art | creative |
| `terrarium-building.json` | `terrarium-building-calgary` | Terrarium Building | creative |
| `wreath-making.json` | `wreath-making-calgary` | Wreath Making | creative |
| `calligraphy.json` | `calligraphy-calgary` | Calligraphy Classes | creative |
| `stained-glass.json` | `stained-glass-calgary` | Stained Glass | creative |
| `life-drawing.json` | `life-drawing-calgary` | Life Drawing | creative |
| `wine-tasting.json` | `wine-tasting-calgary` | Wine Tasting | food-drink |
| `cocktail-making.json` | `cocktail-making-calgary` | Cocktail Making | food-drink |
| `cooking-classes.json` | `cooking-classes-calgary` | Cooking Classes | food-drink |
| `sushi-making.json` | `sushi-making-calgary` | Sushi Making | food-drink |
| `pasta-making.json` | `pasta-making-calgary` | Pasta Making | food-drink |
| `cheese-charcuterie.json` | `cheese-charcuterie-calgary` | Cheese and Charcuterie | food-drink |
| `whisky-tasting.json` | `whisky-tasting-calgary` | Whisky Tasting | food-drink |
| `beer-brewing.json` | `beer-brewing-calgary` | Beer Brewing | food-drink |
| `knife-skills.json` | `knife-skills-calgary` | Knife Skills Class | food-drink |
| `dumpling-making.json` | `dumpling-making-calgary` | Dumpling Making | food-drink |
| `bread-baking.json` | `bread-baking-calgary` | Bread Baking | food-drink |
| `chocolate-making.json` | `chocolate-making-calgary` | Chocolate Making | food-drink |
| `charcuterie-board.json` | `charcuterie-board-calgary` | Charcuterie Board Class | food-drink |
| `olive-oil-tasting.json` | `olive-oil-tasting-calgary` | Olive Oil Tasting | food-drink |
| `trivia-night.json` | `trivia-night-calgary` | Trivia Nights | games-social |
| `escape-rooms.json` | `escape-rooms-calgary` | Escape Rooms | games-social |
| `board-games.json` | `board-games-calgary` | Board Game Nights | games-social |
| `murder-mystery.json` | `murder-mystery-calgary` | Murder Mystery | games-social |
| `bingo.json` | `bingo-calgary` | Bingo Nights | games-social |
| `pub-quiz.json` | `pub-quiz-calgary` | Pub Quiz | games-social |
| `card-games.json` | `card-games-calgary` | Card Game Nights | games-social |
| `casino-night.json` | `casino-night-calgary` | Casino Nights | games-social |
| `game-show-night.json` | `game-show-night-calgary` | Game Show Nights | games-social |
| `speed-friending.json` | `speed-friending-calgary` | Speed Friending | games-social |
| `axe-throwing.json` | `axe-throwing-calgary` | Axe Throwing | active-outdoors |
| `archery.json` | `archery-calgary` | Archery | active-outdoors |
| `rock-climbing.json` | `rock-climbing-calgary` | Rock Climbing | active-outdoors |
| `curling.json` | `curling-calgary` | Curling | active-outdoors |
| `bowling.json` | `bowling-calgary` | Bowling Nights | active-outdoors |
| `ping-pong.json` | `ping-pong-calgary` | Ping Pong | active-outdoors |
| `salsa-dancing.json` | `salsa-dancing-calgary` | Salsa Dancing | active-outdoors |
| `swing-dancing.json` | `swing-dancing-calgary` | Swing Dancing | active-outdoors |
| `aerial-yoga.json` | `aerial-yoga-calgary` | Aerial Yoga | active-outdoors |
| `roller-skating.json` | `roller-skating-calgary` | Roller Skating | active-outdoors |
| `ice-skating.json` | `ice-skating-calgary` | Ice Skating | active-outdoors |
| `pickleball.json` | `pickleball-calgary` | Pickleball | active-outdoors |
| `golf.json` | `golf-calgary` | Golf Events | active-outdoors |
| `mountain-hikes.json` | `mountain-hikes-calgary` | Mountain Hikes | active-outdoors |
| `kayaking.json` | `kayaking-calgary` | Kayaking | active-outdoors |
| `improv-classes.json` | `improv-classes-calgary` | Improv Classes | learning-culture |
| `stand-up-comedy.json` | `stand-up-comedy-calgary` | Stand-Up Comedy | learning-culture |
| `photography-walks.json` | `photography-walks-calgary` | Photography Walks | learning-culture |
| `language-exchange.json` | `language-exchange-calgary` | Language Exchange | learning-culture |
| `book-club.json` | `book-club-calgary` | Book Club | learning-culture |
| `history-walks.json` | `history-walks-calgary` | History Walks | learning-culture |
| `mindfulness.json` | `mindfulness-calgary` | Mindfulness Events | learning-culture |
| `financial-literacy.json` | `financial-literacy-calgary` | Financial Literacy Nights | learning-culture |
| `puppy-yoga.json` | `puppy-yoga-calgary` | Puppy Yoga | wellness |
| `yoga-socials.json` | `yoga-socials-calgary` | Yoga Socials | wellness |
| `sound-bath.json` | `sound-bath-calgary` | Sound Bath | wellness |
| `meditation.json` | `meditation-calgary` | Meditation Events | wellness |
| `breathwork.json` | `breathwork-calgary` | Breathwork | wellness |
| `journaling-night.json` | `journaling-night-calgary` | Journaling Night | wellness |
| `vision-board.json` | `vision-board-calgary` | Vision Board Making | wellness |
| `crystals-workshop.json` | `crystals-workshop-calgary` | Crystals Workshop | wellness |
| `bath-bomb-making.json` | `bath-bomb-making-calgary` | Bath Bomb Making | wellness |

- [ ] **Step 10.1: Generate all 68 activity JSON files**

For each row in the table above, create the corresponding JSON file at `seo/data/activities/{filename}` following the complete schema and the two examples above. Every file must have: all required fields, 4 what_to_expect items, exactly 5 tips (last one mentions Mixler), 4 FAQ items, 4 related_activities slugs.

- [ ] **Step 10.2: Validate JSON files are all valid**

```bash
cd ~/mixler-site && python3 -c "
import json, sys
from pathlib import Path
errors = []
for p in sorted(Path('seo/data/activities').glob('*.json')):
    try:
        d = json.loads(p.read_text())
        required = ['slug','name','category','category_slug','og_image','tags','meta','content','faq']
        missing = [k for k in required if k not in d]
        if missing:
            errors.append(f'{p.name}: missing {missing}')
        if len(d.get('faq',[])) < 4:
            errors.append(f'{p.name}: faq has {len(d[\"faq\"])} items (need 4)')
        if len(d.get('content',{}).get('tips',[])) != 5:
            errors.append(f'{p.name}: tips count is {len(d.get(\"content\",{}).get(\"tips\",[]))} (need 5)')
        if len(d.get('content',{}).get('what_to_expect',[])) < 4:
            errors.append(f'{p.name}: what_to_expect has {len(d.get(\"content\",{}).get(\"what_to_expect\",[]))} items (need 4)')
    except Exception as e:
        errors.append(f'{p.name}: {e}')
if errors:
    print('ERRORS:')
    for e in errors: print(' ', e)
    sys.exit(1)
else:
    files = list(Path('seo/data/activities').glob('*.json'))
    if len(files) != 68:
        print(f'WARNING: expected 68 files, got {len(files)}')
    print(f'All {len(files)} activity JSON files valid.')
"
```

Expected: `All 68 activity JSON files valid.`

- [ ] **Step 10.3: Commit activity JSON files**

```bash
cd ~/mixler-site && git add seo/data/activities/ && git commit -m "feat: add all 68 activity content JSON files"
```

---

## Chunk 4: Guide Content (JSON Files)

Generate all 25 guide JSON files at `seo/data/guides/{slug}.json`.

**Complete JSON schema:**

```json
{
  "slug": "{guide-slug}",
  "type": "authority|roundup",
  "og_image": "images/mixler-logo-wide-color.png",
  "meta": {
    "title": "{Guide Title} | Mixler",
    "description": "One sentence, 150-160 chars, includes primary keyword naturally.",
    "keywords": ["primary keyword Calgary", "variant 1", "variant 2"]
  },
  "content": {
    "title": "{Full Guide Title}",
    "subtitle": "One line establishing credibility or framing the guide",
    "read_time": "X min read",
    "updated_date": "March 2026",
    "intro": "2-3 sentences. Sets the problem/topic. Pink left-border blockquote style in the rendered page. Warm, honest voice. No em dashes.",
    "sections": [
      {
        "label": "Short Label",
        "heading": "Section Heading",
        "paragraphs": ["Para 1.", "Para 2."],
        "tip_box": {"label": "Key insight", "body": "One sentence tip or callout."}
      }
    ],
    "mixler_cta": {
      "heading": "Short punchy heading.",
      "body": "One sentence on what Mixler does.",
      "button_text": "See Upcoming Events"
    },
    "related_activities": ["slug-1-calgary", "slug-2-calgary", "slug-3-calgary", "slug-4-calgary"],
    "faq": [
      {"q": "Question?", "a": "Answer."}
    ],
    "sidebar_cta": {
      "heading": "Sidebar heading.",
      "body": "One sentence.",
      "button_text": "Browse Events"
    }
  }
}
```

**Notes on guide content:**
- Authority guides (Mixler's voice): 3-5 sections, strong Mixler inline CTA. Write as if Mixler is the Calgary social expert.
- Roundup guides (neutral): 3-4 sections listing options. Mention Mixler as one option, not the only one.
- `read_time`: Count sections x 1.5 min, round up.
- No em dashes anywhere.
- Sections should have `tip_box` only where it adds genuine value, not forced on every section.
- `faq` can be at the top level or inside `content` -- the generator handles both.

**Complete example -- `seo/data/guides/how-to-meet-people-calgary.json`:**

```json
{
  "slug": "how-to-meet-people-calgary",
  "type": "authority",
  "og_image": "images/mixler-logo-wide-color.png",
  "meta": {
    "title": "How to Meet People in Calgary as an Adult | Mixler",
    "description": "Real advice on meeting people and building a social life in Calgary, from the team behind Calgary's most popular adult social events.",
    "keywords": ["how to meet people in Calgary", "making friends Calgary", "social life Calgary adults"]
  },
  "content": {
    "title": "How to Meet People in Calgary as an Adult",
    "subtitle": "Real talk from the team behind Calgary's most popular social events.",
    "read_time": "8 min read",
    "updated_date": "March 2026",
    "intro": "Nobody warns you that making friends as an adult in a new city is one of the weirdest social challenges you'll ever face. The old structures that made it easy, like school, dorms, and the job you stayed at for years, disappear. And suddenly you're trying to figure out how to meet people who aren't already in a closed social circle. We run social events in Calgary every month. This is what we've learned.",
    "sections": [
      {
        "label": "The Problem",
        "heading": "Why It's Hard to Meet People in Calgary",
        "paragraphs": [
          "Calgary has a transient quality that makes it trickier than most cities. A lot of people moved here for work, their existing friends are scattered, and the sprawl means you rarely end up in the same space as the same strangers twice. The cold winters don't help either. People default to staying in.",
          "The standard advice (join a gym, take a class, volunteer) works eventually, but it's slow, and the settings aren't designed for actual connection. You're side by side doing something, not face to face talking to each other."
        ],
        "tip_box": {
          "label": "The key insight",
          "body": "Most social settings in Calgary are transactional or activity-focused. What you need is a setting where meeting people is the explicit point, not a side effect."
        }
      },
      {
        "label": "What Works",
        "heading": "Activities That Actually Build Connections",
        "paragraphs": [
          "The best results come from repeated low-stakes exposure combined with a shared activity that gives people something to talk about. A one-off event can break the ice, but it's the second and third time you see the same people where real connections form.",
          "What we've seen work best in Calgary: small group events under 20 people, activities with natural conversation pauses like painting, trivia, or cooking, and events specifically framed as social rather than skill-building."
        ]
      },
      {
        "label": "Other Options",
        "heading": "More Ways to Meet People in Calgary",
        "paragraphs": [
          "Sports leagues: Calgary has a strong recreational sports scene. Flag football, volleyball, and dodgeball leagues through organizations like CSSC attract people specifically looking to meet others. Sessions run weekly which gives you that repeated exposure.",
          "Meetup.com: Hit or miss, but some Calgary groups are genuinely active, particularly in hiking, board games, and professional networking. Check attendance history before committing.",
          "Volunteer work: Slower burn but high quality. The Calgary Food Bank and Habitat for Humanity attract people who show up consistently. Relationships form over time."
        ]
      }
    ],
    "mixler_cta": {
      "heading": "That's exactly what Mixler does.",
      "body": "Small group events in Calgary designed for adults who want to actually meet people. No awkward networking, just good activities and good people.",
      "button_text": "See Upcoming Events"
    },
    "related_activities": ["painting-calgary", "trivia-night-calgary", "cooking-classes-calgary", "speed-friending-calgary"],
    "faq": [
      {"q": "Is Calgary a friendly city for newcomers?", "a": "Generally yes, but it takes intentional effort. Calgarians tend to have established social circles and don't always seek out new connections organically. Putting yourself in structured social settings dramatically speeds things up."},
      {"q": "What's the best neighbourhood for meeting people in Calgary?", "a": "Kensington and the Beltline have the highest density of walkable bars, cafes, and event venues. If you live or spend time in these areas, incidental social exposure is higher than in the suburbs."},
      {"q": "How long does it usually take to build a friend group in a new city?", "a": "Research suggests around 50 hours of shared time to form a casual friendship and 200 hours for a close one. The key is compressing that time. Weekly activities beat monthly ones significantly."},
      {"q": "Are there social events specifically for adults in Calgary?", "a": "Yes. Mixler runs small group social events every month designed specifically for adults who want to meet new people, not just participate in an activity."}
    ],
    "sidebar_cta": {
      "heading": "Ready to actually get out there?",
      "body": "Mixler runs small group social events in Calgary every month. Come solo, meet people, have a good time.",
      "button_text": "Browse Events"
    }
  },
}
```

**Note:** Do NOT include a top-level `"faq"` key in guide files. All FAQ items go inside `content.faq`. The generator will promote them to the top level automatically.

**Full guide file list to generate** (25 files):

| File | slug | type |
|---|---|---|
| `how-to-meet-people-calgary.json` | `how-to-meet-people-calgary` | authority |
| `best-adult-social-events-calgary.json` | `best-adult-social-events-calgary` | authority |
| `going-out-solo-calgary.json` | `going-out-solo-calgary` | authority |
| `how-to-make-friends-after-30.json` | `how-to-make-friends-after-30` | authority |
| `date-ideas-calgary-couples.json` | `date-ideas-calgary-couples` | authority |
| `things-to-do-calgary-friday-night.json` | `things-to-do-calgary-friday-night` | authority |
| `calgary-winter-activities-adults.json` | `calgary-winter-activities-adults` | authority |
| `summer-activities-calgary-adults.json` | `summer-activities-calgary-adults` | authority |
| `things-to-do-calgary-this-weekend.json` | `things-to-do-calgary-this-weekend` | authority |
| `best-neighbourhoods-go-out-calgary.json` | `best-neighbourhoods-go-out-calgary` | authority |
| `best-escape-rooms-calgary.json` | `best-escape-rooms-calgary` | roundup |
| `best-cooking-classes-calgary.json` | `best-cooking-classes-calgary` | roundup |
| `best-wine-tasting-calgary.json` | `best-wine-tasting-calgary` | roundup |
| `best-art-classes-calgary.json` | `best-art-classes-calgary` | roundup |
| `best-dance-classes-calgary.json` | `best-dance-classes-calgary` | roundup |
| `fun-things-to-do-calgary-groups.json` | `fun-things-to-do-calgary-groups` | roundup |
| `unique-experiences-calgary.json` | `unique-experiences-calgary` | roundup |
| `birthday-ideas-calgary-adults.json` | `birthday-ideas-calgary-adults` | roundup |
| `team-outing-ideas-calgary.json` | `team-outing-ideas-calgary` | roundup |
| `first-date-ideas-calgary.json` | `first-date-ideas-calgary` | roundup |
| `hen-party-ideas-calgary.json` | `hen-party-ideas-calgary` | roundup |
| `things-to-do-calgary-when-cold.json` | `things-to-do-calgary-when-cold` | roundup |
| `rainy-day-activities-calgary.json` | `rainy-day-activities-calgary` | roundup |
| `cheap-things-to-do-calgary.json` | `cheap-things-to-do-calgary` | roundup |
| `best-bars-groups-calgary.json` | `best-bars-groups-calgary` | roundup |

- [ ] **Step 11.1: Generate all 25 guide JSON files**

For each row in the table above, create the corresponding JSON file at `seo/data/guides/{filename}` following the complete schema and the example above. Every file must have: all required fields, 3-5 sections, a mixler_cta, 4 related_activities slugs, 4 faq items, a sidebar_cta.

- [ ] **Step 11.2: Validate guide JSON files**

```bash
cd ~/mixler-site && python3 -c "
import json, sys
from pathlib import Path
errors = []
for p in sorted(Path('seo/data/guides').glob('*.json')):
    try:
        d = json.loads(p.read_text())
        required = ['slug','type','og_image','meta','content']
        missing = [k for k in required if k not in d]
        if missing:
            errors.append(f'{p.name}: missing {missing}')
        c = d.get('content', {})
        faq = c.get('faq', d.get('faq', []))
        if len(faq) < 4:
            errors.append(f'{p.name}: faq has {len(faq)} items (need at least 4)')
        if len(c.get('sections', [])) < 3:
            errors.append(f'{p.name}: sections count is {len(c.get(\"sections\",[]))} (need at least 3)')
        if not c.get('mixler_cta'):
            errors.append(f'{p.name}: missing content.mixler_cta')
        if not c.get('sidebar_cta'):
            errors.append(f'{p.name}: missing content.sidebar_cta')
    except Exception as e:
        errors.append(f'{p.name}: {e}')
if errors:
    print('ERRORS:')
    for e in errors: print(' ', e)
    sys.exit(1)
else:
    files = list(Path('seo/data/guides').glob('*.json'))
    print(f'All {len(files)} guide JSON files valid.')
"
```

Expected: `All 25 guide JSON files valid.`

- [ ] **Step 11.3: Commit guide JSON files**

```bash
cd ~/mixler-site && git add seo/data/guides/ && git commit -m "feat: add all 25 guide content JSON files"
```

---

## Chunk 5: Generation, Deploy, and Verify

Run the generator, deploy to VPS, verify pages are live and indexed.

---

### Task 12: Run the generator

- [ ] **Step 12.1: Run generate.py from repo root**

```bash
cd ~/mixler-site && python3 seo/generate.py
```

Expected output (abbreviated):
```
Generating 68 activity pages...
  Generated: activities/painting-calgary/index.html
  Generated: activities/pottery-calgary/index.html
  ...
Generating 25 guide pages...
  Generated: guides/how-to-meet-people-calgary/index.html
  ...
Writing sitemap and robots.txt...
  Created: sitemap.xml (98 URLs)
  Created: robots.txt

Done. 93 pages generated.
```

- [ ] **Step 12.2: Spot-check two generated pages**

```bash
# Check activity page has events-slot with correct category slug
grep -n "events-slot\|data-category-slug" ~/mixler-site/activities/axe-throwing-calgary/index.html

# Check guide page has TOC content
grep -n "pseo-toc-link\|In This Guide" ~/mixler-site/guides/how-to-meet-people-calgary/index.html

# Check anon key is present (not the placeholder)
grep -c "REPLACED_BY_GENERATE_PY" ~/mixler-site/activities/painting-calgary/index.html
```

Expected:
- Line 1: `data-category-slug="axe-throwing"` present
- Line 2: TOC link text present
- Line 3: `0` (placeholder has been replaced)

- [ ] **Step 12.3: Run full test suite one final time**

```bash
cd ~/mixler-site && python3 -m pytest seo/tests/test_generate.py -v
```

Expected: All 9 tests PASS.

---

### Task 13: Update CLAUDE.md rsync command

- [ ] **Step 13.1: Add `--exclude='seo'` to rsync command in CLAUDE.md**

In `~/mixler-site/CLAUDE.md`, update the rsync command in the Deployment section to add `--exclude='seo'`:

Old:
```
rsync -avz --delete ~/mixler-site/ root@198.71.51.250:/var/www/mixler.ca/ --exclude='.git' --exclude='supabase' --exclude='scripts' --exclude='CLAUDE.md' --exclude='.github' --exclude='og'
```

New:
```
rsync -avz --delete ~/mixler-site/ root@198.71.51.250:/var/www/mixler.ca/ --exclude='.git' --exclude='supabase' --exclude='scripts' --exclude='CLAUDE.md' --exclude='.github' --exclude='og' --exclude='seo'
```

---

### Task 14: Deploy to VPS

- [ ] **Step 14.1: Commit all remaining changes**

```bash
cd ~/mixler-site && git add -A && git status
# Confirm only expected files are staged (activities/, guides/, sitemap.xml, robots.txt, CLAUDE.md)
git commit -m "feat: generate all 93 pSEO pages, sitemap, and robots.txt"
```

- [ ] **Step 14.2: Push to GitHub**

```bash
cd ~/mixler-site && git push origin main
```

- [ ] **Step 14.3: Deploy to VPS**

```bash
rsync -avz --delete ~/mixler-site/ root@198.71.51.250:/var/www/mixler.ca/ \
  --exclude='.git' --exclude='supabase' --exclude='scripts' \
  --exclude='CLAUDE.md' --exclude='.github' --exclude='og' --exclude='seo'
```

Expected: Transfer completes with 93+ new files listed.

- [ ] **Step 14.4: Regenerate OG previews**

```bash
ssh root@198.71.51.250 "bash /var/www/mixler.ca/scripts/generate-og.sh"
```

---

### Task 15: Post-deploy verification

- [ ] **Step 15.1: Verify a live activity page**

```bash
curl -s -o /dev/null -w "%{http_code}" https://mixler.ca/activities/painting-calgary/
```

Expected: `200`

- [ ] **Step 15.2: Verify a live guide page**

```bash
curl -s -o /dev/null -w "%{http_code}" https://mixler.ca/guides/how-to-meet-people-calgary/
```

Expected: `200`

- [ ] **Step 15.3: Verify sitemap is live**

```bash
curl -s -o /dev/null -w "%{http_code}" https://mixler.ca/sitemap.xml
```

Expected: `200`

- [ ] **Step 15.4: Verify robots.txt is live**

```bash
curl -s https://mixler.ca/robots.txt
```

Expected: Contains `Sitemap: https://mixler.ca/sitemap.xml`

- [ ] **Step 15.5: Check FAQ schema renders in a page**

```bash
curl -s https://mixler.ca/activities/painting-calgary/ | grep -c "FAQPage"
```

Expected: `1`

- [ ] **Step 15.6: Submit sitemap to Google Search Console**

Log into Google Search Console for mixler.ca and submit:
```
https://mixler.ca/sitemap.xml
```

This is a manual step in the browser at search.google.com/search-console.
