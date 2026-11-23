#!/usr/bin/env python3
"""قانون تاهيرو — يولّد موارد iPhone ومتجري التطبيقات من الشعار نفسه (النجمة الثمانية النحاسية على ليل فاس):

  resources/ios/AppIcon-1024.png   أيقونة iPhone (1024×1024، بلا شفافية كما تشترط Apple؛ النظام يدوّر حوافها)
  resources/ios/splash-2732.png    شاشة البدء في iPhone (مربعة، يقصّها النظام بحسب الجهاز)
  resources/store/play-icon-512.png        أيقونة صفحة Google Play (512×512)
  resources/store/play-feature-1024x500.png صورة العرض في Google Play (1024×500)

يضع scripts/qt-ios-hook.cjs ملفي iPhone فوق موارد قالب Capacitor بعد كل cap add/sync. تُلتزم الملفات في المستودع،
ولا يلزم تشغيل هذا الملف إلا عند تغيير الشعار:  python3 tools/make-ios-res.py
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
# نستعير رسم الشعار من مولّد أندرويد دون تشغيل كتابته للملفات
src = (ROOT / "tools" / "make-android-res.py").read_text(encoding="utf-8").split("\ndef save(")[0]
ns = {"__file__": str(ROOT / "tools" / "make-android-res.py")}
exec(compile(src, "make-android-res.py", "exec"), ns)
mark_layer, INK, BRASS = ns["mark_layer"], ns["INK"], ns["BRASS"]
K = 2


def flat(w, h, radius, out, rgb=True):
    W, H = w * K, h * K
    im = Image.alpha_composite(Image.new("RGBA", (W, H), INK + (255,)), mark_layer(W, H, W / 2, H / 2, radius * K))
    im = im.resize((w, h), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    (im.convert("RGB") if rgb else im).save(out, optimize=True)
    return out


IOS = ROOT / "resources" / "ios"
STORE = ROOT / "resources" / "store"
flat(1024, 1024, 1024 * 0.37, IOS / "AppIcon-1024.png")
flat(2732, 2732, 2732 * 0.085, IOS / "splash-2732.png")
flat(512, 512, 512 * 0.37, STORE / "play-icon-512.png", rgb=False)
# صورة العرض في Google Play: الشعار يميناً على ليل فاس (النص يُكتب في صفحة المتجر لا على الصورة، فلا حاجة إلى خط عربي هنا)
W, H = 1024 * K, 500 * K
im = Image.new("RGBA", (W, H), INK + (255,))
d = ImageDraw.Draw(im)
for i in range(0, W, 28 * K):                       # زليج خفيف: خطوط مائلة نحاسية بشفافية عالية
    d.line([(i, 0), (i - H, H)], fill=BRASS + (18,), width=K)
im = Image.alpha_composite(im, mark_layer(W, H, W * 0.78, H / 2, H * 0.36))
im = Image.alpha_composite(im, mark_layer(W, H, W * 0.18, H * 0.5, H * 0.18))
im.resize((1024, 500), Image.LANCZOS).convert("RGB").save(STORE / "play-feature-1024x500.png", optimize=True)
for p in (IOS / "AppIcon-1024.png", IOS / "splash-2732.png", STORE / "play-icon-512.png", STORE / "play-feature-1024x500.png"):
    with Image.open(p) as x:
        print(f"✓ {p.relative_to(ROOT)}  {x.size[0]}×{x.size[1]} {x.mode}")
