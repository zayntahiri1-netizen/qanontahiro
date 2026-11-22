#!/usr/bin/env python3
"""إعادة بناء النصوص المستخرجة من ملفات PDF الأصلية.

كُتب بعد حادثة إفراغ مجلد العمل (الجولة 97): الاستعادة اليدوية استغرقت
ست خطوات وأخطأتُ في اثنتين منها. هذا السكربت يجعلها أمراً واحداً مُتحقَّقاً منه.

الاستعمال:  python3 tools_extract.py [مجلد_الرفوعات]
"""
import subprocess, re, pathlib, unicodedata, sys, json

BIDI = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c"
                                "\u202d\u202e\u2066\u2067\u2068\u2069\ufeff\u00ad\u0640"))

# لكل نص: المصادر المرشَّحة بالترتيب، وكلمات مفتاحية تُقاس بها سلامة الترميز.
# تعدد المرشحين مقصود: بعض النسخ مبدَّلة الحروف، والقياس يفرزها لا النظر.
SPECS = {
 "loc_clean.txt":  (["قانون-الالتزامات-والعقود.pdf"], ["الفصل", "الالتزام", "المدين"]),
 "tijara2.txt":    (["3_TradeRecord_ar-MA.pdf", "_المغربية_مدونة_التجارة.pdf"],
                    ["المادة", "التجاري", "السجل"]),
 "c0e1bb24.txt":   (["مدونة-الحقوق-العينية.pdf"], ["املادة", "العقار", "امللكية"]),
 "41c67013.txt":   (["mudawwana-usra.pdf"], ["المادة", "الزوج", "النفقة"]),
 "civ_cols.txt":   (["BO_7485_Ar.pdf"], ["املادة", "املحكمة", "الدعوى"]),
 "5d4ec838.txt":   (["قانون_المسطرة_الجنائية_الجديد_2025__مكتبة_امين_اليعقوبي__.pdf"],
                    ["املادة", "النيابة", "املتهم"]),
 "shughl.txt":     (["القانون_رقم_65_99_المتعلق_بمدونة_الشغل__1_.pdf", "مدونة-الشغل.pdf"],
                    ["المادة", "الأجير", "المشغل"]),
 "jinai.txt":      (["مجموعة-القانون-الجنائي-المعدلة-2025.pdf", "مجموعة_القانون_الجنائي.pdf"],
                    ["الفصل", "يعاقب", "احلبس"]),
 "tanzim.txt":     (["ظهير-شريف-رقم-1_22_38-بتنفيذ-القانون-رقم-38_15-المتعلق-بالتنظيم-القضائي.pdf"],
                    ["املادة", "املحكمة", "القضاء"]),
 "dustour.txt":    (["constitution_marocaine_2011-ar.pdf"], ["الدستور", "القانون", "المملكة"]),
}
MIN_HITS = 150      # دون هذا الحد يُعدّ الاستخراج مبدَّل الحروف


def extract(path):
    raw = subprocess.run(["pdftotext", "-layout", str(path), "-"],
                         capture_output=True, text=True).stdout
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", raw).translate(BIDI))


def build_dustour_index(txt_dir):
    """أرقام فصول الدستور مرسومة بخط زخرفي؛ نستخرجها من الرموز ونبني فهرساً."""
    t = (txt_dir / "dustour.txt").read_text(encoding="utf-8")
    marks = [(int(m.group(1)), m.end())
             for m in re.finditer(r"<\s*(\d{1,3})\s*<[^\s]{0,12}", t)]
    idx = {}
    for i, (n, pos) in enumerate(marks):
        end = marks[i + 1][1] - 40 if i + 1 < len(marks) else pos + 900
        body = re.sub(r"[^\u0600-\u06FF0-9\s،.:؛()\-]", " ", t[pos:end]).strip()
        if len(body) > len(idx.get(n, "")):
            idx[n] = body
    (txt_dir / "dustour_idx.json").write_text(
        json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    return len(idx)


def main():
    up = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/uploads")
    txt = pathlib.Path(__file__).parent.parent / "txt"
    txt.mkdir(exist_ok=True)
    ok = fail = 0
    for out, (cands, keys) in SPECS.items():
        best = (0, None, None)          # (عدد المفاتيح، النص، المصدر)
        for c in cands:
            p = up / c
            if not p.exists():
                continue
            t = extract(p)
            hits = sum(t.count(k) for k in keys)
            if hits > best[0]:
                best = (hits, t, c)     # الأفضل قياساً لا آخر المجرَّب
        if best[0] < MIN_HITS:
            print(f"  ✗ {out:<16} لم يبلغ الحد ({best[0]} مفتاحاً) — "
                  f"{'مصدر مفقود' if best[1] is None else 'ترميز مبدَّل'}")
            fail += 1
            continue
        (txt / out).write_text(best[1], encoding="utf-8")
        print(f"  ✓ {out:<16} {len(best[1]):>7} حرف · {best[0]:>5} مفتاحاً · من {best[2]}")
        ok += 1
    if (txt / "dustour.txt").exists():
        print(f"  ✓ فهرس الدستور: {build_dustour_index(txt)} فصلاً")
    print(f"\n{ok} نصاً جاهزاً" + (f" · {fail} متعذّراً" if fail else ""))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
