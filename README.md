# AGS Interactive Series

## Run in GitHub Codespaces
1. Push this folder to a GitHub repo, then Code > Codespaces > Create codespace.
2. Wait for `npm install` to finish, then run: `npm run dev`
3. Open the forwarded port 8787 (the Ports tab). Username/password login works right away.
4. For Discord login: create a Discord app, paste the "Discord redirect URL" printed by the script into
   OAuth2 > Redirects, then put the client ID and secret in `.dev.vars` and restart `npm run dev`.
5. To let other people try it, right-click port 8787 in the Ports tab > Port Visibility > Public.

Accounts are stored in a local simulated KV, so they reset if you delete `.wrangler/`.

## Deploy to Cloudflare (from the Codespace)
`wrangler login` does not work inside a Codespace, so use an API token instead:
1. Cloudflare dashboard > My Profile > API Tokens > Create Token > "Edit Cloudflare Workers" template.
2. In GitHub: Settings > Codespaces > Secrets, add `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`
   if you have more than one account), give it access to this repo, then rebuild the Codespace.
3. `npx wrangler kv namespace create USERS` and paste the id into `wrangler.toml`.
4. `npm run deploy` (first deploy creates the Worker and the Durable Object).
5. Set secrets (only works after step 4): `npx wrangler secret put SESSION_SECRET`, then the same for
   `HOST_KEY`, `GODOT_KEY`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
6. Discord redirect: `https://YOUR-WORKER.workers.dev/auth/discord/callback`.
7. Godot `base_url` = that same workers.dev URL. No HTML edits are needed for production.

## Poll backend (added)
- `room.js` is the Durable Object: poll state, one vote per account, results, suggestions, WebSocket updates.
- `/host` is the host page. Log in with HOST_KEY (see `.dev.vars` locally): open polls, end the episode,
  tick suggestions as "used" (the credits list builds itself).
- Godot: copy `godot/PollResults.gd` into your project, add it as an Autoload named PollResults, set
  `base_url` and `api_key` (GODOT_KEY). Give each poll a key on the host page (e.g. `signal_cause`),
  then in a scene call `PollResults.get_winner("signal_cause", "Creature")`.
- For a real deploy: `wrangler secret put HOST_KEY` and `GODOT_KEY` (long random strings).
