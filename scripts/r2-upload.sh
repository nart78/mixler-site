#!/bin/bash
# Upload a file to Mixler's Cloudflare R2 bucket
# Usage: ./scripts/r2-upload.sh <local-file> [r2-path]
# Example: ./scripts/r2-upload.sh video1.mp4 videos/video1.mp4

set -e

R2_ENDPOINT="https://a7331595632e7556c5f317fe7323101c.r2.cloudflarestorage.com"
R2_BUCKET="mixler-media"
R2_PUBLIC="https://pub-b19b56eaa25a4bff83dc6d7c11cbb63b.r2.dev"
CREDS_FILE="$HOME/.aws/credentials-r2"

if [ -z "$1" ]; then
  echo "Usage: $0 <local-file> [r2-path]"
  echo "Example: $0 video1.mp4 videos/video1.mp4"
  exit 1
fi

LOCAL_FILE="$1"
R2_PATH="${2:-$(basename "$LOCAL_FILE")}"

if [ ! -f "$LOCAL_FILE" ]; then
  echo "Error: File not found: $LOCAL_FILE"
  exit 1
fi

export AWS_SHARED_CREDENTIALS_FILE="$CREDS_FILE"

echo "Uploading $LOCAL_FILE -> s3://$R2_BUCKET/$R2_PATH"
aws s3 cp "$LOCAL_FILE" "s3://$R2_BUCKET/$R2_PATH" \
  --endpoint-url "$R2_ENDPOINT" \
  --profile r2 \
  --region auto

echo ""
echo "Public URL: $R2_PUBLIC/$R2_PATH"
