import jwt from 'jsonwebtoken';
import * as cookie from 'cookie';

const DISCORD_API = 'https://discord.com/api';
const COOKIE_NAME = 'rplace_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function getJwtSecret() {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
        throw new Error('SESSION_SECRET is not configured.');
    }
    return secret;
}

export function getAdminIds() {
    return (process.env.ADMIN_DISCORD_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

export function isAdmin(discordId) {
    return getAdminIds().includes(String(discordId));
}

export function buildDiscordAuthUrl(state) {
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID || '',
        redirect_uri: process.env.DISCORD_REDIRECT_URI || '',
        response_type: 'code',
        scope: 'identify',
        state,
    });
    return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForUser(code) {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID || '',
            client_secret: process.env.DISCORD_CLIENT_SECRET || '',
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI || '',
        }),
    });

    if (!tokenRes.ok) {
        throw new Error(`Discord token exchange failed: ${tokenRes.status}`);
    }
    const token = await tokenRes.json();

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) {
        throw new Error(`Discord user fetch failed: ${userRes.status}`);
    }
    const user = await userRes.json();
    return {
        id: user.id,
        username: user.global_name || user.username,
        avatar: user.avatar,
    };
}

export function createSessionToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, avatar: user.avatar },
        getJwtSecret(),
        { expiresIn: SESSION_TTL_SECONDS }
    );
}

export function buildSessionCookie(token) {
    return cookie.serialize(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_TTL_SECONDS,
        path: '/',
    });
}

export function buildLogoutCookie() {
    return cookie.serialize(COOKIE_NAME, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
        path: '/',
    });
}

function verifyToken(token) {
    if (!token) return null;
    try {
        return jwt.verify(token, getJwtSecret());
    } catch {
        return null;
    }
}

export function getUserFromCookieHeader(cookieHeader) {
    if (!cookieHeader) return null;
    const parsed = cookie.parse(cookieHeader);
    return verifyToken(parsed[COOKIE_NAME]);
}

export function attachUser(req, res, next) {
    req.user = getUserFromCookieHeader(req.headers.cookie);
    next();
}

export function requireAdmin(req, res, next) {
    const user = getUserFromCookieHeader(req.headers.cookie);
    if (!user || !isAdmin(user.id)) {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    req.user = user;
    next();
}
