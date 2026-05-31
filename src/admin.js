import { requireAdmin } from './auth.js';
import {
    getConfig,
    setCooldownSeconds,
    redis,
} from './redis.js';
import {
    expandBoard,
    clearRectangleOnCanvas,
    cleanHistoryInRectangle,
    getCanvasBase64,
} from './board.js';
import {
    listMilestones,
    createMilestone,
    deleteMilestone,
} from './milestones.js';
import {
    banUser,
    unbanUser,
    banIp,
    unbanIp,
    listBans,
} from './moderation.js';
import { REDIS_KEYS, COLORS } from './config.js';

export function registerAdminRoutes(app, deps) {
    const { broadcastDimensions, broadcastInitData, getOnlineCount, requireSameOrigin } = deps;

    app.get('/api/admin/stats', requireAdmin, async (req, res) => {
        try {
            const cfg = await getConfig();
            const historyLen = await redis.xlen(REDIS_KEYS.HISTORY);
            res.json({
                width: cfg.width,
                height: cfg.height,
                cooldownSeconds: cfg.cooldownSeconds,
                online: getOnlineCount(),
                totalPlacements: historyLen,
                colors: COLORS,
                canvas: await getCanvasBase64(),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/admin/expand', requireSameOrigin, requireAdmin, async (req, res) => {
        try {
            const { direction, amount } = req.body;
            const result = await expandBoard(direction, amount);
            await broadcastDimensions(result);
            await broadcastInitData();
            res.json({ ok: true, ...result });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.get('/api/admin/milestones', requireAdmin, async (req, res) => {
        res.json(await listMilestones());
    });

    app.post('/api/admin/milestones', requireSameOrigin, requireAdmin, async (req, res) => {
        try {
            const milestone = await createMilestone(req.body);
            res.json(milestone);
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.delete('/api/admin/milestones/:id', requireSameOrigin, requireAdmin, async (req, res) => {
        await deleteMilestone(req.params.id);
        res.json({ ok: true });
    });

    app.post('/api/admin/superpaint', requireSameOrigin, requireAdmin, async (req, res) => {
        try {
            const { x1, y1, x2, y2 } = req.body;
            const cfg = await getConfig();
            if (
                [x1, y1, x2, y2].some((v) => typeof v !== 'number') ||
                x1 < 0 || x1 >= cfg.width || x2 < 0 || x2 >= cfg.width ||
                y1 < 0 || y1 >= cfg.height || y2 < 0 || y2 >= cfg.height
            ) {
                return res.status(400).json({ error: 'Invalid coordinates.' });
            }
            await clearRectangleOnCanvas(x1, y1, x2, y2);
            await cleanHistoryInRectangle(x1, y1, x2, y2);
            await broadcastInitData();
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/admin/bans', requireAdmin, async (req, res) => {
        res.json(await listBans());
    });

    app.post('/api/admin/ban', requireSameOrigin, requireAdmin, async (req, res) => {
        try {
            const { type, value } = req.body;
            if (type === 'user') await banUser(value);
            else if (type === 'ip') await banIp(value);
            else return res.status(400).json({ error: 'Invalid ban type.' });
            res.json({ ok: true });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.post('/api/admin/unban', requireSameOrigin, requireAdmin, async (req, res) => {
        try {
            const { type, value } = req.body;
            if (type === 'user') await unbanUser(value);
            else if (type === 'ip') await unbanIp(value);
            else return res.status(400).json({ error: 'Invalid ban type.' });
            res.json({ ok: true });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.post('/api/admin/cooldown', requireSameOrigin, requireAdmin, async (req, res) => {
        try {
            const seconds = Math.floor(Number(req.body.seconds));
            if (!Number.isFinite(seconds) || seconds < 0) {
                return res.status(400).json({ error: 'Invalid cooldown.' });
            }
            await setCooldownSeconds(seconds);
            res.json({ ok: true, cooldownSeconds: seconds });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.get('/api/admin/activity', requireAdmin, async (req, res) => {
        try {
            const count = Math.min(parseInt(req.query.count, 10) || 50, 500);
            const entries = await redis.xrevrange(REDIS_KEYS.HISTORY, '+', '-', 'COUNT', count);
            const feed = entries.map(([id, fields]) => {
                const map = {};
                for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
                return {
                    id,
                    ip: map.ip || '',
                    discordId: map.discordId || '',
                    x: parseInt(map.x, 10),
                    y: parseInt(map.y, 10),
                    colorIndex: parseInt(map.colorIndex, 10),
                    timestamp: map.timestamp || '',
                };
            });
            res.json(feed);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
}
