import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

import { redis, getConfig } from './src/redis.js';
import {
    REDIS_KEYS,
    COLORS,
    EVENT_END_DATE,
    DEFAULT_COLOR_INDEX,
    BITS_PER_PIXEL,
} from './src/config.js';
import {
    initializeCanvasIfNeeded,
    getCanvasAsArray,
} from './src/board.js';
import {
    buildDiscordAuthUrl,
    exchangeCodeForUser,
    createSessionToken,
    buildSessionCookie,
    buildLogoutCookie,
    getUserFromCookieHeader,
    attachUser,
    isAdmin,
} from './src/auth.js';
import { isUserBanned, isIpBanned } from './src/moderation.js';
import { registerAdminRoutes } from './src/admin.js';
import { startMilestoneScheduler } from './src/milestones.js';
import { requireSameOrigin, verifyWsClient } from './src/security.js';
import { renderTemplate } from './src/branding.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8980;

const app = express();
app.use(express.json());
app.use(attachUser);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, verifyClient: verifyWsClient });

const getOnlineCount = () => wss.clients.size;

function broadcast(obj) {
    const message = JSON.stringify(obj);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
    });
}

const broadcastOnlineCount = () =>
    broadcast({ type: 'ONLINE_COUNT_UPDATE', payload: { numOfClients: getOnlineCount() } });

async function broadcastDimensions(dims) {
    broadcast({ type: 'BOARD_RESIZE', payload: { width: dims.width, height: dims.height } });
}

async function broadcastInitData() {
    const { width, height } = await getConfig();
    const grid = await getCanvasAsArray();
    broadcast({
        type: 'INIT_DATA',
        payload: { grid, width, height, cooldownEnds: 100 },
    });
}

// --- DISCORD AUTH ROUTES ---
app.get('/auth/login', (req, res) => {
    const state = randomUUID();
    res.redirect(buildDiscordAuthUrl(state));
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code.');
    try {
        const user = await exchangeCodeForUser(code);
        const token = createSessionToken(user);
        res.setHeader('Set-Cookie', buildSessionCookie(token));
        res.redirect('/');
    } catch (err) {
        console.error('OAuth callback failed:', err);
        res.status(500).send('Login failed.');
    }
});

app.post('/auth/logout', requireSameOrigin, (req, res) => {
    res.setHeader('Set-Cookie', buildLogoutCookie());
    res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ loggedIn: false });
    res.json({
        loggedIn: true,
        id: req.user.id,
        username: req.user.username,
        avatar: req.user.avatar,
        isAdmin: isAdmin(req.user.id),
    });
});

registerAdminRoutes(app, { broadcastDimensions, broadcastInitData, getOnlineCount, requireSameOrigin });

async function sendTemplate(res, file) {
    try {
        const html = await renderTemplate(path.join(__dirname, 'public', file));
        res.type('html').send(html);
    } catch (err) {
        console.error(`Template render failed for ${file}:`, err);
        res.status(500).send('Internal error.');
    }
}

app.get(['/', '/index.html'], (req, res) => sendTemplate(res, 'index.html'));
app.get('/admin.html', (req, res) => sendTemplate(res, 'admin.html'));

app.use(express.static(path.join(__dirname, 'public')));

// --- WEBSOCKET ---
wss.on('connection', async (ws, req) => {
    const raw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const clientIp = Array.isArray(raw) ? raw[0] : String(raw).split(',')[0].trim();
    ws.clientIp = clientIp;
    ws.user = getUserFromCookieHeader(req.headers.cookie);

    try {
        const { width, height, cooldownSeconds } = await getConfig();
        const grid = await getCanvasAsArray();
        const cooldownKey = ws.user
            ? `${REDIS_KEYS.COOLDOWN_PREFIX}user:${ws.user.id}`
            : null;
        const cooldownEnds = cooldownKey ? await redis.ttl(cooldownKey) : 0;

        ws.send(JSON.stringify({
            type: 'INIT_DATA',
            payload: {
                grid,
                colors: COLORS,
                width,
                height,
                endDate: EVENT_END_DATE.toISOString(),
                cooldownSeconds,
                cooldownEnds: cooldownEnds > 0 ? cooldownEnds : 0,
                clientIp,
                numOfClients: getOnlineCount(),
                user: ws.user
                    ? { id: ws.user.id, username: ws.user.username, isAdmin: isAdmin(ws.user.id) }
                    : null,
            },
        }));
    } catch (error) {
        console.error(`Init data failed for ${clientIp}:`, error);
        ws.close();
        return;
    }

    broadcastOnlineCount();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'PLACE_PIXEL') {
                handlePlacePixel(data.payload, ws);
            }
        } catch (error) {
            console.error('Message handling error:', error);
        }
    });

    ws.on('close', () => broadcastOnlineCount());
    ws.on('error', (error) => console.error(`WS error from ${clientIp}:`, error));
});

async function handlePlacePixel(payload, ws) {
    if (new Date() > EVENT_END_DATE) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: 'Sự kiện đã kết thúc!' }));
        return;
    }

    if (!ws.user) {
        ws.send(JSON.stringify({ type: 'AUTH_REQUIRED', payload: 'Đăng nhập Discord để vẽ.' }));
        return;
    }

    if (await isUserBanned(ws.user.id) || await isIpBanned(ws.clientIp)) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: 'Bạn đã bị cấm.' }));
        return;
    }

    const { width, height, cooldownSeconds } = await getConfig();
    const cooldownKey = `${REDIS_KEYS.COOLDOWN_PREFIX}user:${ws.user.id}`;
    const setResult = await redis.set(cooldownKey, '1', 'EX', cooldownSeconds, 'NX');
    if (setResult === null) {
        const ttl = await redis.ttl(cooldownKey);
        ws.send(JSON.stringify({ type: 'ERROR', payload: `Vui lòng chờ. (${ttl}s)` }));
        return;
    }

    const { x, y, colorIndex } = payload;
    if (
        typeof x !== 'number' || typeof y !== 'number' || typeof colorIndex !== 'number' ||
        x < 0 || x >= width || y < 0 || y >= height ||
        colorIndex < 0 || colorIndex >= COLORS.length
    ) {
        ws.send(JSON.stringify({ type: 'ERROR', payload: 'Dữ liệu không hợp lệ.' }));
        return;
    }

    try {
        const pixelIndex = y * width + x;
        const pipeline = redis.pipeline();
        pipeline.bitfield(REDIS_KEYS.CANVAS, 'SET', `u${BITS_PER_PIXEL}`, `#${pixelIndex}`, colorIndex);
        pipeline.xadd(
            REDIS_KEYS.HISTORY, '*',
            'ip', ws.clientIp,
            'discordId', ws.user.id,
            'x', x,
            'y', y,
            'colorIndex', colorIndex,
            'timestamp', new Date().toISOString()
        );
        await pipeline.exec();

        ws.send(JSON.stringify({ type: 'COOLDOWN_START' }));
        broadcast({ type: 'PIXEL_UPDATE', payload: { x, y, colorIndex } });
    } catch (error) {
        console.error('Redis update error:', error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: 'Lỗi máy chủ, vui lòng thử lại.' }));
    }
}

async function startServer() {
    console.log('r/place backend starting...');
    await initializeCanvasIfNeeded();

    startMilestoneScheduler(async (result) => {
        await broadcastDimensions(result);
        await broadcastInitData();
    });

    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

startServer();
