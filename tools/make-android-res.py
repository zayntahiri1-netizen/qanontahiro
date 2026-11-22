#!/usr/bin/env python3
"""قانون تاهيرو — يولّد موارد أندرويد (الأيقونات وشاشة البدء) في resources/android/res.

الشعار نفسه الذي يرسمه build.py لأيقونة الويب (النجمة الثمانية النحاسية على ليل فاس)،
بالمقاسات التي يتوقعها قالب Capacitor 8، فيضعها خطاف scripts/qt-android-hook.cjs
فوق أيقونات القالب بعد كل cap add/sync. الملفات الناتجة تُلتزم في المستودع؛
ولا يلزم تشغيل هذا الملف إلا عند تغيير الشعار:  python3 tools/make-android-res.py
"""
import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
RES = ROOT / "resources" / "android" / "res"
INK = (0x12, 0x18, 0x1F)          # لون الخلفية في أيقونة الويب وtheme-color
BRASS = (0xC8, 0x9A, 0x3C)
K = 4                             # رسم بأربعة أضعاف ثم تصغير ناعم


def star_points(c, R, r, n=8, rot=0.0):
    return [(c + (R if i % 2 == 0 else r) * math.cos(rot + i * math.pi / n),
             c + (R if i % 2 == 0 else r) * math.sin(rot + i * math.pi / n)) for i in range(2 * n)]


def mark_layer(w, h, cx, cy, radius):
    """طبقة شفافة فيها النجمتان والدائرة كما في build.py، مركّبة بشفافية حقيقية (النجمة الداخلية 65٪).
    radius = نصف القطر الخارجي شاملاً سُمك الخط (205 من 512 في أيقونة الويب)."""
    s = radius / 205.0
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    parts = [("star", 196, 112, 18, 0.0, 1.0), ("star", 138, 80, 11, math.pi / 8, 0.65), ("dot", 40, 0, 0, 0, 1.0)]
    for kind, R, r, wd, rot, op in parts:
        lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        if kind == "star":
            poly = [(cx + (x - 256) * s, cy + (y - 256) * s) for x, y in star_points(256, R, r, rot=rot)]
            d.line(poly + [poly[0], poly[1]], fill=BRASS + (255,), width=max(1, round(wd * s)), joint="curve")
        else:
            d.ellipse([cx - R * s, cy - R * s, cx + R * s, cy + R * s], fill=BRASS + (255,))
        if op < 1:
            lay.putalpha(lay.getchannel("A").point(lambda v: round(v * op)))
        out = Image.alpha_composite(out, lay)
    return out


def save(im, w, h, rel):
    p = RES / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im.resize((w, h), Image.LANCZOS).save(p, optimize=True)


DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

for name, f in DENS.items():
    n = round(48 * f)
    N = n * K
    # أيقونة تقليدية (قبل أندرويد 8): مربع مستدير كأيقونة الويب
    bg = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(bg).rounded_rectangle([0, 0, N - 1, N - 1], radius=round(N * 112 / 512), fill=INK + (255,))
    save(Image.alpha_composite(bg, mark_layer(N, N, N / 2, N / 2, N * 205 / 512)), n, n, f"mipmap-{name}/ic_launcher.png")
    # أيقونة دائرية
    bg = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(bg).ellipse([0, 0, N - 1, N - 1], fill=INK + (255,))
    save(Image.alpha_composite(bg, mark_layer(N, N, N / 2, N / 2, N * 0.36)), n, n, f"mipmap-{name}/ic_launcher_round.png")
    # الواجهة الأمامية للأيقونة المتكيفة (108dp): الشعار داخل دائرة الأمان (66dp) بهامش
    n = round(108 * f)
    N = n * K
    save(mark_layer(N, N, N / 2, N / 2, N * 29 / 108), n, n, f"mipmap-{name}/ic_launcher_foreground.png")

# شاشة البدء لأندرويد 7–11 (من 12 فصاعداً يعرض النظام الأيقونة المتكيفة على لون الخلفية نفسه)
SPLASH = {"drawable": (480, 320),
          "drawable-port-mdpi": (320, 480), "drawable-port-hdpi": (480, 800), "drawable-port-xhdpi": (720, 1280),
          "drawable-port-xxhdpi": (960, 1600), "drawable-port-xxxhdpi": (1280, 1920),
          "drawable-land-mdpi": (480, 320), "drawable-land-hdpi": (800, 480), "drawable-land-xhdpi": (1280, 720),
          "drawable-land-xxhdpi": (1600, 960), "drawable-land-xxxhdpi": (1920, 1280)}
for folder, (w, h) in SPLASH.items():
    W, H = w * 2, h * 2
    bg = Image.new("RGBA", (W, H), INK + (255,))
    im = Image.alpha_composite(bg, mark_layer(W, H, W / 2, H / 2, min(W, H) * 0.17))
    save(im.convert("RGB"), w, h, f"{folder}/splash.png")

(RES / "values").mkdir(parents=True, exist_ok=True)
(RES / "values" / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#12181F</color>\n</resources>\n',
    encoding="utf-8")
(RES / "values" / "qt_colors.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="qt_ink">#12181F</color>\n</resources>\n',
    encoding="utf-8")
print("✓ resources/android/res:", sum(1 for x in RES.rglob("*") if x.is_file()), "ملفاً")
