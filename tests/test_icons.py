#!/usr/bin/env python3
"""v8.3 — أيقونات التطبيق من شارة المؤلف: المقاسات والصيغ التي تشترطها كل منصة.
  • الشارة الأصل شفافة الخلفية (resources/brand/qt-badge.png).
  • أندرويد: التقليدية والدائرية 48dp بكل الكثافات، وواجهة الأيقونة المتكيفة 108dp شفافة، ودائرة الشارة في الوسط، وخلفيتها لون ليل فاس.
  • iPhone وiPad: 1024×1024 بلا شفافية (شرط Apple)، وشاشة بدء 2732 مربعة.
  • Google Play: 512×512 مربع كامل، وصورة العرض 1024×500.
  • الويب: 192 و512 وقابلة للقص 512 و180 لـ iPhone و32 للتبويب، وicon.svg.
  • الخطان المضمَّنان WOFF مع رخصتيهما.
"""
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
R = ROOT / "resources"
fails = []


def ok(c, m):
    if not c:
        fails.append(m)
        print("✗", m)


def img(rel):
    p = R / rel
    ok(p.exists(), f"{rel} غير موجود")
    return Image.open(p) if p.exists() else None


b = img("brand/qt-badge.png")
if b:
    a = b.getchannel("A")
    ok(b.mode == "RGBA" and a.getpixel((0, 0)) == 0 and a.getpixel((b.width // 2, b.height // 2)) == 255, "الشارة: خلفية شفافة ووسط معتم")
for name, f in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    for icon in ("ic_launcher", "ic_launcher_round"):
        im = img(f"android/res/mipmap-{name}/{icon}.png")
        ok(im is not None and im.size == (round(48 * f),) * 2, f"{name}/{icon}: {im and im.size}")
    fg = img(f"android/res/mipmap-{name}/ic_launcher_foreground.png")
    if fg:
        n = round(108 * f)
        ok(fg.size == (n, n), f"{name}/foreground: {fg.size}")
        A = fg.convert("RGBA").getchannel("A")
        ok(A.getpixel((0, 0)) == 0 and A.getpixel((n // 2, n // 2)) == 255, f"{name}/foreground: شفاف الحواف معتم الوسط")
        box = A.point(lambda v: 255 if v > 40 else 0).getbbox()
        ok(box and box[0] >= n * 16 / 108 and box[2] <= n * 92 / 108, f"{name}/foreground: الشارة داخل منطقة القناع (72dp) {box}")
xml = (R / "android/res/values/ic_launcher_background.xml").read_text(encoding="utf-8")
ok("#12181F" in xml, "لون خلفية الأيقونة المتكيفة")
ios = img("ios/AppIcon-1024.png")
ok(ios is not None and ios.size == (1024, 1024) and ios.mode == "RGB", f"أيقونة iPhone: 1024 بلا شفافية ({ios and ios.mode})")
sp = img("ios/splash-2732.png")
ok(sp is not None and sp.size == (2732, 2732), "شاشة بدء iPhone 2732")
pi = img("store/play-icon-512.png")
ok(pi is not None and pi.size == (512, 512) and pi.convert("RGBA").getchannel("A").getextrema() == (255, 255), "أيقونة Google Play: 512 مربع كامل")
fe = img("store/play-feature-1024x500.png")
ok(fe is not None and fe.size == (1024, 500), "صورة العرض 1024×500")
for rel, size, opaque in (("pwa/icon-192.png", 192, False), ("pwa/icon-512.png", 512, False), ("pwa/icon-maskable-512.png", 512, True),
                          ("pwa/icon-180.png", 180, True), ("pwa/icon-32.png", 32, False)):
    im = img(rel)
    if im:
        ok(im.size == (size, size), f"{rel}: {im.size}")
        if opaque:
            ok(im.convert("RGBA").getchannel("A").getextrema() == (255, 255), f"{rel}: مربع كامل بلا شفافية")
svg = (R / "pwa/icon.svg").read_text(encoding="utf-8")
ok(svg.startswith("<svg") and "data:image/png;base64," in svg and len(svg) < 60000, "icon.svg: الشارة مضمَّنة وحجمها معقول")
for f in ("qt-naskh.woff", "qt-messiri.woff", "OFL-NotoNaskhArabic.txt", "OFL-ElMessiri.txt"):
    p = R / "fonts" / f
    ok(p.exists() and p.stat().st_size > 1000, f"الخطوط: {f}")
    if p.exists() and f.endswith(".woff"):
        ok(p.read_bytes()[:4] == b"wOFF" and p.stat().st_size < 150_000, f"{f}: WOFF مقتطع")
if fails:
    print(f"\n✗ {len(fails)} فحصاً فشل في الأيقونات والخطوط")
    sys.exit(1)
print("✓ الأيقونات والخطوط: أندرويد وiPhone وGoogle Play والويب، بالمقاسات والصيغ المطلوبة")
