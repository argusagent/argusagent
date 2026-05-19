"""Generate UnderWrite Pro PWA icons. Run from repo root: python3 tests/make-icons.py"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

BG = (10, 13, 16)
SURFACE = (20, 24, 29)
GOLD = (200, 165, 94)
TEXT = (230, 228, 221)
TEXT_DIM = (108, 111, 118)

def find_serif():
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
        '/System/Library/Fonts/Georgia.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None

def find_mono():
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None

SERIF = find_serif()
MONO = find_mono()

def draw_icon(size, maskable=False):
    img = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(img)
    # Safe area for maskable: 10% inset on all sides => content within central 80%.
    if maskable:
        inset = int(size * 0.10)
    else:
        inset = int(size * 0.04)
    rect_size = size - inset * 2
    # Subtle bevel — draw a slightly lighter inner square
    bevel = int(size * 0.005) if size >= 192 else 1
    # No outer rectangle for maskable (background extends to edge)
    if not maskable:
        d.rounded_rectangle(
            [(inset, inset), (size - inset, size - inset)],
            radius=int(size * 0.16),
            fill=SURFACE, outline=None,
        )
    # Gold accent corner: a small triangular flag in the top-right
    flag = int(size * 0.22)
    pad = inset + int(size * 0.06) if not maskable else int(size * 0.10)
    # Center content
    cx, cy = size / 2, size / 2

    # Big serif "UW" or just "U"
    if SERIF:
        # Use 'U' on small icons for clarity, 'UW' on larger
        text = 'UW'
        fsize = int(size * 0.42)
        font = ImageFont.truetype(SERIF, fsize)
        bbox = d.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = cx - tw / 2 - bbox[0]
        ty = cy - th / 2 - bbox[1] - int(size * 0.02)
        d.text((tx, ty), text, fill=TEXT, font=font)
        # Gold underline below
        underline_w = int(tw * 0.6)
        ux1 = cx - underline_w / 2
        uy = ty + th + int(size * 0.04)
        d.rounded_rectangle(
            [(ux1, uy), (ux1 + underline_w, uy + max(2, int(size * 0.012)))],
            radius=int(size * 0.005),
            fill=GOLD,
        )
        # Small mono tag below
        if MONO and size >= 192:
            tag = 'UNDERWRITE'
            tfsize = int(size * 0.058)
            tfont = ImageFont.truetype(MONO, tfsize)
            tb = d.textbbox((0, 0), tag, font=tfont)
            ttw = tb[2] - tb[0]
            d.text((cx - ttw / 2 - tb[0], uy + int(size * 0.04)), tag, fill=TEXT_DIM, font=tfont)
    return img

os.makedirs('icons', exist_ok=True)

for size in (192, 512):
    img = draw_icon(size)
    img.save(f'icons/icon-{size}.png', 'PNG', optimize=True)
    print(f'wrote icons/icon-{size}.png')

# Maskable variant fills entire canvas with background and centers content in safe zone
img = draw_icon(512, maskable=True)
img.save('icons/icon-maskable.png', 'PNG', optimize=True)
print('wrote icons/icon-maskable.png')

# Apple touch icon (180x180)
img = draw_icon(180)
img.save('icons/icon-180.png', 'PNG', optimize=True)
print('wrote icons/icon-180.png')

# Favicon (32x32)
img = draw_icon(64)
img = img.resize((32, 32), Image.LANCZOS)
img.save('icons/favicon.png', 'PNG', optimize=True)
print('wrote icons/favicon.png')
