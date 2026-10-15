#!/usr/bin/env bash
# Mock — deploy the prep canvas as a Google Meet add-on and install it for your own account.
# Usage: scripts/meet-addon.sh PROJECT_ID [APP_URL]
#   PROJECT_ID  the Google Cloud project (its number is looked up)
#   APP_URL     where the app is served, default https://adeelahmad.github.io/Mock/app/
# Needs gcloud signed in as the account that will use the add-on. See docs/canvas.md.
set -euo pipefail
project="${1:?usage: scripts/meet-addon.sh PROJECT_ID [APP_URL]}"
app="${2:-https://adeelahmad.github.io/Mock/app/}"
app="${app%/}/"
origin="$(printf '%s' "$app" | sed -E 's#^(https://[^/]+).*#\1#')"
number="$(gcloud projects describe "$project" --format='value(projectNumber)')"

gcloud services enable gsuiteaddons.googleapis.com appsmarket-component.googleapis.com meet.googleapis.com --project "$project"

file="$(mktemp)"
sed -e "s#https://adeelahmad.github.io/Mock/app/#${app}#g" \
    -e "s#\"https://adeelahmad.github.io\"#\"${origin}\"#" \
    -e "s#PROJECT_NUMBER#${number}#" "$(dirname "$0")/../addon/deployment.json" > "$file"
echo "Deployment:"; cat "$file"

if gcloud workspace-add-ons deployments describe mock --project "$project" >/dev/null 2>&1; then
  gcloud workspace-add-ons deployments replace mock --deployment-file="$file" --project "$project"
else
  gcloud workspace-add-ons deployments create mock --deployment-file="$file" --project "$project"
fi
gcloud workspace-add-ons deployments install mock --project "$project"
echo "Installed. In a Meet call: Meeting tools → Add-ons → Mock."
