"""Erzeugt die App-Icons (Radar mit Signalpunkt). Aufruf: python3 scripts/make-icons.py"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "assets" / "images"
BG = (7, 9, 11, 255)
GREEN = (44, 255, 154, 255)
RED = (255, 59, 78, 255)
SS = 4  # Supersampling für glatte Kanten


def emblem(size: int, scale: float, color=GREEN, accent=RED, mono=False) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = s / 2
    r_max = s / 2 * scale
    col = (255, 255, 255, 255) if mono else color
    acc = (255, 255, 255, 255) if mono else accent

    # Radar-Sweep als Tortenstück mit Verlauf.
    if not mono:
        sweep = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sweep)
        for i in range(60):
            a0 = -90 - 60 + i
            alpha = int(110 * (i / 60) ** 2)
            sd.pieslice([c - r_max, c - r_max, c + r_max, c + r_max], a0, a0 + 1.5, fill=(44, 255, 154, alpha))
        img = Image.alpha_composite(img, sweep)
        d = ImageDraw.Draw(img)

    # Ringe
    for frac, width in ((1.0, 0.035), (0.68, 0.03), (0.36, 0.03)):
        r = r_max * frac
        w = max(1, int(s * width * scale))
        d.ellipse([c - r, c - r, c + r, c + r], outline=col, width=w)

    # Fadenkreuz-Striche
    w = max(1, int(s * 0.02 * scale))
    for ang in (0, 90, 180, 270):
        x0 = c + math.cos(math.radians(ang)) * r_max * 0.82
        y0 = c + math.sin(math.radians(ang)) * r_max * 0.82
        x1 = c + math.cos(math.radians(ang)) * r_max * 1.0
        y1 = c + math.sin(math.radians(ang)) * r_max * 1.0
        d.line([x0, y0, x1, y1], fill=col, width=w)

    # Mittelpunkt (Jäger) und Signalpunkt (Agent)
    rc = r_max * 0.08
    d.ellipse([c - rc, c - rc, c + rc, c + rc], fill=col)
    px = c + math.cos(math.radians(-55)) * r_max * 0.55
    py = c + math.sin(math.radians(-55)) * r_max * 0.55
    rp = r_max * 0.12
    if not mono:
        glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse([px - rp * 2.4, py - rp * 2.4, px + rp * 2.4, py + rp * 2.4], fill=(255, 59, 78, 120))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=rp))
        img = Image.alpha_composite(img, glow)
        d = ImageDraw.Draw(img)
    d.ellipse([px - rp, py - rp, px + rp, py + rp], fill=acc)

    return img.resize((size, size), Image.LANCZOS)


def with_bg(img: Image.Image) -> Image.Image:
    bg = Image.new("RGBA", img.size, BG)
    return Image.alpha_composite(bg, img)


OUT.mkdir(parents=True, exist_ok=True)
with_bg(emblem(1024, 0.78)).convert("RGB").save(OUT / "icon.png")
# Android: Vordergrund muss in der sicheren Mitte (66 %) liegen.
emblem(1024, 0.56).save(OUT / "android-icon-foreground.png")
emblem(1024, 0.56, mono=True).save(OUT / "android-icon-monochrome.png")
emblem(512, 0.9).save(OUT / "splash-icon.png")
print("Icons erzeugt in", OUT)
