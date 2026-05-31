// --- SHARED CONFIGURATION & CONSTANTS ---

// Default board dimensions (used only on first-ever initialization).
// After that, the live dimensions live in Redis and can grow via expansion.
export const DEFAULT_GRID_WIDTH = 960;
export const DEFAULT_GRID_HEIGHT = 540;

export const BITS_PER_PIXEL = 4; // 2^4 = 16 colors
export const DEFAULT_COOLDOWN_SECONDS = 5;
export const DEFAULT_COLOR_INDEX = 15; // white

// Event end date (kept from original behaviour).
export const EVENT_END_DATE = new Date(Date.UTC(2026, 7, 17, 23, 59, 59));

// Number of most-recent history entries to scan when cleaning a region.
export const HISTORY_CLEANUP_RANGE = 50000;

export const COLORS = [
    '#FF4500', '#FFA800', '#FFD635', '#00A368',
    '#7EED56', '#2450A4', '#3690EA', '#51E9F4',
    '#811E9F', '#B44AC0', '#FF99AA', '#9C6926',
    '#000000', '#898D90', '#D4D7D9', '#FFFFFF'
];

export const REDIS_KEYS = {
    CANVAS: 'rplace:canvas-new',          // bitmap buffer for the canvas
    HISTORY: 'rplace:history',            // stream of pixel placements
    COOLDOWN_PREFIX: 'rplace:cooldown:',  // prefix for per-user cooldown keys
    CONFIG: 'rplace:config',              // hash: width, height, cooldownSeconds
    BAN_USER_PREFIX: 'rplace:ban:user:',  // banned discord user ids
    BAN_IP_PREFIX: 'rplace:ban:ip:',      // banned ips
    MILESTONES: 'rplace:milestones',      // hash id -> JSON milestone
};

// Valid expansion directions.
export const DIRECTIONS = ['left', 'right', 'up', 'down'];

// Hard cap to avoid runaway memory if a milestone is misconfigured.
export const MAX_DIMENSION = 8000;
