import { Redis } from 'ioredis';
import {
    REDIS_KEYS,
    DEFAULT_GRID_WIDTH,
    DEFAULT_GRID_HEIGHT,
    DEFAULT_COOLDOWN_SECONDS,
} from './config.js';

// Single shared Redis connection (defaults to localhost:6379).
export const redis = new Redis();

/**
 * Read the live board configuration from Redis.
 * Falls back to defaults if a field is missing.
 * @returns {Promise<{width:number, height:number, cooldownSeconds:number}>}
 */
export async function getConfig() {
    const cfg = await redis.hgetall(REDIS_KEYS.CONFIG);
    return {
        width: cfg.width ? parseInt(cfg.width, 10) : DEFAULT_GRID_WIDTH,
        height: cfg.height ? parseInt(cfg.height, 10) : DEFAULT_GRID_HEIGHT,
        cooldownSeconds: cfg.cooldownSeconds
            ? parseInt(cfg.cooldownSeconds, 10)
            : DEFAULT_COOLDOWN_SECONDS,
    };
}

/**
 * Persist the board dimensions to Redis config.
 */
export async function setDimensions(width, height) {
    await redis.hset(REDIS_KEYS.CONFIG, 'width', width, 'height', height);
}

/**
 * Persist the cooldown seconds to Redis config.
 */
export async function setCooldownSeconds(seconds) {
    await redis.hset(REDIS_KEYS.CONFIG, 'cooldownSeconds', seconds);
}
