#!/usr/bin/env python3
"""اختبارات انحدار دائمة — تُشغَّل على الملف المبني: python3 tests/test_bank.py"""
import re, json, pathlib, sys

D = pathlib.Path(__file__).parent.parent / "dist"
H = D / "qanoun-tahiro.html"
_h = H.read_text(encoding="utf-8")
# البناء المستقل يحقن البنك نصاً داخل JSON.parse
bank = json.loads(json.loads(re.search(r"let BANK = JSON\.parse\((\".*?\")\);", _h, re.S).group(1)))
# والبناء المقسوم يجب أن يحمل البنك نفسه حرفاً بحرف
_split = json.loads((D / "app" / "questions.json").read_text(encoding="utf-8"))
qs = bank["questions"]; q = {x["id"]: x for x in qs}
fails = []
def ok(cond, msg):
    if not cond: fails.append(msg)

ok("/*__BANK__*/" not in _h, "علامة الحقن لم تُستبدل")
ok(_split == bank, "البناء المقسوم لا يطابق المستقل")
_shell = (D / "app" / "index.html").read_text(encoding="utf-8")
ok("let BANK = null;" in _shell, "القشرة تحمل بنكاً محقوناً وهي لا ينبغي أن تحمله")
ok("fetch('./questions.json')" in _shell, "القشرة بلا جالب لبنك الأسئلة")
ok(len({x["id"] for x in qs}) == len(qs), "معرّفات مكررة في الناتج")
ok(all(len(x["options"]) == 4 for x in qs), "سؤال بعدد خيارات مخالف لأربعة")
# لا يُشحن السؤال نفسه مرتين: جذع واحد بالخيارات الأربعة نفسها (ولو بترتيب مختلف) في الفرع نفسه
_seen = {}
for x in qs:
    _k = (x["branch"], x["stem"].strip(), tuple(sorted(o.strip() for o in x["options"])))
    ok(_k not in _seen, f"{x['id']}: نسخة مكررة من {_seen.get(_k)}")
    _seen.setdefault(_k, x["id"])
ok(any(not x["correct"] for x in qs), "مسار «جميع الأجوبة خاطئة» غير مُجرَّب")
for x in qs:
    for i, o in enumerate(x["options"]):
        ok(not ("جميع الأجوبة خاطئة" in o and i in x["correct"] and len(x["correct"]) > 1),
           f"{x['id']}: تناقض في «جميع الأجوبة خاطئة»")

# مراسي تشريعية: تنكسر إن غيّر أحد الجواب الصحيح سهواً
# COM-001 كان [2] (عشرون سنة) حتى 31/08/2026، ثم صُحّح إلى [0] (ثماني عشرة سنة)
# بعد قراءة المادة 15 المعدَّلة بالقانون 54.17 في نص مدونة التجارة. تغيير مقصود.
# FAM-019 مرساة جديدة: المفقود = سنة واحدة (المادة 327)، بعد تصحيح خطأ الأربع سنوات.
for qid, exp in [("COM-001", [0]), ("LAB-018", [0]), ("PEN-009", [0]),
                 ("CIV-001", [0]), ("PRC-001", [1]), ("FAM-001", [1]),
                 ("FAM-019", [0]), ("CIV-013", [0])]:
    ok(qid in q and q[qid]["correct"] == exp, f"{qid}: الجواب الصحيح تغيّر")

# منطق التصحيح المطبق في المحرك
grade = lambda cor, sel: len([i for i in sel if i in cor]) == len(cor) == len(sel)
for cor, sel, want in [([], [], True), ([], [0], False), ([0,2],[0,2],True),
                       ([0,2],[0],False), ([0],[],False), ([0],[1],False)]:
    ok(grade(cor, sel) is want, f"منطق التصحيح: correct={cor} sel={sel}")

# سلامة المخطط: أي قيمة conf خارج v/r تعني تلاعباً أو خطأ أداة
for x in qs:
    ok(x.get("conf") in (None, "v", "r"), f"{x['id']}: قيمة conf غير مقبولة « {x.get('conf')} »")
    ok(x.get("src") in (None, "text", "bo"), f"{x['id']}: قيمة src غير مقبولة « {x.get('src')} »")

# المخطط مغلق: أي حقل زائد يعني إما خطأ كتابة أو ميزة يظنها المؤلف عاملة وهي مُهمَلة
SCHEMA = {"id","branch","difficulty","type","conf","src","stem","options","correct","source","explain"}
for x in qs:
    extra = set(x) - SCHEMA
    ok(not extra, f"{x['id']}: حقول غير معرَّفة {sorted(extra)}")

# شارة المصدر في التطبيق تُشتق من conf و src. الأولوية للتحفّظ:
# سؤال conf=r يجب أن يظهر بشارة «يحتاج تثبيتاً» ولو كان src=text،
# فلا يُخفي علمُ القراءة تحفّظَ المرجع.
for x in qs:
    if x.get("conf") == "r":
        ok(True, "")   # الشارة تفحص conf أولاً في prov()
_shell_src = (D / "app" / "index.html").read_text(encoding="utf-8")
ok("function prov(q)" in _shell_src, "دالة شارة المصدر مفقودة من التطبيق")
ok("q.conf==='r'" in _shell_src.replace(" ", ""), "شارة المصدر لا تفحص conf قبل src")

# لا يُشحن سؤال بلا مموِّه عامل: لو صحّت كل خياراته الحقيقية لم يميّز بين من يعرف ومن لا يعرف
for x in qs:
    real = [i for i, o in enumerate(x["options"]) if "جميع الأجوبة خاطئة" not in o]
    ok(not (real and set(x["correct"]) >= set(real)),
       f"{x['id']}: بلا مموِّه عامل — كل خياراته الحقيقية صحيحة")

# وضع الامتحان يسحب من المُثبَّت فقط، ويجب أن يكفي لكل درجة صعوبة
pool = [x for x in qs if x.get("conf") != "r"]
for d, k in [(1, 3), (2, 4), (3, 7), (4, 4), (5, 2)]:
    n = sum(1 for x in pool if x["difficulty"] == d)
    ok(n >= k, f"وضع الامتحان: صعوبة {d} فيها {n} سؤالاً مُثبَّتاً والمطلوب {k}")
# شاشة النتيجة تعرض التعليل والمرجع، فلا يدخل الامتحان سؤال بلا أحدهما
for x in pool:
    ok(x.get("explain") and x.get("source", {}).get("ref"),
       f"{x['id']}: في نطاق الامتحان بلا تعليل أو مرجع")

# اكتمال الترجمة: كل لغة تحمل نفس المفاتيح ولا مفتاح فارغ
import subprocess, tempfile
_js = re.search(r"<script>(.*?)</script>", _h, re.S).group(1)
_T = re.search(r"const T = (\{.*?\n\};)", _js, re.S)
if _T:
    _probe = "const T = " + _T.group(1)[:-1] + """
const L=Object.keys(T), all=new Set();
L.forEach(l=>Object.keys(T[l]).forEach(k=>all.add(k)));
const bad=[];
L.forEach(l=>{ [...all].forEach(k=>{ if(!(k in T[l])) bad.push(l+':'+k+' مفقود');
  else if(!T[l][k]) bad.push(l+':'+k+' فارغ'); }); });
console.log(bad.join('|'));"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
        fh.write(_probe); _p = fh.name
    _r = subprocess.run(["node", _p], capture_output=True, text=True)
    ok(_r.returncode == 0, "تعذّر فحص كائن الترجمة")
    ok(not _r.stdout.strip(), "اختلال في الترجمة: " + _r.stdout.strip()[:200])
else:
    fails.append("لم يُعثر على كائن الترجمة T")

# ---------- التوليفة السحابية والموقع ----------
_cfg = json.loads((D.parent / "config" / "cloud.json").read_text(encoding="utf-8"))
for _name, _txt in [("المستقل", _h), ("المقسوم", _shell)]:
    ok("/*__CLOUD__*/" not in _txt, f"{_name}: علامة حقن السحابة لم تُستبدل")
    ok(_cfg["supabase"]["url"] in _txt and _cfg["ably"]["key"] in _txt, f"{_name}: إعداد الخدمات السحابية غير محقون")
# لا سر خادم في أي ملف يُشحن: مفتاح Ably الجذر (باسمه)، ومفاتيح Supabase السرية، وحسابات الخدمة
_SECRETS = re.compile(r"sb_secret_|service_role|bjCE2A\.7YUitA|PRIVATE KEY|\"type\"\s*:\s*\"service_account\"|\bsbp_[0-9a-f]{20,}")
for _p in list(D.rglob("*.html")) + list(D.rglob("*.js")) + list(D.rglob("*.json")):
    if _p.stat().st_size < 3_000_000:
        ok(not _SECRETS.search(_p.read_text(encoding="utf-8", errors="ignore")), f"سر خادم في ملف يُشحن: {_p.relative_to(D)}")
_site = D / "site"
for _f in ("index.html", "privacy.html", "admin.html", "404.html", "robots.txt", "sitemap.xml", "app/index.html", "app/questions.json", "app/sw.js"):
    ok((_site / _f).exists(), f"الموقع بلا {_f}")
_sh = (_site / "index.html").read_text(encoding="utf-8")
ok(not re.search(r"__[A-Z]+__", _sh), "علامة حقن متروكة في الموقع")
ok("@gmail.com" not in _sh + (_site / "privacy.html").read_text(encoding="utf-8"), "بريد شخصي منشور في صفحة عامة")
ok("noindex" in (_site / "admin.html").read_text(encoding="utf-8"), "لوحة المؤلف قابلة للفهرسة")
_sd = json.loads(re.search(r"const SITE = (\{.*?\});\n\(\(\)=>", _sh, re.S).group(1))
ok(_sd["n"] == len(qs) and len(_sd["branches"]) == len(bank["branches"]), "أعداد الموقع لا تطابق البنك")
# سؤال اليوم في الموقع هو نفسه في التطبيق: يُحسب بدالة hash نفسها وترتيب VERIFIED نفسه في محرك JS
with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
    fh.write("""const fs=require('fs'); const B=JSON.parse(fs.readFileSync(process.argv[2],'utf8')), W=JSON.parse(process.argv[3]);
const hash=s=>{ let h=0; for(const c of s) h=(h*33+c.charCodeAt(0))>>>0; return h; };
const V=B.questions.filter(q=>q.conf!=='r').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
console.log(Object.entries(W).filter(([d,id])=>V[hash('qt-daily|'+d)%V.length].id!==id).map(([d])=>d).join(','));""")
    _pd = fh.name
_want = {d: v["id"] for d, v in _sd["daily"].items()}
_r = subprocess.run(["node", _pd, str(D / "app" / "questions.json"), json.dumps(_want)], capture_output=True, text=True)
ok(_r.returncode == 0 and not _r.stdout.strip(), "سؤال اليوم في الموقع يخالف التطبيق: " + (_r.stdout.strip() or _r.stderr[:200]))
_mig = (D.parent / "supabase" / "migrations" / "20261118000000_qanoun_tahiro.sql").read_text(encoding="utf-8")
ok(_mig.count("security definer") >= 13 and "enable row level security" in _mig, "الهجرة بلا دوال آمنة أو RLS")
ok(re.search(r"revoke all on public\.qt_profiles", _mig) is not None, "الجداول غير مغلقة أمام العميل")

print("\n".join("✗ " + f for f in fails) if fails else f"✓ {len(qs)} سؤالاً — كل الاختبارات نجحت")
sys.exit(1 if fails else 0)
