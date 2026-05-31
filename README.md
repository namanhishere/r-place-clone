# lẩu/Place

A real-time, collaborative pixel-art canvas — an [r/place](https://en.wikipedia.org/wiki/R/place) clone. Users log in with Discord, place one pixel at a time on a shared grid, and watch everyone else's pixels appear live over WebSocket. The board can grow on a schedule, and admins get a full control dashboard.

> UI copy is in Vietnamese. All brand strings are configurable via environment variables (see [Branding](#branding)).

## Features

- **Live collaborative canvas** — pixels broadcast to all connected clients in real time via WebSocket.
- **Discord login required to place** — anonymous visitors can view; placing needs a Discord account. Cooldown is enforced per Discord user.
- **Dynamic auto-expanding board** — the grid can grow left / right / up / down. Schedule expansions at future dates ("milestones") and the server grows the board automatically, preserving existing art.
- **Admin dashboard** (`/admin.html`) — gated by a Discord user-ID allowlist. Live stats + canvas preview, manual board expansion, milestone management, region clear ("superpaint"), user/IP bans, live cooldown adjustment, and a recent-activity feed.
- **Efficient storage** — the entire canvas is a single Redis string at 4 bits per pixel (16 colors).
- **Standalone exporters** — dump the canvas to PNG or render a timelapse video.

## Tech stack

- **Runtime:** Node.js (ESM), Express 5
- **Realtime:** `ws` WebSocket server
- **Storage:** Redis via `ioredis`
- **Auth:** Discord OAuth2 + JWT session cookie (`jsonwebtoken`, `cookie`)
- **Frontend:** vanilla HTML/CSS/JS canvas (no framework, no build step)
- **Tooling (standalone):** Python (`Pillow`, `redis`) for export/timelapse

## Quick start

**Prerequisites:** Node.js 18+ (uses native `fetch`), Docker (for Redis), and a Discord application.

```bash
# 1. Start Redis
docker compose up -d redis

# 2. Configure environment
cp .env.example .env
#    then fill in DISCORD_*, SESSION_SECRET, and ADMIN_DISCORD_IDS

# 3. Install dependencies
npm install

# 4. Run
npm start
```

The app serves on `http://localhost:8980` by default. Open it, log in with Discord, and start placing pixels.

## Discord setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Under **OAuth2**, copy the **Client ID** and **Client Secret** into `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.
3. Add a **redirect URI** that exactly matches `DISCORD_REDIRECT_URI` (e.g. `http://localhost:8980/auth/callback`).
4. The app requests only the `identify` scope.
5. To grant yourself admin access, put your Discord user ID in `ADMIN_DISCORD_IDS` (comma-separated for multiple admins).

## Configuration

All configuration is via environment variables (loaded from `.env`). See [.env.example](.env.example) for the full list with inline docs.

### Server
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8980` | HTTP/WebSocket port |
| `NODE_ENV` | `development` | Set `production` to enable HTML template caching + secure cookies |

### Auth & access
| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Secret used to sign JWT session cookies (required). Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord OAuth2 app credentials |
| `DISCORD_REDIRECT_URI` | OAuth2 callback URL; must match the Discord app setting exactly |
| `ADMIN_DISCORD_IDS` | Comma-separated Discord user IDs allowed into the admin dashboard |

### Security
| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | _(empty)_ | Comma-separated origins allowed for WebSocket connections and admin/logout mutations. **Empty = same-origin only** (recommended). Set this only for split frontend/API deploys. |

### Branding
Every user-facing brand string is env-driven, so you can rebrand without touching HTML.

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAND_NAME` | `lẩu/Place` | Main name (page title, navbar) |
| `BRAND_NAME_LOWER` | lowercased `BRAND_NAME` | Used in social share titles |
| `BRAND_ADMIN_NAME` | `<BRAND_NAME> Admin` | Admin dashboard title |
| `BRAND_DESCRIPTION` | `Place thập cẩm` | Social share tagline |
| `BRAND_SESSION_LABEL` | `Beta Session` | Small label beside the navbar title |
| `BRAND_URL` | _(empty)_ | Canonical site URL (`og:url`) |
| `BRAND_IMAGE` | `<BRAND_URL>/banner.png` | Social share image |

## Project structure

```
index.js              HTTP + WebSocket server, pixel placement, auth routes
src/
  config.js           constants, Redis key names, palette
  redis.js            shared Redis client + board config accessors
  board.js            canvas read/init, expansion repack, superpaint
  auth.js             Discord OAuth2 + JWT session cookies
  moderation.js       user / IP bans
  milestones.js       scheduled-expansion CRUD + scheduler
  admin.js            /api/admin/* REST routes
  security.js         CSRF (same-origin) + WebSocket origin guard
  branding.js         {{TOKEN}} HTML templating from env
public/
  index.html          live canvas client
  admin.html          admin dashboard
  new.html            autoplacer variant
export.py             decode Redis canvas → PNG
video.py              render timelapse
docker-compose.yml    Redis service
```

See [AGENTS.md](AGENTS.md) and [src/AGENTS.md](src/AGENTS.md) for deeper architecture notes.

## How it works

### Canvas data model
The canvas is a single Redis string packed at **4 bits per pixel** (2 pixels per byte, high nibble first). For a pixel at `(x, y)`:

```
pixelIndex = y * width + x
byteIndex  = pixelIndex >> 1
nibble     = (pixelIndex & 1) === 0 ? high : low
```

Color index `15` (white) means "empty". Board dimensions are **dynamic** and stored in the Redis hash `rplace:config` — always read them via `getConfig()` rather than the `DEFAULT_*` constants.

### Board expansion
Growing **right** or **down** just enlarges the buffer. Growing **left** or **up** shifts every existing pixel's coordinates, so `expandBoard()` repacks the whole buffer and rewrites the placement-history stream with shifted coordinates. New dimensions are broadcast to all clients (`BOARD_RESIZE`).

### Realtime protocol (WebSocket)
The server sends these message types:

| Type | Meaning |
|------|---------|
| `INIT_DATA` | Full grid + palette + dims + cooldown on connect |
| `PIXEL_UPDATE` | A single pixel changed |
| `BOARD_RESIZE` | Board dimensions changed |
| `ONLINE_COUNT_UPDATE` | Connected-client count changed |
| `COOLDOWN_START` | Your placement was accepted; cooldown begins |
| `AUTH_REQUIRED` | You must log in to place |
| `ERROR` | Rejected (banned, invalid, on cooldown, event ended) |

Clients send `PLACE_PIXEL` with `{ x, y, colorIndex }`.

## HTTP API

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/auth/login` | Redirect to Discord OAuth2 |
| `GET` | `/auth/callback` | OAuth2 callback; sets session cookie |
| `POST` | `/auth/logout` | Clear session (same-origin only) |
| `GET` | `/api/me` | Current session info (`loggedIn`, `isAdmin`, …) |

### Admin (`/api/admin/*`)
All require an admin session cookie. Mutations also require a same-origin `Origin` header.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/stats` | Board size, online count, total placements, canvas preview |
| `POST` | `/expand` | Grow the board `{ direction, amount }` |
| `GET` / `POST` | `/milestones` | List / create scheduled expansions |
| `DELETE` | `/milestones/:id` | Delete a milestone |
| `POST` | `/superpaint` | Clear a rectangle `{ x1, y1, x2, y2 }` |
| `GET` | `/bans` | List banned users/IPs |
| `POST` | `/ban` / `/unban` | Ban or unban `{ type: 'user'\|'ip', value }` |
| `POST` | `/cooldown` | Set global cooldown `{ seconds }` |
| `GET` | `/activity` | Recent placements feed |

## Exporting the canvas

Two standalone Python scripts read directly from Redis (install deps with `pip install pillow redis`):

```bash
python export.py     # decode the current canvas to canvas.png
python video.py      # render a timelapse from placement history
```

`export.py` mirrors the exact 4-bit decode logic from the server — if you ever change the packing format, update both.

## Notes & caveats

- **No automated tests.** `npm test` is a stub; verification is done via ad-hoc driver scripts and browser checks.
- **`expandBoard` rewrites the entire canvas buffer and history in one pass.** Fine at current sizes, but it will block the event loop on very large boards — make it incremental if boards grow huge.
- **`public/new.html`** (the autoplacer variant) is not served through the branding templater and still carries hardcoded brand strings. The main client (`/`) and admin (`/admin.html`) are fully templated.
- **Cooldown is per Discord user**, keyed `rplace:cooldown:user:<id>` — not per IP.
- **Placement hard-stops** at `EVENT_END_DATE` (in `src/config.js`); after that the server rejects all pixels.
- Set `NODE_ENV=production` in real deployments to enable HTML caching and `Secure` session cookies.

## License

ISC (see `package.json`).
