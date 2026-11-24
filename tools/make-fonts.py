#!/usr/bin/env python3
"""قانون تاهيرو — خطا التطبيق، مقتطعين ومضمَّنين فيه (لا تحميل من Google Fonts، فيظهر الخط نفسه على كل جهاز ودون اتصال):

  resources/fonts/qt-naskh.woff    «Noto Naskh Arabic» (نسخ واضح جميل لقراءة الأسئلة والنصوص القانونية) — الأوزان 400 إلى 700
  resources/fonts/qt-messiri.woff  «El Messiri» (للعناوين والأرقام والأزرار) — الأوزان 400 إلى 700

الاقتطاع: الحروف العربية الأساسية (U+0600–06FF) واللاتينية والفرنسية وعلامات الترقيم، مع كل خصائص التشكيل والربط (GSUB/GPOS)،
فينزل حجم الخطين معاً إلى نحو 130 ك.ب. الرخصة: SIL Open Font License 1.1 (نصها بجانب كل خط في resources/fonts).

الملفات تُلتزم في المستودع؛ ولا يلزم تشغيل هذا الملف إلا لتغيير الخطوط. يحتاج fontTools وملفات الخطين من مستودع Google Fonts:
    git clone --depth 1 --filter=blob:none --sparse https://github.com/google/fonts gf && cd gf && git sparse-checkout set ofl/notonaskharabic ofl/elmessiri
    python3 tools/make-fonts.py gf/ofl
"""
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "resources" / "fonts"
UNI = ("U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+0600-06FF,U+200B-200F,U+2010-2027,"
       "U+2030-203A,U+2066-2069,U+2122,U+2212,U+25CC,U+FD3E-FD3F,U+FDF2,U+FDFC")
FONTS = [("notonaskharabic/NotoNaskhArabic[wght].ttf", "qt-naskh.woff", "OFL-NotoNaskhArabic.txt"),
         ("elmessiri/ElMessiri[wght].ttf", "qt-messiri.woff", "OFL-ElMessiri.txt")]

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    from fontTools import subset
    src = pathlib.Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for rel, name, lic in FONTS:
        f = src / rel
        subset.main([str(f), f"--unicodes={UNI}", "--layout-features=*", "--no-hinting", "--desubroutinize",
                     "--flavor=woff", f"--output-file={OUT / name}"])
        shutil.copyfile(f.parent / "OFL.txt", OUT / lic)
        print(f"✓ resources/fonts/{name}  {(OUT / name).stat().st_size // 1024} ك.ب")
