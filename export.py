#!/usr/bin/env python3
import math
import redis
from PIL import Image

# ---- Redis config ----
REDIS_HOST = "localhost"
REDIS_PORT = 6379
REDIS_DB   = 0
REDIS_KEY  = "rplace:canvas-new"  # match REDIS_KEYS.CANVAS in your code

# ---- Output config ----
OUT_W = 1920
OUT_H = 1080
OUT_FILE = "canvas.png"

# ---- Palette (must match server) ----
COLORS = [
    '#FF4500', '#FFA800', '#FFD635', '#00A368',
    '#7EED56', '#2450A4', '#3690EA', '#51E9F4',
    '#811E9F', '#B44AC0', '#FF99AA', '#9C6926',
    '#000000', '#898D90', '#D4D7D9', '#FFFFFF'
]
PALETTE = [tuple(int(c[i:i+2], 16) for i in (1, 3, 5)) for c in COLORS]

def infer_dims_from_pixels(total_pixels, preferred_aspect):
    """
    Find integer (w, h) with w*h = total_pixels that best matches preferred_aspect.
    """
    best = None
    limit = int(math.sqrt(total_pixels)) + 1
    for h in range(1, limit):
        if total_pixels % h != 0:
            continue
        w = total_pixels // h
        # prefer w>=h by swapping if needed
        if w < h:
            w, h = h, w
        aspect = w / h
        score = abs(aspect - preferred_aspect)
        # tiny tie-breaker: prefer larger width
        key = (score, -w)
        if best is None or key < best[0]:
            best = ((score, -w), (w, h))
    return best[1] if best else None

def decode_buffer_to_image(buf: bytes, width: int, height: int) -> Image.Image:
    img = Image.new("RGB", (width, height))
    px = img.load()

    # two pixels per byte, high nibble then low nibble, same as your JS
    for y in range(height):
        base = y * width
        for x in range(width):
            idx = base + x
            byte_index = idx >> 1
            is_high = (idx & 1) == 0
            byte = buf[byte_index]
            color_index = (byte >> 4) & 0xF if is_high else (byte & 0xF)
            px[x, y] = PALETTE[color_index]
    return img

def main():
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB)
    buf = r.get(REDIS_KEY)
    if buf is None:
        raise RuntimeError(f"Key '{REDIS_KEY}' not found in Redis.")

    # infer source size
    total_pixels = len(buf) * 2  # 2 pixels per byte
    preferred_aspect = OUT_W / OUT_H
    src_dims = infer_dims_from_pixels(total_pixels, preferred_aspect)
    if not src_dims:
        raise ValueError(f"Could not factor total pixels {total_pixels} into WxH.")
    SRC_W, SRC_H = src_dims

    # sanity check
    expected_bytes = (SRC_W * SRC_H) // 2
    if expected_bytes != len(buf):
        raise ValueError(f"Inference mismatch: src {SRC_W}x{SRC_H} -> {expected_bytes} bytes, "
                         f"but buffer is {len(buf)} bytes.")

    print(f"Inferred source size: {SRC_W}x{SRC_H} ({len(buf)} bytes -> {total_pixels} pixels)")
    img = decode_buffer_to_image(buf, SRC_W, SRC_H)

    # scale to target with nearest-neighbor (pixel-art friendly)
    if (SRC_W, SRC_H) != (OUT_W, OUT_H):
        img = img.resize((OUT_W, OUT_H), resample=Image.NEAREST)

    img.save(OUT_FILE)
    print(f"Saved {OUT_FILE} ({OUT_W}x{OUT_H})")

if __name__ == "__main__":
    main()
