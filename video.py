import redis
import numpy as np
import cv2
import sys

# --- Configuration ---

# 1. Your list of colors
COLORS = [
    '#FF4500', '#FFA800', '#FFD635', '#00A368',
    '#7EED56', '#2450A4', '#3690EA', '#51E9F4',
    '#811E9F', '#B44AC0', '#FF99AA', '#9C6926',
    '#000000', '#898D90', '#D4D7D9', '#FFFFFF'
]

# 2. Canvas dimensions (you'll need to set this to your project's canvas size)
CANVAS_WIDTH = 960
CANVAS_HEIGHT = 540

# 3. Video settings
VIDEO_FILENAME = 'rplace_timelapse.mp4'
FPS = 30  # Frames per second for the output video
EVENTS_PER_FRAME = 1 # How many pixels to draw before creating a new video frame.
                       # Lower this for a slower, more detailed video.
                       # Raise it for a faster time-lapse.

# 4. Redis settings
REDIS_HOST = 'localhost'
REDIS_PORT = 6379
STREAM_NAME = 'rplace:history'

# --- Main Script ---

def hex_to_bgr(hex_color):
    """Converts a hex color string to a BGR tuple for OpenCV."""
    hex_val = hex_color.lstrip('#')
    return tuple(int(hex_val[i:i+2], 16) for i in (4, 2, 0)) # B, G, R order

def create_video():
    """Fetches Redis history and generates a video."""
    # Convert our hex colors to the BGR format OpenCV uses
    bgr_colors = [hex_to_bgr(c) for c in COLORS]
    
    # Connect to Redis
    try:
        r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        # Ping the server to check the connection
        r.ping()
        print("✅ Successfully connected to Redis.")
    except redis.exceptions.ConnectionError as e:
        print(f"❌ Could not connect to Redis: {e}")
        return

    # Fetch all events from the stream
    print(f"Fetching all events from stream '{STREAM_NAME}'...")
    # The xrange command with '-' (start) and '+' (end) gets all entries
    events = r.xrange(STREAM_NAME, '-', '+')
    if not events:
        print("No events found in the stream. Exiting.")
        return
    print(f"Found {len(events)} total pixel events.")

    # Set up the video writer using OpenCV
    fourcc = cv2.VideoWriter_fourcc(*'mp4v') # Codec for .mp4 files
    
    video_writer = cv2.VideoWriter(VIDEO_FILENAME, fourcc, FPS, (CANVAS_WIDTH, CANVAS_HEIGHT))

    # Create the canvas as a black NumPy array.
    # We use NumPy because it's fast and what OpenCV expects.
    # The canvas starts with the last color (White)
    canvas = np.full((CANVAS_HEIGHT, CANVAS_WIDTH, 3), bgr_colors[-1], dtype=np.uint8)

    # Process each event and generate video frames
    print("🎬 Starting video creation...")
    for i, (_entry_id, data) in enumerate(events):
        try:
            x = int(data['x'])
            y = int(data['y'])
            # CORRECTED to use 'colorIndex' with a capital 'I'
            color_index = int(data['colorIndex'])

            # Draw the pixel on the canvas (NumPy uses [row, col] which is [y, x])
            canvas[y, x] = bgr_colors[color_index]
            
            # Every N events, write the current canvas state as a frame to the video
            if (i + 1) % EVENTS_PER_FRAME == 0:
                video_writer.write(canvas)
                # Print progress to the console
                progress = (i + 1) / len(events) * 100
                sys.stdout.write(f"\rProcessing... {progress:.1f}% complete")
                sys.stdout.flush()

        except (KeyError, ValueError) as e:
            print(f"\nSkipping malformed event data: {data}. Error: {e}")

    # Write the very final state of the canvas as the last frame
    video_writer.write(canvas)
    
    # Clean up
    video_writer.release()
    print(f"\n\n✨ Done! Video saved as '{VIDEO_FILENAME}'")

if __name__ == '__main__':
    create_video()