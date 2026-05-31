import { randomUUID } from 'crypto';
import { redis } from './redis.js';
import { REDIS_KEYS, DIRECTIONS } from './config.js';
import { expandBoard } from './board.js';

export async function listMilestones() {
    const all = await redis.hgetall(REDIS_KEYS.MILESTONES);
    return Object.values(all)
        .map((json) => JSON.parse(json))
        .sort((a, b) => new Date(a.triggerAt) - new Date(b.triggerAt));
}

export async function createMilestone({ triggerAt, direction, amount, label }) {
    if (!DIRECTIONS.includes(direction)) {
        throw new Error(`Invalid direction: ${direction}`);
    }
    const px = Math.floor(Number(amount));
    if (!Number.isFinite(px) || px <= 0) {
        throw new Error(`Invalid amount: ${amount}`);
    }
    const ts = new Date(triggerAt);
    if (Number.isNaN(ts.getTime())) {
        throw new Error(`Invalid triggerAt: ${triggerAt}`);
    }

    const milestone = {
        id: randomUUID(),
        triggerAt: ts.toISOString(),
        direction,
        amount: px,
        label: label || '',
        fired: false,
        createdAt: new Date().toISOString(),
    };
    await redis.hset(REDIS_KEYS.MILESTONES, milestone.id, JSON.stringify(milestone));
    return milestone;
}

export async function deleteMilestone(id) {
    return redis.hdel(REDIS_KEYS.MILESTONES, id);
}

async function markFired(milestone) {
    milestone.fired = true;
    milestone.firedAt = new Date().toISOString();
    await redis.hset(REDIS_KEYS.MILESTONES, milestone.id, JSON.stringify(milestone));
}

export function startMilestoneScheduler(onExpanded, intervalMs = 15000) {
    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const now = Date.now();
            const milestones = await listMilestones();
            for (const m of milestones) {
                if (m.fired) continue;
                if (new Date(m.triggerAt).getTime() > now) continue;

                // Mark fired BEFORE expanding so a crash mid-expand cannot cause
                // the same milestone to double-expand on the next tick.
                await markFired(m);
                try {
                    const result = await expandBoard(m.direction, m.amount);
                    console.log(`Milestone ${m.id} expanded board ${m.direction} by ${m.amount}.`);
                    if (onExpanded) await onExpanded(result, m);
                } catch (err) {
                    console.error(`Milestone ${m.id} expansion failed:`, err);
                }
            }
        } catch (err) {
            console.error('Milestone scheduler tick failed:', err);
        } finally {
            running = false;
        }
    };

    tick();
    return setInterval(tick, intervalMs);
}

