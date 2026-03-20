# Runbook: Deploying Mixler

## Overview

Deployment is a two-part process: push to GitHub (version control), then rsync to the IONOS VPS (production). OG image regeneration is required after every deploy.

**VPS:** 198.71.51.250
**Web root:** `/var/www/mixler.ca/`
**Domain:** mixler.ca

---

## What NOT to Deploy

The rsync command excludes these paths. Never manually copy them to the VPS.

| Excluded path | Reason |
|--------------|--------|
| `.git/` | Version control internals |
| `supabase/` | Migrations and functions are managed via Supabase CLI, not rsync |
| `scripts/` | Server-side scripts already exist on the VPS |
| `CLAUDE.md` | Agent instructions, not public content |
| `seo/` | Generator scripts, not served content |

---

## Step 1: Verify Changes Are Ready

Before committing, confirm:
- All changes are complete and manually tested (or reviewed)
- No console errors on affected pages
- Images are properly named and placed in the correct directory
- No sensitive keys or credentials in changed files

---

## Step 2: Stage Specific Files

Always stage files individually or by directory. Never use `git add -A` or `git add .` as this can accidentally commit `.env`, generated files, or other unintended content.

```bash
git add path/to/file.html path/to/other-file.js
```

---

## Step 3: Commit

Write a descriptive commit message explaining what changed and why.

```bash
git commit -m "Short description of what changed"
```

Good examples:
- `Add pottery night March 2026 event`
- `Fix checkout price display on mobile`
- `Update footer with new social links`

---

## Step 4: Push to GitHub

```bash
git push origin main
```

---

## Step 5: Deploy to VPS via rsync

Run from the project root (`~/mixler-site/`):

```bash
rsync -avz \
  --exclude='.git' \
  --exclude='supabase' \
  --exclude='scripts' \
  --exclude='CLAUDE.md' \
  --exclude='seo' \
  . root@198.71.51.250:/var/www/mixler.ca/
```

The `-avz` flags: archive mode (preserves permissions, symlinks, timestamps), verbose output, compressed transfer.

Watch the rsync output to confirm expected files were transferred. If a file you changed is not listed, check that it is not caught by an exclude pattern.

---

## Step 6: Regenerate OG Images

**Required after every deploy.** The OG image script generates social share preview images for all events. If skipped, event share previews will be stale or missing.

```bash
ssh root@198.71.51.250 "bash /var/www/mixler.ca/scripts/generate-og.sh"
```

This script runs on the VPS and writes generated images to the appropriate location under `/var/www/mixler.ca/`.

---

## Step 7: Verify at mixler.ca

After deploy and OG regeneration:

1. Open mixler.ca in a browser (use a private/incognito window to bypass cache)
2. Confirm the changed pages load correctly
3. If a new event was added, verify the event listing and detail page
4. Test checkout flow on any event you modified
5. Share an event URL on Slack or iMessage to confirm OG image appears correctly

---

## Rollback

If a deploy introduces a critical issue:

1. Identify the last good commit: `git log --oneline`
2. Check out the previous version: `git checkout {commit-hash} -- path/to/broken-file.html`
3. Commit the revert: `git commit -m "Revert broken change in {file}"`
4. Push and redeploy following steps 4-6 above

For a full rollback, coordinate with Johnny before reverting database or Supabase changes.

---

## Supabase Changes

Schema changes (migrations) and edge function deployments are **not** handled by rsync. Use the Supabase CLI for those operations. Migrations must be applied in order and never modified after production application.
