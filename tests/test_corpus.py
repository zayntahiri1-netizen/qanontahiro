#!/usr/bin/env python3
"""يحرس مكتبة النصوص التي يجيب منها «المساعد» (data/corpus/): لا يدخلها نص مشوَّه أو ناقص.

يُشغَّل بعد python3 tools/build_corpus.py --write (المكتبة ملتزمة في المستودع، فيكفي تشغيله وحده):
  • كل قانون في الفهرس له ملفه، وعدد مواده كما في الفهرس، ولا تتكرر أرقامه.
  • لا حرف بلا مقابل (�)، ولا أشكال العرض العربية (ﺍﻟﻤﺤﻜﻤﺔ)، ولا بقايا البناء الداخلية (علامات الحواشي والأسطر العريضة).
  • لا قلب لحروف الأربطة الذي يقع فيه pdftotext («املحكمة»، «اإلدارة»).
  • تغطية المواد التي يستشهد بها بنك الأسئلة ≥ 95٪ لكل قانون استُشهد بعشر مواد منه فأكثر.
  • نصوص مواد معروفة كما هي حرفياً (عينات من قوانين مختلفة ومصادر مختلفة).
"""
import json, re, sys, pathlib, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build_corpus as BC  # noqa: E402

CORPUS = ROOT / "data" / "corpus"
fails = []


def ok(cond, msg):
    if not cond:
        fails.append(msg)
        print("✗", msg)


idx = json.loads((CORPUS / "index.json").read_text(encoding="utf-8"))
laws = {m["slug"]: m for m in idx["laws"]}
ok(len(laws) >= 25, f"المكتبة تضم {len(laws)} قانوناً فقط")
for e in idx["excluded"]:
    ok(e.get("why"), f"{e['slug']}: استُبعد دون سبب")
    ok(not (CORPUS / f"{e['slug']}.json").exists(), f"{e['slug']}: مستبعد وملفه موجود")

PRES = re.compile(r"[ﭐ-﷿ﹰ-﻿]")
SWAP = re.compile(r"(?<![؀-ۿ])ا[محجخ]ل[؀-ۿ]{2,}|اإل|(?<![؀-ۿ])إصالح")
data = {}
total = 0
for slug, meta in laws.items():
    f = CORPUS / f"{slug}.json"
    ok(f.exists(), f"{slug}: ملف المكتبة غير موجود")
    if not f.exists():
        continue
    d = json.loads(f.read_text(encoding="utf-8"))
    data[slug] = d
    items = d["items"]
    total += len(items)
    ok(len(items) == meta["articles"], f"{slug}: {len(items)} مادة والفهرس يقول {meta['articles']}")
    ok(len(items) >= 5, f"{slug}: أقل من خمس مواد")
    labels = collections.Counter(a["label"] for a in items)
    dup = [l for l, c in labels.items() if c > 1]
    ok(not dup, f"{slug}: أرقام مكررة {dup[:5]}")
    ok(meta.get("title") and meta.get("word") in ("المادة", "الفصل"), f"{slug}: بيانات القانون ناقصة")
    ok(meta.get("match"), f"{slug}: بلا صيغة تعرّف ذكره في سؤال المستخدم")
    try:
        re.compile(meta.get("match") or "x")
    except re.error as e:
        ok(False, f"{slug}: صيغة التعرّف غير صالحة ({e})")
    toks = 0
    swaps = 0
    for a in items:
        t = a["text"]
        toks += len(t.split())
        swaps += len(SWAP.findall(t))
        for bad, why in (("�", "حرف بلا مقابل"), ("\u0001", "بادئة سطر عريض"), ("⟦", "علامة حاشية")):
            ok(bad not in t and bad not in a.get("path", ""), f"{slug} {a['label']}: {why}")
        ok(not PRES.search(t), f"{slug} {a['label']}: أشكال عرض عربية في النص")
        ok(len(t) <= 12000, f"{slug} {a['label']}: نص طوله {len(t)} (عناوين ضائعة؟)")
        for n in a.get("notes", []):
            ok(isinstance(n, str) and n.strip() and "⟦" not in n, f"{slug} {a['label']}: حاشية فارغة أو معطوبة")
    ok(swaps <= max(3, toks // 5000), f"{slug}: {swaps} كلمة بحروف أربطة مقلوبة")

ok(total >= 7000, f"مجموع المواد {total} فقط")

# تغطية مراجع البنك
refs = BC.bank_refs()
for slug, d in data.items():
    cited = refs.get(slug, collections.Counter())
    if len(cited) < 10:
        continue
    have = {a["n"] for a in d["items"]}
    miss = sorted(n for n in cited if n not in have)
    cov = 1 - len(miss) / len(cited)
    ok(cov >= 0.95, f"{slug}: تغطية مراجع البنك {cov:.1%} (ينقص {miss[:8]})")

# عينات حرفية
SPOT = [
    ("constitution", "1", "نظام الحكم بالمغرب نظام ملكية دستورية، ديمقراطية برلمانية واجتماعية."),
    ("constitution", "180", "ينسخ نص الدستور المراجع"),
    ("family", "4", "الزواج ميثاق تراض وترابط شرعي بين رجل وامرأة على وجه الدوام"),
    ("family", "400", "يرجع فيه إلى المذهب المالكي"),
    ("doc", "1", "تنشأ الالتزامات عن الاتفاقات والتصريحات الأخرى المعبرة عن الإرادة"),
    ("doc", "106-2", "منتوج"),
    ("criminal", "1", "يحدد التشريع الجنائي أفعال الإنسان التي يعدها جرائم"),
    ("criminal", "2", "لا يسوغ لأحد أن يعتذر بجهل التشريع الجنائي."),
    ("commerce", "1", "ينظم هذا القانون القواعد المتعلقة بالأعمال التجارية والتجار."),
    ("labour", "1", "تسري أحكام هذا القانون على الأشخاص المرتبطين بعقد شغل"),
    ("criminal_proc", "175", "الاعتقال الاحتياطي تدبير استثنائي"),
    ("criminal_proc", "383-9", "إذا لم يحترم قاضي القرب اختصاصه النوعي أو القيمي"),
    ("civil_proc", "1", "تسهر المحاكم على حسن سير العدالة"),
    ("awqaf", "1", "الوقف هو كل مال حبس أصله بصفة مؤبدة أو مؤقتة"),
    ("adoul", "1", "العدل مساعد للقضاء، يمارس مهنة حرة"),
    ("domestic_work", "7", "يمنع تسخير العاملة أو العامل المنزلي لأداء الشغل قهرا أو جبرا."),
    ("strike", "1", "الإضراب حق يضمنه الدستور"),
]
for slug, n, snippet in SPOT:
    d = data.get(slug)
    a = d and next((x for x in d["items"] if x["n"] == n), None)
    ok(a is not None, f"{slug}: المادة {n} غير موجودة")
    if a:
        ok(snippet in a["text"], f"{slug} {a['label']}: لا يتضمن «{snippet}» — بدايته: «{a['text'][:90]}»")

# مادة منسوخة: نصها فارغ، وحاشيتها تقول إنها نُسخت (فلا يعرضها المساعد نصاً نافذاً)
c132 = next((x for x in data.get("commerce", {}).get("items", []) if x["n"] == "132"), None)
ok(c132 is not None and not c132["text"] and any("نسخ" in n for n in c132.get("notes", [])), "commerce 132: المادة المنسوخة بلا حاشية النسخ")

if fails:
    print(f"\n✗ {len(fails)} فحصاً فشل في مكتبة النصوص")
    sys.exit(1)
print(f"✓ مكتبة النصوص: {len(data)} قانوناً، {total} مادة، تغطية البنك وعينات النص سليمة")
