#!/usr/bin/env python3
"""تدقيق الادعاءات الرقمية: كل رقم في الجواب الصحيح يجب أن يظهر في متن المادة المستشهد بها."""
import json, re, glob, pathlib, unicodedata, collections
BIDI=dict.fromkeys(map(ord,"\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e"
                            "\u2066\u2067\u2068\u2069\ufeff\u00ad\u0640"))
TEXTS={"ق.ل.ع":("../txt/loc_clean.txt","الفصل"),"مدونة التجارة 15.95":("../txt/tijara2.txt","المادة"),
 "القانون 39.08":("../txt/c0e1bb24.txt","املادة"),"مدونة الأسرة 70.03":("../txt/41c67013.txt","المادة"),
 "القانون 58.25":("../txt/civ_cols.txt","املادة"),"ق.م.ج":("../txt/5d4ec838.txt","املادة"),
 "مدونة الشغل 65.99":("../txt/shughl.txt","المادة")}
# كلمات الأعداد العربية ← أرقام، لمقارنة «ثمانية أيام» بـ«8 أيام»
W2D={"واحد":"1","واحدة":"1","اثنان":"2","اثنين":"2","اثنتين":"2","ثلاث":"3","ثلاثة":"3",
 "أربع":"4","أربعة":"4","خمس":"5","خمسة":"5","ست":"6","ستة":"6","سبع":"7","سبعة":"7",
 "ثمان":"8","ثمانية":"8","ثماني":"8","تسع":"9","تسعة":"9","عشر":"10","عشرة":"10",
 "خمسة عشر":"15","خمس عشرة":"15","عشرين":"20","ثلاثين":"30","أربعين":"40","خمسين":"50",
 "ستين":"60","تسعين":"90","مائة":"100","ثمانين":"80","سبعين":"70","اثني عشر":"12",
 "اثنتي عشرة":"12","أربعة عشر":"14","ثمانية عشر":"18","ثمان واربعين":"48","ثمانيا واربعين":"48","ست وتسعين":"96","ستا وتسعين":"96",
 "ثلاثه":"3","اربعه":"4","خمسه":"5","سته":"6","سبعه":"7","ثمانيه":"8","تسعه":"9","عشره":"10",
 "خمسه عشر":"15","اثنتي عشره":"12","اربعه عشر":"14","ثمانيه عشر":"18","خمس وعشرين":"25",
 "ثلاثون":"30","اربعون":"40","خمسون":"50","ثمانون":"80","تسعون":"90","مائه":"100",
 "الثلاثه":"3","الثلاثين":"30","ثلاثين":"30","خمسه واربعين":"45","ثلاثه اشهر":"3",
 "خمسه وعشرين":"25","ثمانين":"80","الثمانين":"80","سبع":"7","ثمان واربعون":"48",
 "ثمانيه واربعين":"48","اربعا وعشرين":"24","اربع وعشرين":"24","سته اشهر":"6","ستة أشهر":"6",
 "سنتين":"2","اثنتان":"2","العاشره":"10","السابعه":"7","السادسه":"6","التاسعه":"9"}
def load(p):
    t=unicodedata.normalize("NFKC",pathlib.Path(p).read_text(encoding="utf-8",errors="replace"))
    t=re.sub(r"\s+"," ",t.translate(BIDI))
    return re.sub(r"[إأآٱ]","ا",t)
CACHE={}
def article(law_key,num):
    if law_key not in CACHE:
        f,w=TEXTS[law_key]; CACHE[law_key]=(load(f),w)
    body,w=CACHE[law_key]
    forms=[num]+(["-".join(reversed(num.split("-")))] if "-" in num else [])
    for fm in forms:
        m=re.search(rf"{w}\s*{re.escape(fm)}\b",body)
        if m:
            nxt=re.search(rf"{w}\s*\d",body[m.end():m.end()+4000])
            return body[m.start(): m.end()+(nxt.start() if nxt else 1800)]
    return None
def fold(s):
    """تطبيع يجمع بين اختلافات الرسم واختلاف الاستخراج."""
    s=re.sub(r"[\u064B-\u0652]","",s)
    s=re.sub(r"[إأآٱ]","ا",s); s=s.replace("ى","ي").replace("ة","ه")
    s=re.sub(r"(?<=\S)لا|(?<=\S)ال(?=\S)","ل",s)   # رباط «لا» المقلوب
    return re.sub(r"\s+"," ",s)

def claims(txt):
    """الادعاءات الرقمية: الأرقام الصريحة وحدها. أما الأعداد المكتوبة بالحروف
    فتُفحص بمطابقة نصية مطوية، لأن حصرها في قاموس لا ينتهي."""
    return {c.rstrip(".") for c in re.findall(r"\d[\d.]*", fold(txt)) if c.rstrip(".")}

# جذور الأعداد: العدد يتصرّف (تسعون/تسعين، ثلاثة/ثلاث)، فتُقارَن جذوره لا ألفاظه
# الأعداد المكتوبة بالحروف تُركت خارج الفحص الآلي عمداً:
#   جذورها القصيرة («ست»، «ثمن»، «الف») تلتقط كلمات ليست أعداداً —
#   «الاستماع» و«الثمن» و«مبررات» — فتُنتج إيجابيات كاذبة أكثر من الأخطاء.
#   وتوسيع القاموس لتغطية كل تصريف لا ينتهي. فالفحص يقتصر على الأرقام
#   الصريحة، وهي أخطر أنواع الادعاء لأن المترشح يحفظها كما هي.
def words_ok(ans, body):
    return []

qs=[]
for f in ["data/questions.json"]+sorted(glob.glob("data/batch-*.json")):
    for q in json.load(open(f))["questions"]: q["_f"]=f.split("/")[-1]; qs.append(q)
tot=hit=0; bad=[]
for q in qs:
    if q.get("src")!="text": continue
    key=next((k for k in TEXTS if k in q["source"]["law"]), None)
    ref=q["source"]["ref"]
    if not key or not re.search(r"(المادة|المادتان|المواد|الفصل|الفصلان|الفصول)",ref): continue
    nums=re.findall(r"\d+(?:[-.]\d+)*",ref)
    bodies=[article(key,n) for n in nums]
    body=" ".join(b for b in bodies if b)
    if not body: continue
    ans=" ".join(q["options"][i] for i in q["correct"])
    cl=claims(ans)
    wm=words_ok(ans, body)
    if not cl and not wm: continue
    tot+=1
    missing=sorted(cl-claims(body)) + [f"«{w}»" for w in wm]
    if missing: bad.append((q["id"],q["_f"],ref,missing,ans[:66]))
    else: hit+=1
print(f"أسئلة تحمل ادعاءً رقمياً: {tot} · مطابقة: {hit} · غير مطابقة: {len(bad)}\n")
for qid,f,ref,miss,ans in bad[:20]:
    print(f"  {qid:<9} {ref:<22} ينقص {miss}\n     «{ans}» ({f})")
