import { redis } from './redis.js';
import { REDIS_KEYS } from './config.js';

export async function banUser(discordId) {
    await redis.set(`${REDIS_KEYS.BAN_USER_PREFIX}${discordId}`, '1');
}

export async function unbanUser(discordId) {
    await redis.del(`${REDIS_KEYS.BAN_USER_PREFIX}${discordId}`);
}

export async function isUserBanned(discordId) {
    if (!discordId) return false;
    return (await redis.exists(`${REDIS_KEYS.BAN_USER_PREFIX}${discordId}`)) === 1;
}

export async function banIp(ip) {
    await redis.set(`${REDIS_KEYS.BAN_IP_PREFIX}${ip}`, '1');
}

export async function unbanIp(ip) {
    await redis.del(`${REDIS_KEYS.BAN_IP_PREFIX}${ip}`);
}

export async function isIpBanned(ip) {
    if (!ip) return false;
    return (await redis.exists(`${REDIS_KEYS.BAN_IP_PREFIX}${ip}`)) === 1;
}

export async function listBans() {
    const userKeys = await redis.keys(`${REDIS_KEYS.BAN_USER_PREFIX}*`);
    const ipKeys = await redis.keys(`${REDIS_KEYS.BAN_IP_PREFIX}*`);
    return {
        users: userKeys.map((k) => k.slice(REDIS_KEYS.BAN_USER_PREFIX.length)),
        ips: ipKeys.map((k) => k.slice(REDIS_KEYS.BAN_IP_PREFIX.length)),
    };
}
