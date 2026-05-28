import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import { Redis } from 'ioredis';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config()

// --- CẤU HÌNH CHUNG ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8980;
const GRID_WIDTH = 960;
const GRID_HEIGHT = 540;
const BITS_PER_PIXEL = 4; // 2^4 = 16 màu
const COOLDOWN_SECONDS = 5;
const EVENT_END_DATE = new Date(Date.UTC(2026, 7, 17, 23, 59, 59)); // 00:00 16/08/2099 VN
const HISTORY_CLEANUP_RANGE = 50000; // Số lượng entry lịch sử gần nhất để quét và xóa
const COLORS = [
    '#FF4500', '#FFA800', '#FFD635', '#00A368',
    '#7EED56', '#2450A4', '#3690EA', '#51E9F4',
    '#811E9F', '#B44AC0', '#FF99AA', '#9C6926',
    '#000000', '#898D90', '#D4D7D9', '#FFFFFF'
];
const DEFAULT_COLOR_INDEX = 15; // Index của màu trắng

// --- CẤU HÌNH REDIS ---
const redis = new Redis(); // Kết nối tới Redis mặc định (localhost:6379)
const REDIS_KEYS = {
    CANVAS: 'rplace:canvas-new',   // Key cho bitmap lưu canvas
    HISTORY: 'rplace:history', // Key cho stream lưu lịch sử
    COOLDOWN_PREFIX: 'rplace:cooldown:' // Tiền tố cho key cooldown của IP
};

// --- KHỞI TẠO SERVER ---
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); 
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- HÀM HELPER CHO REDIS ---

/**
 * Khởi tạo canvas trong Redis nếu chưa tồn tại.
 * Tối ưu bằng cách ghi toàn bộ buffer một lần.
 */
async function initializeCanvasIfNeeded() {
    const canvasExists = await redis.exists(REDIS_KEYS.CANVAS);
    if (!canvasExists) {
        console.log("Canvas chưa tồn tại trong Redis. Đang khởi tạo...");
        const totalPixels = GRID_WIDTH * GRID_HEIGHT;
        const totalBits = totalPixels * BITS_PER_PIXEL;
        const totalBytes = Math.ceil(totalBits / 8);
        // 0xFF đại diện cho một byte có tất cả 8 bit là 1.
        // Vì màu mặc định là 15 (nhị phân 1111), việc điền 0xFF
        // sẽ đặt tất cả các pixel 4-bit thành màu trắng.
        const initialBuffer = Buffer.alloc(totalBytes, 0xFF);
        await redis.set(REDIS_KEYS.CANVAS, initialBuffer);
        console.log("Canvas đã được khởi tạo với màu mặc định (trắng).");
    } else {
        console.log("Đã tìm thấy canvas trong Redis.");
    }
}

/**
 * Lấy toàn bộ dữ liệu canvas từ Redis và chuyển thành mảng 2D.
 * Phiên bản này đã sửa lỗi đọc bit, tránh tình trạng sọc.
 * @returns {Promise<number[][]>} Mảng 2D chứa chỉ số màu của canvas.
 */
async function getCanvasAsArray() {
  const buf = await redis.getBuffer(REDIS_KEYS.CANVAS);
  const grid = Array.from({length: GRID_HEIGHT}, () =>
              Array(GRID_WIDTH).fill(DEFAULT_COLOR_INDEX));

  if (!buf) {
    console.error("Không lấy được buffer canvas.");
    return grid;
  }

  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const idx        = y * GRID_WIDTH + x; // pixelIndex
      const byteIndex  = idx >> 1;           // chia 2
      const isHigh     = (idx & 1) === 0;
      const byte       = buf[byteIndex];
      const color      = isHigh ? (byte >> 4) & 0xF : byte & 0xF;
      grid[y][x] = color;
    }
  }
  return grid;
}


// Hàm helper để gửi broadcast tới tất cả client
const broadcastOnlineCount = () => {
    const message = JSON.stringify({
        type: 'ONLINE_COUNT_UPDATE',
        payload: {
            numOfClients: wss.clients.size
        }
    });

    console.log(`Broadcasting online count: ${wss.clients.size}`);

    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
};
// --- LOGIC XỬ LÝ WEBSOCKET ---
wss.on('connection', async (ws, req) => {
    const raw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const clientIp = Array.isArray(raw) ? raw[0] : String(raw).split(',')[0].trim();
    console.log(`Client đã kết nối từ IP: ${clientIp}. Tổng số: ${wss.clients.size}`);

    try {
        const gridData = await getCanvasAsArray();
        const cooldownEnds = await redis.ttl(`${REDIS_KEYS.COOLDOWN_PREFIX}${clientIp}`);

        // Gửi dữ liệu khởi tạo đầy đủ cho client vừa kết nối
        ws.send(JSON.stringify({
            type: 'INIT_DATA',
            payload: {
                grid: gridData,
                colors: COLORS,
                endDate: EVENT_END_DATE.toISOString(),
                cooldownSeconds: COOLDOWN_SECONDS,
                cooldownEnds: cooldownEnds > 0 ? cooldownEnds : 0,
                clientIp: clientIp,
                numOfClients: wss.clients.size // Gửi số lượng client hiện tại cho client mới
            }
        }));
    } catch (error) {
        console.error(`Lỗi khi gửi dữ liệu khởi tạo cho ${clientIp}:`, error);
        ws.close();
    }

    // --- LOGIC MỚI ---
    // Sau khi client mới kết nối, broadcast số lượng người chơi mới cho TẤT CẢ client
    broadcastOnlineCount();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'PLACE_PIXEL') {
                handlePlacePixel(data.payload, clientIp, ws);
            }
        } catch (error) {
            console.error("Lỗi xử lý tin nhắn:", error);
        }
    });

    ws.on('close', () => {
        console.log(`Client từ IP: ${clientIp} đã ngắt kết nối. Còn lại: ${wss.clients.size}`);
        // --- LOGIC MỚI ---
        // Khi một client ngắt kết nối, broadcast số lượng người chơi mới cho TẤT CẢ client còn lại
        broadcastOnlineCount();
    });

    ws.on('error', (error) => console.error(`Lỗi WebSocket từ IP ${clientIp}:`, error));
});



// --- HÀM XỬ LÝ LOGIC ---
async function handlePlacePixel(payload, clientIp, senderWs) {
    if (new Date() > EVENT_END_DATE) {
        senderWs.send(JSON.stringify({ type: 'ERROR', payload: 'Sự kiện đã kết thúc!' }));
        return;
    }

    const cooldownKey = `${REDIS_KEYS.COOLDOWN_PREFIX}${clientIp}`;
    const setResult = await redis.set(cooldownKey, '1', 'EX', COOLDOWN_SECONDS, 'NX');
    if (setResult === null) {
        const ttl = await redis.ttl(cooldownKey);
        senderWs.send(JSON.stringify({ type: 'ERROR', payload: `Vui lòng chờ. (${ttl}s)` }));
        return;
    }

    const { x, y, colorIndex } = payload;
    if (
        typeof x !== 'number' || typeof y !== 'number' || typeof colorIndex !== 'number' ||
        x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT ||
        colorIndex < 0 || colorIndex >= COLORS.length
    ) {
        senderWs.send(JSON.stringify({ type: 'ERROR', payload: 'Dữ liệu không hợp lệ.' }));
        return;
    }

    try {
        // const offset = (y * GRID_WIDTH + x) * BITS_PER_PIXEL;
        const pixelIndex = y * GRID_WIDTH + x;
        const pipeline = redis.pipeline();
        
        // pipeline.bitfield(REDIS_KEYS.CANVAS, 'SET', `u${BITS_PER_PIXEL}`, `#${offset}`, colorIndex);
        pipeline.bitfield(REDIS_KEYS.CANVAS, 'SET', `u${BITS_PER_PIXEL}`, `#${pixelIndex}`, colorIndex);

        pipeline.xadd(REDIS_KEYS.HISTORY, '*',
            'ip', clientIp,
            'x', x,
            'y', y,
            'colorIndex', colorIndex,
            'timestamp', new Date().toISOString()
        );
        await pipeline.exec();

        console.log(`IP ${clientIp} đã đặt màu ${COLORS[colorIndex]} tại (${x}, ${y})`);
        
        senderWs.send(JSON.stringify({ type: 'COOLDOWN_START' }));

        const updateMessage = JSON.stringify({
            type: 'PIXEL_UPDATE',
            payload: { x, y, colorIndex }
        });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(updateMessage);
            }
        });

    } catch(error) {
        console.error("Lỗi khi cập nhật Redis:", error);
        senderWs.send(JSON.stringify({ type: 'ERROR', payload: 'Lỗi máy chủ, vui lòng thử lại.' }));
    }
}



// --- LOGIC MỚI: SUPERPAINT ---

/**
 * Ghi đè một vùng chữ nhật trên canvas với màu trắng.
 * Tối ưu bằng cách đọc/ghi toàn bộ buffer thay vì từng pixel.
 */
async function clearRectangleOnCanvas(x1, y1, x2, y2) {
    console.log(`Đang xóa vùng từ (${x1},${y1}) đến (${x2},${y2})`);
    const buf = await redis.getBuffer(REDIS_KEYS.CANVAS);
    if (!buf) {
        throw new Error("Không thể lấy buffer canvas từ Redis.");
    }

    // Chuẩn hóa tọa độ để đảm bảo x1 < x2 và y1 < y2
    const startX = Math.min(x1, x2);
    const startY = Math.min(y1, y2);
    const endX = Math.max(x1, x2);
    const endY = Math.max(y1, y2);

    for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
            const idx = y * GRID_WIDTH + x;
            const byteIndex = idx >> 1; // chia 2
            const isHigh = (idx & 1) === 0; // kiểm tra bit chẵn/lẻ
            
            const currentByte = buf[byteIndex];
            let newByte;

            if (isHigh) {
                // Giữ 4 bit thấp, set 4 bit cao thành 1111 (0xF)
                newByte = (currentByte & 0x0F) | 0xF0;
            } else {
                // Giữ 4 bit cao, set 4 bit thấp thành 1111 (0xF)
                newByte = (currentByte & 0xF0) | 0x0F;
            }
            buf.writeUInt8(newByte, byteIndex);
        }
    }
    // Ghi lại toàn bộ buffer đã sửa đổi vào Redis
    await redis.set(REDIS_KEYS.CANVAS, buf);
    console.log("Xóa vùng thành công.");
}

/**
 * Quét lịch sử gần đây và xóa các pixel nằm trong vùng chữ nhật đã cho.
 */
async function cleanHistoryInRectangle(x1, y1, x2, y2) {
    console.log("Bắt đầu dọn dẹp lịch sử (xóa chuỗi màu trên cùng)...");
    
    const history = await redis.xrevrange(REDIS_KEYS.HISTORY, '+', '-', 'COUNT', HISTORY_CLEANUP_RANGE);
    if (!history || history.length === 0) {
        console.log("Lịch sử trống.");
        return;
    }

    const idsToDelete = [];
    // Map để theo dõi trạng thái của mỗi pixel khi quét ngược lịch sử.
    // Key: "x,y" (string)
    // Value: { topColorIndex: number, stopDeleting: boolean }
    const pixelState = new Map();

    const startX = Math.min(x1, x2);
    const startY = Math.min(y1, y2);
    const endX = Math.max(x1, x2);
    const endY = Math.max(y1, y2);
    
    // Duyệt lịch sử từ mới nhất -> cũ nhất
    for (const [id, fields] of history) {
        let entryX, entryY, entryColorIndex;
        // Trích xuất dữ liệu từ stream, bao gồm cả 'colorIndex'
        for (let i = 0; i < fields.length; i += 2) {
            const key = fields[i];
            const value = fields[i+1];
            if (key === 'x') entryX = parseInt(value, 10);
            if (key === 'y') entryY = parseInt(value, 10);
            if (key === 'colorIndex') entryColorIndex = parseInt(value, 10);
        }

        // Bỏ qua nếu pixel không nằm trong vùng chữ nhật
        if (entryX < startX || entryX > endX || entryY < startY || entryY > endY) {
            continue;
        }

        const pixelKey = `${entryX},${entryY}`;
        const currentState = pixelState.get(pixelKey);

        if (!currentState) {
            // Lần đầu tiên gặp pixel này (đây là lớp trên cùng).
            // Luôn xóa nó và ghi lại màu của nó để so sánh với các lớp cũ hơn.
            idsToDelete.push(id);
            pixelState.set(pixelKey, { 
                topColorIndex: entryColorIndex, 
                stopDeleting: false 
            });
        } else {
            // Đã gặp pixel này trước đó.
            // Nếu đã có cờ "dừng xóa" cho pixel này, bỏ qua tất cả các bản ghi cũ hơn.
            if (currentState.stopDeleting) {
                continue;
            }

            // So sánh màu của bản ghi hiện tại với màu của lớp trên cùng.
            if (entryColorIndex === currentState.topColorIndex) {
                // Nếu màu TRÙNG nhau, tiếp tục xóa.
                idsToDelete.push(id);
            } else {
                // Nếu màu KHÁC, đây là điểm kết thúc chuỗi.
                // Dừng việc xóa cho pixel này từ đây trở về sau.
                currentState.stopDeleting = true;
            }
        }
    }

    if (idsToDelete.length > 0) {
        await redis.xdel(REDIS_KEYS.HISTORY, ...idsToDelete);
        console.log(`Đã xóa ${idsToDelete.length} entry (chuỗi màu trên cùng) khỏi lịch sử.`);
    } else {
        console.log("Không có entry lịch sử nào trong vùng cần xóa.");
    }
}

/**
 * Gửi lại toàn bộ dữ liệu canvas và trạng thái mới cho TẤT CẢ client.
 */
async function broadcastInitData() {
    console.log("Đang gửi lại dữ liệu INIT_DATA cho tất cả client...");
    try {
        const gridData = await getCanvasAsArray();
        const initPayload = {
            grid: gridData,
            cooldownEnds: 100 // tất cả sẽ bị cooldown 100s

        }

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                // Client sẽ nhận và vẽ lại toàn bộ canvas
                client.send(JSON.stringify({
                    type: 'INIT_DATA',
                    payload: initPayload
                }));
            }
        });
        console.log("Gửi broadcast INIT_DATA thành công.");
    } catch (error) {
        console.error("Lỗi khi broadcast INIT_DATA:", error);
    }
}

/**
 * Middleware để xác thực request Superpaint.
 */
function authenticateSuperpaint(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
        return res.status(401).json({ error: 'Không có token xác thực.' });
    }
    if (token !== SUPERPAINT_SECRET_KEY) {
        return res.status(403).json({ error: 'Token không hợp lệ.' });
    }
    next();
}

/**
 * Endpoint để thực hiện Superpaint.
 */
app.post('/superpaint', async (req, res) => {
    const { x1, y1, x2, y2, password } = req.body;
    console.log(process.env.SUPERPAINT_SECRET_KEY)
    if (!password || password !== process.env.SUPERPAINT_SECRET_KEY) {
        return res.status(403).json({ error: 'Bạn không có quyền thực hiện Superpaint.' });
    }
    
    // Validate input
    if (
        [x1, y1, x2, y2].some(val => typeof val !== 'number') ||
        x1 < 0 || x1 >= GRID_WIDTH || y1 < 0 || y1 >= GRID_HEIGHT ||
        x2 < 0 || x2 >= GRID_WIDTH || y2 < 0 || y2 >= GRID_HEIGHT
    ) {
        return res.status(400).json({ error: 'Tọa độ không hợp lệ.' });
    }

    try {
        // 1. Ghi đè lên canvas
        await clearRectangleOnCanvas(x1, y1, x2, y2);
        
        // 2. Xóa log liên quan
        await cleanHistoryInRectangle(x1, y1, x2, y2);
        
        // 3. Gửi lại canvas cho tất cả user
        await broadcastInitData();

        return res.status(200).json({ message: 'Superpaint thành công!' });

    } catch (error) {
        console.error("Lỗi trong quá trình Superpaint:", error);
        return res.status(500).json({ error: 'Lỗi server nội bộ.' });
    }
});

// --- KHỞI ĐỘNG SERVER ---
async function startServer() {
    console.log("r/place backend đang khởi động...");
    await initializeCanvasIfNeeded();

    //print canvas
    // const initialCanvas = await getCanvasAsArray();
    // console.log("Canvas ban đầu:");
    // initialCanvas.forEach(row => {
    //     console.log(row.join(' '));
    //     console.log('---');
    // });


    
    server.listen(PORT, () => {
        console.log(`Server đang lắng nghe trên cổng ${PORT}`);
        console.log(`Sự kiện sẽ kết thúc vào: ${EVENT_END_DATE.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    });
}

startServer();
