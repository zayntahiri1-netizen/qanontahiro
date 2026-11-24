#!/usr/bin/env python3
"""قانون تاهيرو — يولّد موارد أندرويد (الأيقونات وشاشة البدء) في resources/android/res من شارة التطبيق
(resources/brand/qt-badge.png، تستخرجها tools/make-badge.py من صورة المؤلف).

بالمقاسات التي يتوقعها قالب Capacitor 8، فيضعها خطاف scripts/qt-android-hook.cjs فوق أيقونات القالب بعد كل cap add/sync:
  • الأيقونة المتكيفة (أندرويد 8 فما فوق): واجهة 108dp فيها الشارة، وخلفيتها لون ليل فاس #12181F. دائرة الشارة قطرها 59dp
    فتتوسط كل قناع يختاره الهاتف (دائرة، مربع مستدير، قطرة…)، وأبعد زخارفها (طرف المطرقة) على 35dp من المركز، داخل كل قناع (72dp).
  • الأيقونة التقليدية والدائرية للأجهزة الأقدم، بكل الكثافات من mdpi إلى xxxhdpi.
  • شاشة البدء لأندرويد 7–11 (من 12 فصاعداً يعرض النظام الأيقونة المتكيفة على لون الخلفية نفسه).
الملفات الناتجة تُلتزم في المستودع؛ ولا يلزم تشغيل هذا الملف إلا عند تغيير الشارة:  python3 tools/make-android-res.py
"""
import pathlib
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qt_brand import INK, badge, badge_layer, background, icon  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
RES = ROOT / "resources" / "android" / "res"
K = 4                             # رسم بأربعة أضعاف ثم تصغير ناعم


def save(im, w, h, rel):
    p = RES / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im.resize((w, h), Image.LANCZOS).save(p, optimize=True)


DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
_, _, _, _, REACH = badge()

for name, f in DENS.items():
    n = round(48 * f)
    save(icon(n * K, "rounded", radius=0.22, fill=0.92, k=1), n, n, f"mipmap-{name}/ic_launcher.png")
    save(icon(n * K, "circle", fill=0.94, k=1), n, n, f"mipmap-{name}/ic_launcher_round.png")
    # الواجهة الأمامية للأيقونة المتكيفة (108dp): دائرة الشارة 59dp في الوسط، وأبعد زخارفها على 35dp من المركز
    n = round(108 * f)
    N = n * K
    save(badge_layer(N, N, N / 2, N / 2, N * 29.5 / 108), n, n, f"mipmap-{name}/ic_launcher_foreground.png")

SPLASH = {"drawable": (480, 320),
          "drawable-port-mdpi": (320, 480), "drawable-port-hdpi": (480, 800), "drawable-port-xhdpi": (720, 1280),
          "drawable-port-xxhdpi": (960, 1600), "drawable-port-xxxhdpi": (1280, 1920),
          "drawable-land-mdpi": (480, 320), "drawable-land-hdpi": (800, 480), "drawable-land-xhdpi": (1280, 720),
          "drawable-land-xxhdpi": (1600, 960), "drawable-land-xxxhdpi": (1920, 1280)}
for folder, (w, h) in SPLASH.items():
    W, H = w * 2, h * 2
    r = min(W, H) * 0.19
    im = Image.alpha_composite(background(W, H), badge_layer(W, H, W / 2, H / 2, r))
    save(im.convert("RGB"), w, h, f"{folder}/splash.png")

(RES / "values").mkdir(parents=True, exist_ok=True)
(RES / "values" / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#12181F</color>\n</resources>\n',
    encoding="utf-8")
(RES / "values" / "qt_colors.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="qt_ink">#12181F</color>\n</resources>\n',
    encoding="utf-8")
assert INK == (0x12, 0x18, 0x1F)
print("✓ resources/android/res:", sum(1 for x in RES.rglob("*") if x.is_file()), "ملفاً")
