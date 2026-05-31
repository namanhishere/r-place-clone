import { redis, getConfig, setDimensions } from './redis.js';
import {
    REDIS_KEYS,
    BITS_PER_PIXEL,
    DEFAULT_COLOR_INDEX,
    DEFAULT_GRID_WIDTH,
    DEFAULT_GRID_HEIGHT,
    DIRECTIONS,
    MAX_DIMENSION,
    HISTORY_CLEANUP_RANGE,
} from './config.js';

function bufferBytesFor(width, height) {
    const totalBits = width * height * BITS_PER_PIXEL;
    return Math.ceil(totalBits / 8);
}

function readNibble(buf, pixelIndex) {
    const byteIndex = pixelIndex >> 1;
    const isHigh = (pixelIndex & 1) === 0;
    const byte = buf[byteIndex];
    return isHigh ? (byte >> 4) & 0xF : byte & 0xF;
}

function writeNibble(buf, pixelIndex, colorIndex) {
    const byteIndex = pixelIndex >> 1;
    const isHigh = (pixelIndex & 1) === 0;
    const currentByte = buf[byteIndex];
    let newByte;
    if (isHigh) {
        newByte = (currentByte & 0x0F) | ((colorIndex & 0xF) << 4);
    } else {
        newByte = (currentByte & 0xF0) | (colorIndex & 0xF);
    }
    buf.writeUInt8(newByte, byteIndex);
}

function allocCanvasBuffer(width, height) {
    // 0xFF fills every byte so both 4-bit pixels become index 15 (white).
    return Buffer.alloc(bufferBytesFor(width, height), 0xFF);
}

export async function initializeCanvasIfNeeded() {
    const canvasExists = await redis.exists(REDIS_KEYS.CANVAS);
    if (!canvasExists) {
        const buf = allocCanvasBuffer(DEFAULT_GRID_WIDTH, DEFAULT_GRID_HEIGHT);
        await redis.set(REDIS_KEYS.CANVAS, buf);
        await setDimensions(DEFAULT_GRID_WIDTH, DEFAULT_GRID_HEIGHT);
        console.log(`Canvas initialized at ${DEFAULT_GRID_WIDTH}x${DEFAULT_GRID_HEIGHT}.`);
    } else {
        const cfg = await getConfig();
        await setDimensions(cfg.width, cfg.height);
        console.log(`Canvas found at ${cfg.width}x${cfg.height}.`);
    }
}

export async function getCanvasAsArray() {
    const { width, height } = await getConfig();
    const buf = await redis.getBuffer(REDIS_KEYS.CANVAS);
    const grid = Array.from({ length: height }, () =>
        Array(width).fill(DEFAULT_COLOR_INDEX));

    if (!buf) {
        console.error('Canvas buffer missing.');
        return grid;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            grid[y][x] = readNibble(buf, y * width + x);
        }
    }
    return grid;
}

export async function getCanvasBase64() {
    const buf = await redis.getBuffer(REDIS_KEYS.CANVAS);
    return buf ? buf.toString('base64') : '';
}

export async function expandBoard(direction, amount) {
    if (!DIRECTIONS.includes(direction)) {
        throw new Error(`Invalid direction: ${direction}`);
    }
    const px = Math.floor(Number(amount));
    if (!Number.isFinite(px) || px <= 0) {
        throw new Error(`Invalid amount: ${amount}`);
    }

    const { width: oldW, height: oldH } = await getConfig();

    let newW = oldW;
    let newH = oldH;
    let shiftX = 0; // x of old (0,0) inside the new grid
    let shiftY = 0;

    if (direction === 'left') { newW = oldW + px; shiftX = px; }
    else if (direction === 'right') { newW = oldW + px; }
    else if (direction === 'up') { newH = oldH + px; shiftY = px; }
    else if (direction === 'down') { newH = oldH + px; }

    if (newW > MAX_DIMENSION || newH > MAX_DIMENSION) {
        throw new Error(`Expansion would exceed max dimension ${MAX_DIMENSION}.`);
    }

    const oldBuf = await redis.getBuffer(REDIS_KEYS.CANVAS);
    if (!oldBuf) throw new Error('Canvas buffer missing.');

    const newBuf = allocCanvasBuffer(newW, newH);
    for (let y = 0; y < oldH; y++) {
        for (let x = 0; x < oldW; x++) {
            const color = readNibble(oldBuf, y * oldW + x);
            const nx = x + shiftX;
            const ny = y + shiftY;
            writeNibble(newBuf, ny * newW + nx, color);
        }
    }

    await redis.set(REDIS_KEYS.CANVAS, newBuf);
    await setDimensions(newW, newH);

    if (shiftX !== 0 || shiftY !== 0) {
        await shiftHistoryCoordinates(shiftX, shiftY);
    }

    return { width: newW, height: newH, shiftX, shiftY };
}

async function shiftHistoryCoordinates(shiftX, shiftY) {
    const history = await redis.xrange(REDIS_KEYS.HISTORY, '-', '+');
    if (!history || history.length === 0) return;

    // XADD rejects any ID <= the stream's top ID, so old IDs cannot be reused.
    // Rebuild the stream with fresh ascending IDs; placement time is preserved
    // in the `timestamp` field and ordering is all history scans depend on.
    const pipeline = redis.pipeline();
    pipeline.del(REDIS_KEYS.HISTORY);
    for (const [, fields] of history) {
        const map = {};
        for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
        if (map.x === undefined || map.y === undefined) continue;

        const newX = parseInt(map.x, 10) + shiftX;
        const newY = parseInt(map.y, 10) + shiftY;
        pipeline.xadd(
            REDIS_KEYS.HISTORY, '*',
            'ip', map.ip ?? '',
            'discordId', map.discordId ?? '',
            'x', newX,
            'y', newY,
            'colorIndex', map.colorIndex ?? '0',
            'timestamp', map.timestamp ?? new Date().toISOString()
        );
    }
    await pipeline.exec();
}

export async function clearRectangleOnCanvas(x1, y1, x2, y2) {
    const { width } = await getConfig();
    const buf = await redis.getBuffer(REDIS_KEYS.CANVAS);
    if (!buf) throw new Error('Canvas buffer missing.');

    const startX = Math.min(x1, x2);
    const startY = Math.min(y1, y2);
    const endX = Math.max(x1, x2);
    const endY = Math.max(y1, y2);

    for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
            writeNibble(buf, y * width + x, DEFAULT_COLOR_INDEX);
        }
    }
    await redis.set(REDIS_KEYS.CANVAS, buf);
}

export async function cleanHistoryInRectangle(x1, y1, x2, y2) {
    const history = await redis.xrevrange(
        REDIS_KEYS.HISTORY, '+', '-', 'COUNT', HISTORY_CLEANUP_RANGE);
    if (!history || history.length === 0) return;

    const idsToDelete = [];
    const pixelState = new Map();

    const startX = Math.min(x1, x2);
    const startY = Math.min(y1, y2);
    const endX = Math.max(x1, x2);
    const endY = Math.max(y1, y2);

    for (const [id, fields] of history) {
        let entryX, entryY, entryColorIndex;
        for (let i = 0; i < fields.length; i += 2) {
            if (fields[i] === 'x') entryX = parseInt(fields[i + 1], 10);
            else if (fields[i] === 'y') entryY = parseInt(fields[i + 1], 10);
            else if (fields[i] === 'colorIndex') entryColorIndex = parseInt(fields[i + 1], 10);
        }

        if (entryX < startX || entryX > endX || entryY < startY || entryY > endY) continue;

        const pixelKey = `${entryX},${entryY}`;
        const currentState = pixelState.get(pixelKey);

        if (!currentState) {
            idsToDelete.push(id);
            pixelState.set(pixelKey, { topColorIndex: entryColorIndex, stopDeleting: false });
        } else if (!currentState.stopDeleting) {
            if (entryColorIndex === currentState.topColorIndex) {
                idsToDelete.push(id);
            } else {
                currentState.stopDeleting = true;
            }
        }
    }

    if (idsToDelete.length > 0) {
        await redis.xdel(REDIS_KEYS.HISTORY, ...idsToDelete);
    }
    return idsToDelete.length;
}





