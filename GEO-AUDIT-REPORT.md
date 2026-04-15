# GEO/SEO Audit: Mixler — "Calgary Puppy Yoga"

**Audit Date:** 2026-04-15
**Target query:** Calgary Puppy Yoga
**URL under review:** https://mixler.ca/event.html?slug=puppy-yoga-apr-2026
**Related page:** https://www.mixler.ca/activities/puppy-yoga-calgary/
**Business type:** Local events / hybrid marketplace

---

## Executive Summary

Mixler does not rank for "Calgary Puppy Yoga" because **the page that has the live bookable event is essentially invisible to Google**, and the page Google *can* see (`/activities/puppy-yoga-calgary/`) is a generic info page with no Event schema, no reference to the actual upcoming session, and no external authority to compete with established players like calgarypuppyyoga.com (exact match domain), Avenue Calgary, and Eventbrite.

There are two big structural problems and a handful of quick wins that together explain the ranking gap.

### Score Breakdown

| Category | Score | Notes |
|---|---|---|
| Technical SEO | 35/100 | Bot cloaking via nginx, broken canonicals, sitemap domain mismatch |
| Schema / Structured Data | 25/100 | FAQ + Breadcrumb present on activity page. Zero Event schema anywhere. |
| Content E-E-A-T | 60/100 | Activity page is well-written. Event page has no indexable content. |
| AI Citability | 40/100 | Activity page is citable. Event detail page is empty HTML. |
| Brand Authority | 20/100 | No visible backlinks. Competing against exact-match domain + Avenue Calgary. |
| Platform Optimization | 30/100 | Not on Eventbrite, no GBP event, no Instagram event posts indexed |
| **Overall GEO Score** | **34/100** | **Critical** |

---

## The Core Problem (In One Paragraph)

`[event.html:14](event.html#L14)` hardcodes `<title>Event | Mixler</title>` and renders everything via JavaScript after the page loads. Nginx detects Googlebot and serves a static OG file from `/og/puppy-yoga-apr-2026.html` instead. That OG file has a title, some OG tags, and a single `<p><a>Puppy Yoga</a></p>` as the body. No Event schema, no price, no date, no description body, no CTAs. That is all Google sees for the live event. Meanwhile the activity page at `/activities/puppy-yoga-calgary/` is a generic "here is what puppy yoga is" info page that does not mention the specific May 2026 session and has no Event schema linking it to a bookable instance. Two pages, neither of them the thing Google wants to rank for this query.

---

## Critical Issues

### 1. Cloaking risk + near-empty bot content

`nginx` serves completely different content to Googlebot vs. users for `/event.html`:

```
location = /event.html {
    if ($is_bot) {
        rewrite ^ /og-static last;
    try_files /event.html =404;
}
```

The OG file Googlebot sees (`/og/puppy-yoga-apr-2026.html`) contains:
- 17 lines total
- Title: `Puppy Yoga | Mixler` (no "Calgary")
- OG description truncated mid-word: `"...total be"` (the generator does `cut -c1-200`, which chops the last word off)
- Canonical pointing to `https://mixler.ca/event?slug=puppy-yoga-apr-2026` — **wrong on three counts**: non-www (redirects to www), missing `.html`, and does not match the real URL structure
- Body is literally one `<p><a>` link
- No Event schema, no price, no date in the body

Google's guidelines allow dynamic rendering but require **content parity** between what bots and users see. Right now the user sees a full event page and the bot sees a stub. This is on the wrong side of the line.

**Fix:** Rewrite `scripts/generate-og.sh` so the static OG file contains the full event content as real HTML (title, H1, date, location, price, description, CTA button linking to the SPA) plus Event schema JSON-LD. The static file becomes the canonical rendering and the SPA can progressively enhance it for logged-in checkout.

---

### 2. Zero Event schema anywhere on the site

"Calgary Puppy Yoga" triggers Google's Events carousel. Google populates that carousel from `Event` structured data. Mixler has **none**. Not on the activity page, not on the OG files, not on `/events.html`, not anywhere.

**Fix:** Add `Event` JSON-LD to:
1. The OG static files (per-event, generated from Supabase)
2. `/activities/puppy-yoga-calgary/` with `upcomingEvents` linking to the next scheduled session
3. `/events.html` with an `ItemList` of all upcoming events

Minimum required properties: `name`, `startDate`, `endDate`, `location` (with nested `Place`), `eventAttendanceMode`, `eventStatus`, `offers` (with `price`, `priceCurrency`, `availability`, `url`, `validFrom`), `image`, `description`, `organizer`.

---

### 3. Live event pages are not in the sitemap

`sitemap.xml` has 59 URLs. None of them are event detail pages. Google has no authoritative signal that `/event.html?slug=puppy-yoga-apr-2026` exists, and the SPA does not link to it from any crawlable location either (`/events.html` is also JS-rendered).

**Fix:** Regenerate `sitemap.xml` to include every published event URL, with `lastmod` set from `events.updated_at` and `changefreq=daily` until `event_date`.

---

## High Priority Issues

### 4. Activity page is disconnected from the live event

`/activities/puppy-yoga-calgary/` is a good info page (2k words, FAQ schema, breadcrumb schema, clear H1) but it does not:
- Mention any upcoming session
- Link to `/event.html?slug=puppy-yoga-apr-2026`
- Carry any Event schema
- Show a date or a price

This is the page most likely to rank organically for "Calgary Puppy Yoga" (it targets the query phrase, it is in the sitemap, it has content). The fix is to turn it into a hub page: keep the evergreen content, and inject an "Upcoming Sessions" block at the top that pulls from Supabase at build time (or via a server-rendered partial), with Event schema attached.

---

### 5. OG files missing for newly published events

The regen script only runs when you manually trigger it from the VPS. Ladies Spa Day was just published and has no OG file — meaning Googlebot hitting its URL would get a 404 under the nginx cloaking rule (since `/og/ladies-spa-day-may-2026.html` does not exist).

**Fix options:**
- **Best:** A Supabase webhook (or DB trigger → Edge Function) that regenerates the single OG file on event insert/update/publish
- **Cheap:** Run `scripts/generate-og.sh` as the last step in `deploy.sh` and call it from a GitHub Action after Supabase changes

Either way, publishing an event without regenerating the OG file should not be possible.

---

### 6. Domain canonicalization mismatch

- `robots.txt` references `https://www.mixler.ca/sitemap.xml` (www)
- OG files' canonical is `https://mixler.ca/event?slug=...` (no www, no .html)
- Activity pages' canonical is `https://www.mixler.ca/activities/...` (www)
- `mixler.ca` 301s to `www.mixler.ca`

Inconsistent canonicals confuse Google about which version is authoritative and dilute link equity.

**Fix:** Pick one (www is already the redirect target, so stay there) and make every canonical, OG `og:url`, sitemap entry, and internal link use `https://www.mixler.ca/...`.

---

### 7. No backlinks, competing against exact-match domain

Top Google results for "Calgary Puppy Yoga":
1. calgarypuppyyoga.com (exact-match domain)
2. pupsandyoga.com/products/pupsandyoga-calgary
3. instagram.com/puppyyoga.calgary
4. avenuecalgary.com (local magazine, high DA)
5. eventbrite.ca
6. granaryroad.com
7. pawsitivematch.org

These are all established, link-rich, and most have been covering Calgary puppy yoga for years. Mixler can't out-authority them on page signals alone. You need citations.

**Cheap wins:**
- List the event on Eventbrite (the Eventbrite listing will rank, and clicking through sends traffic to Mixler). Low effort, high return.
- Pitch Avenue Calgary for inclusion in their things-to-do roundups (`hello@avenueedmonton.com` / similar)
- Get the local rescue/foster partner to link back from their site (they already rank: pawsitivematch.org)
- Get on Narcity Calgary, Curiocity Calgary, Where Calgary, and YYCLiving event calendars

---

## Medium Priority Issues

### 8. OG description generator is broken
`generate-og.sh` does `cut -c1-200` which truncates mid-word and produces snippets like `"...total be"`. Either cut at the last full word boundary or regenerate to 160 chars with proper word-aware truncation.

### 9. Activity page meta title missing "Calgary"
Current: `Puppy Yoga in Calgary | Mixler` — actually this is fine. But OG file title is `Puppy Yoga | Mixler` which drops the geo modifier. Fix: include city in OG titles.

### 10. No `LocalBusiness` or `Organization` schema on homepage
Google uses these to identify Mixler as an entity. Without them, brand recognition is slow.

### 11. `/events.html` is also JS-rendered with no structured data
Same dynamic rendering pattern. Should serve a pre-rendered list of events with `ItemList` + nested `Event` schema for bots.

---

## Low Priority Issues

- `event.html` hardcoded `<title>Event | Mixler</title>` — if the SPA ever serves to a bot (say the UA check fails), the title is useless. Have the SPA set `document.title` on load too.
- GA `gtag.js` loads before any meta tags in `event.html`. Move analytics to end of `<head>` or before `</body>`.
- `/og/` directory is blocked from direct access — good — but make sure the nginx rule doesn't also block the static files being served via `/og-static` rewrite.

---

## Quick Wins (Implement This Week)

1. **Fix the OG generator**: make it emit full Event schema JSON-LD, a real `<body>` with event details, correct canonical URL, and word-aware description truncation. ~1 hour of work.
2. **Auto-run OG regen on deploy**: add it to the end of `deploy.sh`. ~10 min.
3. **Add Event schema to `/activities/puppy-yoga-calgary/`**: pull the next upcoming puppy yoga event from Supabase at build time and embed `Event` JSON-LD. ~1 hour.
4. **Add event URLs to sitemap**: regenerate `sitemap.xml` from Supabase to include all published event pages. ~30 min.
5. **List the current puppy yoga event on Eventbrite**: ~15 min. Highest ROI item on this list.
6. **Fix all canonicals to use `www.mixler.ca`**: grep-and-replace across OG generator, nginx rewrite paths, and `event.html`. ~20 min.
7. **Submit sitemap + request indexing in Google Search Console** for the activity page and the event page. Free, 5 min. If Mixler is not in GSC yet, set it up today.

---

## 30-Day Action Plan

### Week 1: Stop the bleeding (technical fixes)
- [ ] Rewrite `scripts/generate-og.sh` to produce real, schema-rich static event pages
- [ ] Add `Event` JSON-LD generation into the OG script
- [ ] Auto-run OG regen on every deploy and on Supabase event insert/update
- [ ] Fix canonical URLs to `www.mixler.ca` everywhere
- [ ] Add all published event pages to `sitemap.xml`
- [ ] Set up Google Search Console if not already there, submit sitemap, request indexing

### Week 2: Make the activity pages earn their ranking
- [ ] Convert `/activities/puppy-yoga-calgary/` into a hub page: keep the evergreen content + add a dynamic "Upcoming Sessions" section linked to live events
- [ ] Add `Event` + `AggregateOffer` schema on the activity page for upcoming sessions
- [ ] Add `LocalBusiness` / `Organization` schema to the homepage
- [ ] Do the same hub-page treatment for the other 32 activities (template the pattern)

### Week 3: Platform presence
- [ ] List current + next puppy yoga event on Eventbrite
- [ ] Create Google Business Profile for Mixler (if not already)
- [ ] Post upcoming events to Instagram with location tags
- [ ] Pitch Avenue Calgary, Narcity, Curiocity, Where Calgary, YYCLiving for event calendar inclusion
- [ ] Ask current rescue/foster partner for a backlink from their site

### Week 4: Content & authority
- [ ] Publish a blog post: "The 2026 Guide to Puppy Yoga in Calgary" — link to your activity page + live event. Target long-tail variants.
- [ ] Set up author pages with credentials (Johnny or whoever hosts events)
- [ ] Get 2-3 customer testimonials with attendee names + dates. Embed `Review` schema on the activity page.
- [ ] Check backlink profile in 2 weeks via ahrefs free tool or GSC

---

## Appendix: What Googlebot Actually Sees Right Now

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Puppy Yoga | Mixler</title>
<meta property="og:title" content="Puppy Yoga">
<meta property="og:description" content="Sunday, April 19, 2026 · Fit Kids. Stretch, breathe, and play with the most adorable yoga partners you will ever meet. Join us at Fit Kids for a one-hour yoga session surrounded by puppies. Whether you are a seasoned yogi or a total be">
<meta property="og:image" content="https://mixler.ca/images/PuppyYoga.jpg">
<meta property="og:url" content="https://mixler.ca/event?slug=puppy-yoga-apr-2026">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Mixler">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Puppy Yoga">
<meta name="twitter:description" content="...total be">
<meta name="twitter:image" content="https://mixler.ca/images/PuppyYoga.jpg">
<link rel="canonical" href="https://mixler.ca/event?slug=puppy-yoga-apr-2026">
</head>
<body>
<p><a href="https://mixler.ca/event?slug=puppy-yoga-apr-2026">Puppy Yoga</a></p>
</body>
</html>
```

That is the entire thing. No H1. No description in the body. No price. No date in the body. No schema. No CTA. No organizer. No location address. This is a page that will never rank.
