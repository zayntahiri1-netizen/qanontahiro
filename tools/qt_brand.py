"""قانون تاهيرو — رسم الأيقونات من الشارة (resources/brand/qt-badge.png) بمقاييس كل منصة.

الشارة دائرة (مركزها ونصف قطرها يُحسبان من الصورة) تخرج منها زخارف قليلة: الميزان أعلاها، والمطرقة والشريط أسفلها،
فأبعد نقطة فيها على 1.18 من نصف القطر. لذلك تُقاس كل أيقونة بنصف قطر الدائرة لا بإطار الصورة، فتتوسط الدائرة
الأيقونة في كل شكل يقصّها به النظام (دائرة، مربع مستدير، قطرة…)، وتبقى الزخارف داخل منطقة الأمان.
"""
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
BADGE = ROOT / "resources" / "brand" / "qt-badge.png"
INK = (0x12, 0x18, 0x1F)          # لون الخلفية وtheme-color (ليل فاس)
INK_HI = (0x1B, 0x2A, 0x31)       # وسط التدرج خلف الشارة (يميل إلى خضرة إطارها)
BRASS = (0xC8, 0x9A, 0x3C)

_cache = {}


def badge():
    """الشارة ومعالم دائرتها: (الصورة، cx، cy، r، أبعد نقطة نسبةً إلى r)."""
    if "b" not in _cache:
        im = Image.open(BADGE).convert("RGBA")
        a = np.array(im)[:, :, 3] > 128
        pts = []
        for y in range(int(a.shape[0] * 0.17), int(a.shape[0] * 0.72), 3):     # جانبا الدائرة بين الميزان والشريط
            xs = np.where(a[y])[0]
            if len(xs):
                pts += [(xs[0], y), (xs[-1], y)]
        P = np.array(pts, float)
        A = np.c_[2 * P[:, 0], 2 * P[:, 1], np.ones(len(P))]
        cx, cy, c = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)[0]
        r = float(np.sqrt(c + cx ** 2 + cy ** 2))
        ys, xs = np.where(a)
        reach = float(np.hypot(xs - cx, ys - cy).max()) / r
        _cache["b"] = (im, float(cx), float(cy), r, reach)
    return _cache["b"]


def badge_layer(W, H, cx, cy, r, shadow=True):
    """طبقة شفافة W×H فيها الشارة ودائرتها بنصف قطر r ومركزها (cx, cy)، مع ظل ناعم يفصلها عن الخلفية الداكنة."""
    im, bx, by, br, _ = badge()
    s = r / br
    w, h = max(1, round(im.width * s)), max(1, round(im.height * s))
    b = im.resize((w, h), Image.LANCZOS)
    x0, y0 = round(cx - bx * s), round(cy - by * s)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if shadow:
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        alpha = b.getchannel("A").point(lambda v: round(v * 0.55))
        sh.paste(Image.new("RGBA", b.size, (0, 0, 0, 255)), (x0, y0 + round(r * 0.035)), alpha)
        out = Image.alpha_composite(out, sh.filter(ImageFilter.GaussianBlur(max(1, r * 0.045))))
    out.alpha_composite(b, (x0, y0))
    return out


def background(W, H, shape="square", radius=0.0, glow=True):
    """خلفية ليل فاس: مربع كامل، أو مربع مستدير (radius نسبة إلى الضلع)، أو دائرة؛ مع توهج خفيف في الوسط."""
    if glow:
        y, x = np.mgrid[0:H, 0:W]
        d = np.clip(np.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2)) / 1.15, 0, 1)
        t = (1 - d) ** 1.6
        rgb = np.stack([INK[i] + (INK_HI[i] - INK[i]) * t for i in range(3)], -1).astype(np.uint8)
        bg = Image.fromarray(rgb, "RGB").convert("RGBA")
    else:
        bg = Image.new("RGBA", (W, H), INK + (255,))
    if shape == "square":
        return bg
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    if shape == "circle":
        d.ellipse([0, 0, W - 1, H - 1], fill=255)
    else:
        d.rounded_rectangle([0, 0, W - 1, H - 1], radius=round(min(W, H) * radius), fill=255)
    bg.putalpha(m)
    return bg


def icon(n, shape="square", radius=0.22, fill=0.86, k=2, glow=True):
    """أيقونة n×n: الخلفية بالشكل المطلوب، والشارة تملأ fill من الضلع (أبعد زخارفها داخل الحد)."""
    N = n * k
    _, _, _, _, reach = badge()
    r = N * fill / 2 / reach
    im = Image.alpha_composite(background(N, N, shape, radius, glow), badge_layer(N, N, N / 2, N / 2, r))
    if shape != "square":                         # الظل لا يخرج عن شكل الأيقونة
        im.putalpha(Image.composite(im.getchannel("A"), Image.new("L", (N, N), 0), background(N, N, shape, radius).getchannel("A")))
    return im.resize((n, n), Image.LANCZOS)
