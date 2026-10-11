"""Generate Android launcher icons and web icons from branding/focuslock-logo.png.

Usage (from the repository root): pip install pillow && python branding/make_icons.py branding/focuslock-logo.png .
"""
import os
import sys

from PIL import Image, ImageDraw

SRC, ROOT = sys.argv[1], sys.argv[2]
BLUE = (5, 41, 115)
src = Image.open(SRC).convert("RGB")
W = src.size[0]

# Flatten: replace the white outside the rounded square with the logo blue (for full-bleed uses).
radius = round(W * 0.15)
inside = Image.new("L", src.size, 0)
ImageDraw.Draw(inside).rounded_rectangle([0, 0, W - 1, W - 1], radius=radius, fill=255)
flat = Image.composite(src, Image.new("RGB", src.size, BLUE), inside)

# Rounded square with transparent corners (legacy launcher icon, favicon, header logo).
rounded = flat.convert("RGBA")
rounded.putalpha(inside)

# Circle version for round launcher icons.
circle_mask = Image.new("L", src.size, 0)
ImageDraw.Draw(circle_mask).ellipse([0, 0, W - 1, W - 1], fill=255)
circle = flat.convert("RGBA")
circle.putalpha(circle_mask)


# Adaptive foreground: launchers show only the central ~66% of this layer, so shrink the logo to keep the lock clear.
foreground = Image.new("RGB", src.size, BLUE)
inner = flat.resize((round(W * 0.72), round(W * 0.72)), Image.LANCZOS)
foreground.paste(inner, ((W - inner.size[0]) // 2, (W - inner.size[1]) // 2))


def save(image, path, size):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.resize((size, size), Image.LANCZOS).save(path, optimize=True)


res = os.path.join(ROOT, "android", "app", "src", "main", "res")
for density, scale in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    folder = os.path.join(res, f"mipmap-{density}")
    save(rounded, os.path.join(folder, "ic_launcher.png"), round(48 * scale))
    save(circle, os.path.join(folder, "ic_launcher_round.png"), round(48 * scale))
    # Adaptive foreground: the flattened logo fills the 108dp layer; launchers mask the outer edge.
    save(foreground, os.path.join(folder, "ic_launcher_foreground.png"), round(108 * scale))

anydpi = os.path.join(res, "mipmap-anydpi-v26")
os.makedirs(anydpi, exist_ok=True)
adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""
for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
    with open(os.path.join(anydpi, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(adaptive)
values = os.path.join(res, "values")
os.makedirs(values, exist_ok=True)
with open(os.path.join(values, "ic_launcher_background.xml"), "w", encoding="utf-8", newline="\n") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#052973</color>\n</resources>\n')

public = os.path.join(ROOT, "dashboard", "public")
save(rounded, os.path.join(public, "favicon-32.png"), 32)
save(rounded, os.path.join(public, "logo-64.png"), 64)
save(rounded, os.path.join(public, "icon-192.png"), 192)
save(rounded, os.path.join(public, "icon-512.png"), 512)
save(flat.convert("RGBA"), os.path.join(public, "apple-touch-icon.png"), 180)  # iOS rounds it itself
print("icons written")
