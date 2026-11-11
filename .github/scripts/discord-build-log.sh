#!/usr/bin/env bash
# Posts a "new version is live" message to the Discord build-log channel, with the
# player-facing changes: the "- " lines added to CHANGELOG.md since the last
# successfully published version. Run by .github/workflows/deploy.yml.
#
# Environment:
#   WEBHOOK     Discord webhook URL (secret DISCORD_WEBHOOK_BUILD). Empty = skip.
#   RESULT      "success" or "failure"
#   PREV_SHA    commit of the last successful publish (may be empty)
#   SHA         commit being published
#   RUN_NUMBER, RUN_URL, SITE_URL
#   DRY_RUN=1   print the message instead of sending it (for testing)
set -euo pipefail

if [ -z "${WEBHOOK:-}" ] && [ -z "${DRY_RUN:-}" ]; then
  echo "DISCORD_WEBHOOK_BUILD secret not set: skipping Discord post."
  exit 0
fi

if [ "$RESULT" = "success" ]; then
  if [ -n "${PREV_SHA:-}" ] && git cat-file -e "${PREV_SHA}^{commit}" 2>/dev/null; then
    notes=$(git diff "$PREV_SHA" "$SHA" -- CHANGELOG.md | grep -E '^\+- ' | sed 's/^+//' || true)
  else
    # No earlier publish to compare with: use the newest section of the changelog.
    notes=$(awk '/^## /{n++; next} n==1 && /^- /' CHANGELOG.md)
  fi
  [ -n "$notes" ] || notes="_Behind-the-scenes update, no gameplay changes._"
  title="🚀 Version ${RUN_NUMBER} is live"
  description="${notes}

[▶ Play the game](${SITE_URL})"
  color=5763719 # green
else
  title="⚠️ Version ${RUN_NUMBER} failed to build"
  description="The live game was **not** updated. [See what went wrong](${RUN_URL})"
  color=15548997 # red
fi

payload=$(jq -n --arg t "$title" --arg d "${description:0:4000}" --arg u "$SITE_URL" --argjson c "$color" \
  '{username: "Fleet Game builds", embeds: [{title: $t, url: $u, description: $d, color: $c}]}')

if [ -n "${DRY_RUN:-}" ]; then
  echo "$payload"
else
  curl -fsS -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" \
    || echo "::warning::Could not post to Discord"
fi
