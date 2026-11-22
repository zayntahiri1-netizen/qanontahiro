#!/usr/bin/env python3
"""تدقيق الاستشهادات: كل رقم مادة في سؤال src=text يجب أن يوجد في نصّه."""
import json, re, glob, pathlib, unicodedata, collections
BIDI=dict.fromkeys(map(ord,"\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e"
                            "\u2066\u2067\u2068\u2069\ufeff\u00ad\u0640"))
# لكل نص: ملفه، وصيغة كلمة «المادة/الفصل» كما تظهر في استخراجه
TEXTS = {
 "ق.ل.ع":              ("../txt/loc_clean.txt",  "الفصل"),
 "مدونة التجارة 15.95": ("../txt/tijara2.txt",    "المادة"),
 "القانون 39.08":       ("../txt/c0e1bb24.txt",   "املادة"),
 "مدونة الأسرة 70.03":  ("../txt/41c67013.txt",   "المادة"),
 "القانون 58.25":       ("../txt/civ_cols.txt",   "املادة"),
 "ق.م.ج":              ("../txt/5d4ec838.txt",   "املادة"),
 "مدونة الشغل 65.99":   ("../txt/shughl.txt",     "المادة"),
 # نصوص فُتحت لاحقاً — أُضيفت بعد أن كشف الفاحص أنها «متعذّرة الفحص»
 "مجموعة القانون الجنائي": ("../txt/jinai.txt",    "الفصل"),
 "القانون 38.15":       ("../txt/tanzim.txt",     "املادة"),
 "دستور 2011":          (None,                 "الفصل"),   # يُبنى من الفهرس
}

def _dustour():
    """الدستور مفهرس بصيغة JSON لأن أرقام فصوله مرسومة بخط زخرفي.
    نُركّب منه نصاً بصيغة «الفصل N ...» ليخضع لنفس الفاحص."""
    idx = json.loads(pathlib.Path("../txt/dustour_idx.json").read_text(encoding="utf-8"))
    return " ".join(f"الفصل {k} {v}" for k, v in idx.items())
def load(p):
    t=unicodedata.normalize("NFKC",pathlib.Path(p).read_text(encoding="utf-8",errors="replace"))
    return re.sub(r"\s+"," ",t.translate(BIDI))
CACHE={}
def _dustour():
    """الدستور مفهرس بصيغة JSON لأن أرقام فصوله في خط زخرفي.
    نُركّب منه نصاً بصيغة «الفصل N ...» ليخضع لنفس الفاحص."""
    idx=json.loads(pathlib.Path("../txt/dustour_idx.json").read_text(encoding="utf-8"))
    return " ".join(f"الفصل {k} {v}" for k,v in idx.items())
def has_article(law_key, num):
    if law_key not in CACHE:
        f,w = TEXTS[law_key]
        CACHE[law_key]=(_dustour() if f is None else load(f), w)
    body, w = CACHE[law_key]
    # الاستخراج يعكس أرقام المواد المركّبة (544-1 تظهر «1-544»)، فنجرّب الصيغتين
    forms = [num]
    if "-" in num:
        forms.append("-".join(reversed(num.split("-"))))
    return any(re.search(rf"{w}\s*{re.escape(f)}\b", body) for f in forms)

qs=[]
for f in ["data/questions.json"]+sorted(glob.glob("data/batch-*.json")):
    for q in json.load(open(f))["questions"]:
        q["_f"]=f.split("/")[-1]; qs.append(q)

checked=miss=skip=0
bad=collections.defaultdict(list)
for q in qs:
    if q.get("src")!="text": continue
    law=q["source"]["law"]
    key=next((k for k in TEXTS if k in law), None)
    if not key: skip+=1; continue
    ref=q["source"]["ref"]
    if not re.search(r"(المادة|المادتان|المواد|الفصل|الفصلان|الفصول)", ref):
        skip+=1; continue      # مرجع لا يستشهد بمادة (ظهير، ج.ر، تاريخ)
    nums=[]
    for tok in re.findall(r"\d+(?:-\d+)*", ref):
        parts=tok.split("-")
        # «649-651» مدى لا رقم مركّب؛ «544-1» رقم مركّب. الفيصل: هل الثاني أكبر؟
        if len(parts)==2 and int(parts[1])>int(parts[0]):
            nums.extend(parts)
        else:
            nums.append(tok)
    if not nums: skip+=1; continue
    for n in nums:
        checked+=1
        if not has_article(key,n):
            miss+=1; bad[key].append((q["id"], n, q["_f"]))

print(f"استشهادات فُحصت: {checked} · مفقودة: {miss} · متعذّرة الفحص: {skip}\n")
for k,v in sorted(bad.items(), key=lambda x:-len(x[1])):
    print(f"── {k}: {len(v)} مفقودة")
    for qid,n,f in v[:12]: print(f"     {qid:<9} المادة {n:<6} ({f})")
    if len(v)>12: print(f"     … و{len(v)-12} أخرى")
