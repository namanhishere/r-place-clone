# src/ — BACKEND MODULES

Pure-ish modules consumed by `../index.js`. No HTTP server here except `admin.js` route registration. See root AGENTS.md for canvas data model and Redis key rules.

## MODULE MAP
| File | Role | Key exports |
|------|------|-------------|
| `config.js` | Constants only, no logic | `REDIS_KEYS`, `COLORS`, `DEFAULT_*`, `EVENT_END_DATE`, `DIRECTIONS`, `MAX_DIMENSION` |
| `redis.js` | Shared ioredis client + config hash accessors | `redis`, `getConfig`, `setDimensions`, `setCooldownSeconds` |
| `board.js` | Canvas read/init + expansion repack + superpaint | `getCanvasAsArray`, `getCanvasBase64`, `expandBoard`, `clearRectangleOnCanvas`, `cleanHistoryInRectangle` |
| `auth.js` | Discord OAuth2 + JWT cookie + admin middleware | `buildDiscordAuthUrl`, `exchangeCodeForUser`, `createSessionToken`, `attachUser`, `requireAdmin`, `isAdmin` |
| `moderation.js` | Ban/unban user+IP in Redis | `isUserBanned`, `isIpBanned`, `listBans` |
| `milestones.js` | Milestone CRUD + auto-expand scheduler | `createMilestone`, `listMilestones`, `startMilestoneScheduler` |
| `admin.js` | Registers all `/api/admin/*` routes | `registerAdminRoutes(app, deps)` |
| `security.js` | Origin allowlist (CSRF + WS) | `requireSameOrigin`, `verifyWsClient` |
| `branding.js` | `{{TOKEN}}` HTML templating from env | `renderTemplate(filePath)` |

## INVARIANTS (do not break)
- `expandBoard` for `left`/`up` shifts every existing pixel → repacks whole buffer AND rewrites history coords via `shiftHistoryCoordinates`. `right`/`down` only grow the buffer, no shift.
- `startMilestoneScheduler` marks a milestone `fired` **before** calling `expandBoard` — crash-safety against double-expansion. Order is deliberate.
- `admin.js` receives `requireSameOrigin` via `deps` and applies it to EVERY mutation (POST/DELETE) before `requireAdmin`. Reads (GET) stay unguarded.
- `getConfig()` is the only source of truth for board dims. Never trust `DEFAULT_GRID_*` past first init.

## DEPENDENCY DIRECTION
`config.js` ← everything. `redis.js` ← board/auth/moderation/milestones/admin. `board.js` ← milestones, admin. No cycles; `index.js` is the only orchestrator.

## GOTCHAS
- `auth.js` throws if `SESSION_SECRET` unset — fail-fast by design, do not swallow.
- `branding.js` caches file reads only when `NODE_ENV=production`.
- Ban checks (`moderation.js`) run in `index.js handlePlacePixel`, not in middleware — WS path has no Express middleware chain.
