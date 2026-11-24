#!/usr/bin/env python3
"""قانون تاهيرو — يولّد موارد iPhone ومتجري التطبيقات من شارة التطبيق (resources/brand/qt-badge.png):

  resources/ios/AppIcon-1024.png   أيقونة iPhone وiPad (1024×1024، مربع كامل بلا شفافية كما تشترط Apple؛ النظام يدوّر حوافها)
  resources/ios/splash-2732.png    شاشة البدء في iPhone وiPad (مربعة، يقصّها النظام بحسب الجهاز، والشارة في الوسط دائماً)
  resources/store/play-icon-512.png        أيقونة صفحة Google Play (512×512، مربع كامل؛ المتجر يدوّر حوافه)
  resources/store/play-feature-1024x500.png صورة العرض في Google Play (1024×500)

يضع scripts/qt-ios-hook.cjs ملفي iPhone فوق موارد قالب Capacitor بعد كل cap add/sync. تُلتزم الملفات في المستودع،
ولا يلزم تشغيل هذا الملف إلا عند تغيير الشارة:  python3 tools/make-ios-res.py
"""
import pathlib
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qt_brand import BRASS, INK, badge_layer, background, icon  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
IOS = ROOT / "resources" / "ios"
STORE = ROOT / "resources" / "store"
IOS.mkdir(parents=True, exist_ok=True)
STORE.mkdir(parents=True, exist_ok=True)

# مربع كامل: قناع Apple (مربع مستدير ناعم) وقناع Google Play (حواف 20٪) لا يبلغان زخارف الشارة عند 86٪ من الضلع
icon(1024, "square", fill=0.86).convert("RGB").save(IOS / "AppIcon-1024.png", optimize=True)
icon(512, "square", fill=0.86).save(STORE / "play-icon-512.png", optimize=True)

# شاشة البدء: مربع 2732 يُقص منه وسطه بحسب الشاشة، فتبقى الشارة صغيرة في الوسط (نصف قطر دائرتها 9٪ من الضلع)
W = 2732
im = Image.alpha_composite(background(W, W), badge_layer(W, W, W / 2, W / 2, W * 0.09))
im.convert("RGB").save(IOS / "splash-2732.png", optimize=True)

# صورة العرض في Google Play: الشارة يميناً على ليل فاس وزليج خفيف (النص في صفحة المتجر لا على الصورة)
K = 2
W, H = 1024 * K, 500 * K
im = background(W, H)
d = ImageDraw.Draw(im)
for i in range(0, W + H, 28 * K):
    d.line([(i, 0), (i - H, H)], fill=BRASS + (16,), width=K)
im = Image.alpha_composite(im, badge_layer(W, H, W * 0.74, H * 0.5, H * 0.36))
im.resize((1024, 500), Image.LANCZOS).convert("RGB").save(STORE / "play-feature-1024x500.png", optimize=True)

for p in (IOS / "AppIcon-1024.png", IOS / "splash-2732.png", STORE / "play-icon-512.png", STORE / "play-feature-1024x500.png"):
    with Image.open(p) as x:
        print(f"✓ {p.relative_to(ROOT)}  {x.size[0]}×{x.size[1]} {x.mode}")
assert INK
