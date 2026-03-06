# Mixler Site

## Deployment
- Repo: `nart78/mixler-site`
- IONOS VPS (198.71.51.250), domain: mixler.ca
- Nginx serving from `/var/www/mixler.ca/`
- Static HTML/CSS/JS + Supabase backend
- Deploy: `rsync -avz --delete ~/mixler-site/ root@198.71.51.250:/var/www/mixler.ca/ --exclude='.git' --exclude='supabase' --exclude='scripts' --exclude='CLAUDE.md' --exclude='.github'`
- **Always push to git and deploy to VPS after making changes.**

## Brand Rules
- **NO purple anywhere.** All headings/accents use blue (#153db6).
- Colors: Blue #153db6, Pink #ff3465, Light gray #f5f5f7
- Fonts: League Spartan (headings), Inter (body)
- Never use em dashes in copy

## Structure
- `index.html`, `login.html`, `account.html`, `events.html`, `event.html`
- `admin/` — admin interface
- `supabase/migrations/` — database migrations
- `scripts/` — utility scripts
