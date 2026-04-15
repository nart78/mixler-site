#!/bin/bash
# Mixler site deploy: regenerate pSEO pages, rsync to VPS, regenerate OG files.
# Run from anywhere. Produces a single clean deploy step.

set -euo pipefail

REPO_ROOT="$(dirname "$(readlink -f "$0")")/.."
cd "$REPO_ROOT"

VPS_HOST="root@198.71.51.250"
VPS_PATH="/var/www/mixler.ca/"
VPS_SCRIPT_PATH="/var/www/mixler.ca/scripts/generate-og.sh"

echo "==> Regenerating pSEO pages + sitemap"
python3 seo/generate.py

echo
echo "==> Rsyncing site to VPS"
rsync -avz --delete "${REPO_ROOT}/" "${VPS_HOST}:${VPS_PATH}" \
  --exclude='.git' \
  --exclude='supabase' \
  --exclude='scripts' \
  --exclude='CLAUDE.md' \
  --exclude='.github' \
  --exclude='og' \
  --exclude='seo' \
  --exclude='GEO-AUDIT-REPORT.md' \
  --exclude='JAI_HANDOFF.md' \
  --exclude='UNKNOWNS.md' \
  --exclude='.env' \
  --exclude='docs'

echo
echo "==> Uploading generate-og.sh to VPS"
scp "${REPO_ROOT}/scripts/generate-og.sh" "${VPS_HOST}:${VPS_SCRIPT_PATH}"
ssh "${VPS_HOST}" "chmod +x ${VPS_SCRIPT_PATH}"

echo
echo "==> Regenerating OG static files on VPS"
ssh "${VPS_HOST}" "bash ${VPS_SCRIPT_PATH}"

echo
echo "==> Deploy complete."
