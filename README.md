# AGS Interactive Series (Cloudflare Workers)

Runs entirely on Cloudflare: a Worker serving the site (`public/`), a Durable Object (`room.js`) for live
polls, and a KV namespace for username/password accounts. Nothing else to host.

## Deploy (all in the Cloudflare dashboard, no CLI or API token needed)

### 1. Create the KV namespace
Storage & Databases > KV > Create instance, name it `USERS`. Copy its ID and paste it into `wrangler.toml`
in place of `PASTE_KV_ID_HERE`. Commit and push. (The first deploy fails until this is done.)

### 2. Create the Worker from GitHub
Workers & Pages > Create application > Import a repository > pick this repo.
- Worker name: must be exactly `ags-interactive` (it has to match `name` in `wrangler.toml`; change both
  if you want a different name).
- Build command: leave empty.
- Deploy command: `npx wrangler deploy`.

The first build creates the Worker, the Durable Object (`Room`) and the static site automatically.
Your address appears on the Worker page, like `https://ags-interactive.YOUR-SUBDOMAIN.workers.dev`.

### 3. Add secrets
Worker > Settings > Variables and Secrets > Add, type **Secret**:

| Name | Value |
|---|---|
| `SESSION_SECRET` | any long random string (signs login cookies) |
| `HOST_KEY` | your password for the `/host` page |
| `GODOT_KEY` | a long random string Godot uses to read results |
| `DISCORD_CLIENT_ID` | from your Discord app (skip Discord login if you don't want it) |
| `DISCORD_CLIENT_SECRET` | from your Discord app |

Then trigger a redeploy (Deployments > Retry, or push any commit) so the Worker picks them up.

### 4. Discord login (optional)
discord.com/developers/applications > your app > OAuth2 > Redirects > add
`https://YOUR-WORKER-ADDRESS/auth/discord/callback` (exact match, https).
Username/password login works without Discord.

### 5. Connect Godot
Copy `godot/PollResults.gd` into your project and add it as an Autoload named `PollResults`
(Project > Project Settings > Globals > Autoload). Set `base_url` to your Worker address (no trailing
slash) and `api_key` to your `GODOT_KEY`.

## Godot can open polls too
`PollResults.open_poll("signal_cause", "What is causing the strange signal?", ["Creature", "Rogue AI", "Survivor"], 45)`
opens a poll on the site (uses `GODOT_KEY`, not your host password). Call it from a scene script or an
AnimationPlayer call-method track 30-60 s before the outcome matters. It closes any poll still open.

## Stream overlay (OBS)
In OBS: Sources > + > Browser. URL `https://YOUR-WORKER-ADDRESS/overlay` (add `?side=left` for the left
corner). Width 1920, Height 1080. Leave "Custom CSS" as is; the page background is already transparent.
It appears when a poll opens (with countdown and live results) and disappears when there is no poll.
The overlay is a separate OBS layer, so your Godot YouTube renders stay clean.

## Passwords
Viewers can change their password in Account Settings. If someone forgets it, reset it from `/host`
("Reset a viewer's password") and tell them the temporary one.

## Check it works
1. Open your Worker address, click Account Settings, create an account.
2. Open `/host`, enter `HOST_KEY`, open a poll.
3. On the Live page (second tab or phone) the poll appears with a countdown. Vote; the numbers update live.
4. Close the poll. Godot: `PollResults.get_winner("signal_cause", "Creature")` returns the winner.

## Using it on stream
- `/` is the audience site, `/host` is your control page.
- Open polls 30-60 seconds before the outcome matters. Give each poll a key (e.g. `signal_cause`) on the
  host page; Godot asks for it by that key, with a default in case nobody voted.
- End the episode from `/host` to show the "What should happen next?" box. Tick suggestions as "used" and
  the credits list builds itself.

## Known limits
- Cloudflare's free plan gives ~10 ms of processing per request. Password hashing may exceed that, which
  makes username/password signup or login fail. Discord login is unaffected. The paid Workers plan
  ($5/month) removes the limit.
- No spam protection on signup/login yet: add a Cloudflare rate limiting rule for `/auth/login` and
  `/auth/register` before a big stream.
- No password reset.
- Very large audiences: every vote re-sends the tally to every viewer; batch updates if you outgrow this.

## Optional local test
Copy `.dev.vars.example` to `.dev.vars`, run `npm install` then `npm run dev`.
