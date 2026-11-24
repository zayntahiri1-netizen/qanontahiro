#!/usr/bin/env python3
"""قانون تاهيرو — أيقونات نسخة الويب (PWA) والموقع من شارة التطبيق، في resources/pwa/ ينسخها build.py إلى dist/app/:

  icon-192.png / icon-512.png   للتثبيت من المتصفح (purpose any): مربع مستدير شفاف الحواف
  icon-maskable-512.png         للأجهزة التي تقص الأيقونة بشكلها (purpose maskable): مربع كامل، والشارة كلها في دائرة الأمان (80٪)
  icon-180.png                  apple-touch-icon لـ Safari على iPhone وiPad: مربع كامل بلا شفافية (النظام يدوّر حوافه)
  icon-32.png                   أيقونة التبويب للمتصفحات التي لا تقرأ SVG
  icon.svg                      أيقونة التبويب: الشارة (صورة 96×96 مضمّنة) بصيغة SVG، فتبقى روابط الصفحات القديمة صالحة

الملفات تُلتزم في المستودع، فلا يحتاج البناء إلى مكتبة صور:  python3 tools/make-pwa-icons.py
"""
import base64
import io
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qt_brand import badge, icon  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "resources" / "pwa"
OUT.mkdir(parents=True, exist_ok=True)
_, _, _, _, REACH = badge()

icon(192, "rounded", radius=0.22, fill=0.92).save(OUT / "icon-192.png", optimize=True)
icon(512, "rounded", radius=0.22, fill=0.92).save(OUT / "icon-512.png", optimize=True)
icon(512, "square", fill=0.80).save(OUT / "icon-maskable-512.png", optimize=True)
icon(180, "square", fill=0.86).convert("RGB").save(OUT / "icon-180.png", optimize=True)
icon(32, "rounded", radius=0.22, fill=0.96, k=4).save(OUT / "icon-32.png", optimize=True)
fav = icon(96, "rounded", radius=0.22, fill=0.96, k=4)
buf = io.BytesIO()
fav.save(buf, "PNG", optimize=True)
(OUT / "icon.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 96 96" width="96" height="96">'
    f'<image width="96" height="96" href="data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"/></svg>',
    encoding="utf-8")
for p in sorted(OUT.iterdir()):
    print(f"✓ {p.relative_to(ROOT)}  {p.stat().st_size // 1024} KB")
