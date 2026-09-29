#!/usr/bin/env bash
# Runs the site + login Worker locally. Works in GitHub Codespaces and on a normal machine.
set -e
cd "$(dirname "$0")/.."

# First run: create .dev.vars with a random session secret so password login works immediately.
if [ ! -f .dev.vars ]; then
  cat > .dev.vars <<VARS
SESSION_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '=+/\n')
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
VARS
  echo "Created .dev.vars (add your Discord ID/secret there to enable Discord login)."
fi

for K in HOST_KEY GODOT_KEY; do
  grep -q "^$K=" .dev.vars || echo "$K=$(head -c 24 /dev/urandom | base64 | tr -d '=+/\n')" >> .dev.vars
done
echo "Host page password + Godot key are in .dev.vars (HOST_KEY / GODOT_KEY)."

ARGS=(--ip 0.0.0.0 --port 8787)
if [ -n "$CODESPACE_NAME" ]; then
  PUBLIC_URL="https://${CODESPACE_NAME}-8787.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  ARGS+=(--var "PUBLIC_URL:${PUBLIC_URL}")
  echo
  echo "Site URL:            ${PUBLIC_URL}"
  echo "Discord redirect URL: ${PUBLIC_URL}/auth/discord/callback"
  echo
fi

exec npx wrangler dev "${ARGS[@]}"
