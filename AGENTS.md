# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-31
**Commit:** 985ed03
**Branch:** to-aws

## OVERVIEW
Real-time r/place clone (canvas pixel-art). Node ESM + Express 5 + `ws` WebSocket + Redis (ioredis). Discord OAuth login, dynamic auto-expanding board, admin dashboard. UI copy is Vietnamese; brand strings are env-driven.

## STRUCTURE
```
index.js              # server: HTTP + WS orchestration, pixel placement, auth routes
src/                  # backend modules (see src/AGENTS.md)
public/
  index.html          # live canvas client (served templated at /)
  admin.html          # admin dashboard (served templated at /admin.html)
  new.html            # autoplacer variant — NOT templated, has stale hardcoded brand
export.py             # decode Redis canvas buffer → PNG (standalone)
video.py              # timelapse render (standalone)
docker-compose.yml    # Redis only
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Pixel placement, WS messages, cooldown | `index.js` `handlePlacePixel` |
| Board expansion / nibble packing | `src/board.js` |
| Discord OAuth, JWT session cookie | `src/auth.js` |
| Admin REST API | `src/admin.js` |
| Scheduled board growth | `src/milestones.js` |
| CSRF / WS origin guard | `src/security.js` |
| Brand env → HTML tokens | `src/branding.js` |
| Redis client, dims, config | `src/redis.js` + `src/config.js` |

## CANVAS DATA MODEL (critical)
- Canvas = single Redis string, **4 bits per pixel**, 2 pixels per byte, high nibble first.
- `pixelIndex = y * width + x`; `byteIndex = pixelIndex >> 1`; high nibble when `(pixelIndex & 1) === 0`.
- Default color index 15 = white = "empty". Fresh buffer filled `0xFF`.
- Board dims are **dynamic**, stored in Redis hash `rplace:config` — NOT the `DEFAULT_*` constants. Always read via `getConfig()`.
- `export.py` mirrors this decode in Python — keep both in sync if packing changes.

## CONVENTIONS
- ESM only (`"type": "module"`); import with `.js` extensions.
- All Redis keys centralized in `REDIS_KEYS` (`src/config.js`). Never inline key strings.
- 4-space indent, single quotes, semicolons.
- Comments are actively discouraged — only non-obvious invariants get one (see existing comments in `board.js` / `milestones.js`).
- Cooldown is keyed **per Discord user** (`rplace:cooldown:user:<id>`), not per IP.

## ANTI-PATTERNS (THIS PROJECT)
- No type-suppression equivalents; no empty `catch {}` (always log or surface).
- Never reuse Redis stream IDs on `XADD` after delete — rebuild with fresh IDs (see `board.js shiftHistoryCoordinates`).
- Never put `requireAdmin` before `requireSameOrigin` on mutations — origin check must run first.
- `public/new.html` is a concurrently-edited variant; do not assume it matches `index.html`.

## COMMANDS
```bash
docker compose up -d redis      # start Redis (required)
cp .env.example .env            # then fill Discord + SESSION_SECRET + ADMIN_DISCORD_IDS
npm install
npm start                       # node index.js, default PORT 8980
python export.py                # dump current canvas to canvas.png
```

## NOTES
- No test runner configured (`npm test` is a stub). Verification done via ad-hoc driver scripts + browser checks.
- `ALLOWED_ORIGINS` empty = same-origin only (secure default). Set for split frontend/API deploys.
- Templated routes (`/`, `/index.html`, `/admin.html`) render brand tokens; HTML cached only when `NODE_ENV=production`.
- Event hard-stops at `EVENT_END_DATE` (`src/config.js`) — placement rejected after.
- `expandBoard` rewrites the entire canvas buffer + history in one pass; fine at current sizes, will block on very large boards.
