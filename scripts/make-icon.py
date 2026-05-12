"""
Generate build-resources/icon.ico (Windows multi-size) and icon.png (Linux).
Run once before building: python scripts/make-icon.py

Requires Pillow:  pip install Pillow
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

SIZES   = [16, 24, 32, 48, 64, 128, 256]
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'build-resources')

# Colours matching the app theme
BG      = (15,  23,  42,  255)   # #0f172a  dark navy
ACCENT  = (59,  130, 246, 50)    # #3b82f6  blue grid lines (semi-transparent)
FG      = (255, 255, 255, 255)   # white letter

# Windows system fonts (first match wins)
FONT_CANDIDATES = [
    r'C:\Windows\Fonts\seguisb.ttf',    # Segoe UI Semibold
    r'C:\Windows\Fonts\segoeuib.ttf',   # Segoe UI Bold
    r'C:\Windows\Fonts\arialbd.ttf',    # Arial Bold
    r'C:\Windows\Fonts\calibrib.ttf',   # Calibri Bold
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
]


def _find_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_frame(px: int) -> Image.Image:
    img  = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-rectangle background
    r = max(2, px // 7)
    draw.rounded_rectangle([0, 0, px - 1, px - 1], radius=r, fill=BG)

    # Subtle grid overlay (only visible at larger sizes)
    if px >= 32:
        step = px // 4
        lw   = max(1, px // 128)
        for i in range(1, 4):
            v = i * step
            draw.line([(v, 2),    (v, px - 2)],  fill=ACCENT, width=lw)
            draw.line([(2, v),    (px - 2, v)],   fill=ACCENT, width=lw)

    # "G" letter
    font_px = int(px * 0.62)
    font    = _find_font(font_px)
    text    = 'G'

    # Centre the glyph
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (px - tw) // 2 - bbox[0]
    ty = (px - th) // 2 - bbox[1]
    draw.text((tx, ty), text, fill=FG, font=font)

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    frames = [make_frame(s) for s in SIZES]

    # --- ICO (all sizes embedded) ---
    ico_path = os.path.join(OUT_DIR, 'icon.ico')
    # Pillow ICO: save largest first, append the rest
    frames[-1].save(
        ico_path,
        format='ICO',
        sizes=[(s, s) for s in SIZES],
        append_images=frames[:-1],
    )
    print(f'  icon.ico  → {ico_path}')

    # --- PNG for Linux AppImage ---
    png_path = os.path.join(OUT_DIR, 'icon.png')
    frames[-1].save(png_path, format='PNG')
    print(f'  icon.png  → {png_path}')

    print('Done.')


if __name__ == '__main__':
    main()
