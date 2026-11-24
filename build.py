#!/usr/bin/env python3
"""
قانون تاهيرو — البناء والتدقيق

    python3 build.py            بناء + تقرير
    python3 build.py --test     تدقيق فقط، يرجع 1 عند أي خطأ (لـ CI)
    python3 build.py --strict   يستبعد أسئلة conf=r من الناتج

يدمج data/questions.json (الفروع + الدفعة 1) مع كل data/batch-*.json.
"""
import json, pathlib, sys, re, unicodedata, collections, itertools

# خيار يبدأ بأداة ربط أو وصل: علامة على جواب واحد مُقسَّم على خيارين
SPLIT = re.compile(r"^(بعد |مع |لأن|بشرط|ولو |التي |الذي |بينما |على أساس|إلى أن|في حدود|ومستقل|بمسؤولي|حتى )")

ROOT = pathlib.Path(__file__).parent
BASE = ROOT / "data" / "questions.json"
TPL  = ROOT / "src" / "app.html"
OUT  = ROOT / "dist" / "qanoun-tahiro.html"
RQ   = ROOT / "dist" / "review-queue.md"
APP  = ROOT / "dist" / "app"
LAWS = ROOT / "data" / "laws.json"
CLOUDCFG = ROOT / "config" / "cloud.json"
SITE = ROOT / "dist" / "site"
# ما لا يجوز أن يصل إلى أي ملف يُشحن للعميل: أسرار الخوادم. مفتاح Ably الجذر يُعرف باسمه (لا بسره).
SECRET_MARKERS = [r"sb_secret_", r"service_role", r"bjCE2A\.7YUitA", r"-----BEGIN [A-Z ]*PRIVATE KEY",
                  r"\"type\"\s*:\s*\"service_account\"", r"\bsbp_[0-9a-f]{20,}", r"\bAQ\.[A-Za-z0-9_-]{30,}",
                  r"\btvly-[A-Za-z0-9_-]{20,}"]

# الحصة المستهدفة لكل فرع من أصل 10.000
TARGET = {
    "obligations": 1000, "criminal": 1000, "labour": 1000, "family": 1000,
    "commercial": 850, "real_estate": 850, "administrative": 850,
    "civil_proc": 850, "criminal_proc": 850,
    "constitutional": 600, "companies": 600, "judicial_org": 550,
    "local_gov": 450,
}
# نسب الصعوبة المستهدفة: (1-2), (3), (4-5)
DIFF_MIX = (0.25, 0.45, 0.30)
TOL = 0.12       # هامش التسامح في نسب الصعوبة
# نسبة الأسئلة التطبيقية (نازلة + مسألة): امتحانات المباريات تقيس التطبيق
# لا الحفظ، فبنكٌ كله أسئلة معرفة يدرّب على نصف المطلوب.
APPLY_MIN = 0.30
APPLY_TOL = 0.05
MIX_MIN_N = 500  # لا معنى لقياس مزيج الصعوبة قبل هذا الحجم
# شكل الجواب: (جواب واحد، أكثر من جواب، لا شيء صحيح) — مستوحى من نماذج المباريات الفعلية
ANS_MIX = (0.60, 0.36, 0.04)
ANS_TOL = 0.10
ANS_MIN_N = 100

STRICT = "--strict" in sys.argv
TEST   = "--test" in sys.argv

errors, warns = [], []
E = errors.append
W = warns.append

_dia = re.compile(r"[\u064B-\u0652\u0640]")
def norm(s):
    s = unicodedata.normalize("NFKC", s)
    s = _dia.sub("", s)
    s = re.sub(r"[إأآا]", "ا", s).replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"[^\w\s]", " ", s).split()


def load():
    base = json.loads(BASE.read_text(encoding="utf-8"))
    qs = list(base["questions"])
    for q in qs:
        q.setdefault("_src", "questions.json")
    batches = sorted((ROOT / "data").glob("batch-*.json"))
    for f in batches:
        b = json.loads(f.read_text(encoding="utf-8"))
        for q in b["questions"]:
            q["_src"] = f.name
        qs.extend(b["questions"])
    base["questions"] = qs
    return base, [f.name for f in batches]


def validate(bank):
    ids = {b["id"] for b in bank["branches"]}
    seen, stems = set(), []
    for q in bank["questions"]:
        qid = q.get("id", "?")
        if qid in seen:
            E(f"{qid}: معرّف مكرر")
        seen.add(qid)
        if q.get("branch") not in ids:
            E(f"{qid}: فرع غير معروف « {q.get('branch')} »")
        opts = q.get("options", [])
        if len(opts) != 4:
            E(f"{qid}: عدد الخيارات {len(opts)} بدل 4")
        if len(set(opts)) != len(opts):
            E(f"{qid}: خياران متطابقان")
        cor = q.get("correct", [])
        if len(set(cor)) != len(cor):
            E(f"{qid}: مؤشرات صحيحة مكررة")
        for i in cor:
            if not 0 <= i < len(opts):
                E(f"{qid}: مؤشر خارج المجال ({i})")
        if not 1 <= q.get("difficulty", 0) <= 5:
            E(f"{qid}: صعوبة خارج 1-5")
        if q.get("type") not in ("knowledge", "case", "problem"):
            E(f"{qid}: نوع غير معروف « {q.get('type')} »")
        # حقل غير معرَّف في المخطط: يمرّ صامتاً ويوهم بأن له أثراً وهو مُهمَل
        extra = set(q) - {"id","branch","difficulty","type","conf","src","stem",
                          "options","correct","source","explain","_src"}
        if extra:
            W(f"{qid}: حقول غير معرَّفة في المخطط: {', '.join(sorted(extra))}")
        # تناقض: قُرئ في نص رسمي ومع ذلك مرجعه «يحتاج تثبيتاً».
        # يقع حين أُرقّي src وأنسى رفع conf — فيبقى السؤال معلّقاً بلا سبب.
        if q.get("conf") == "r" and q.get("src") in ("text", "bo"):
            W(f"{qid}: conf=r مع src={q['src']} — تحقق: هل التحفّظ ما زال قائماً؟")
        if q.get("src") not in (None, "text", "bo"):
            E(f"{qid}: قيمة src غير مقبولة")
        if q.get("conf") is None:
            W(f"{qid}: بلا علم ثقة")
        if q.get("conf") not in (None, "v", "r"):
            E(f"{qid}: قيمة conf غير مقبولة")
        # فخ شائع: «جميع الأجوبة خاطئة» مُدرج ضمن الصحيح مع خيار آخر
        for i, o in enumerate(opts):
            if "جميع الأجوبة خاطئة" in o and i in cor and len(cor) > 1:
                E(f"{qid}: «جميع الأجوبة خاطئة» صحيح مع خيار آخر — تناقض منطقي")
        # سؤال بلا مموِّه عامل: كل الخيارات الحقيقية صحيحة، فلا يميّز بين من يعرف ومن لا يعرف
        real = [i for i, o in enumerate(opts) if "جميع الأجوبة خاطئة" not in o]
        if real and set(cor) >= set(real):
            W(f"{qid}: بلا مموِّه عامل — كل الخيارات الحقيقية صحيحة")
        for i in cor:
            if i > 0 and (i - 1) in cor and SPLIT.match(opts[i].strip()):
                W(f"{qid}: الخيار {i+1} يبدو امتداداً لسابقه — جواب واحد مُقسَّم على خيارين")
                break
        if not q.get("explain"):
            W(f"{qid}: بلا تعليل")
        if not q.get("source", {}).get("ref"):
            W(f"{qid}: بلا مرجع")
        toks = norm(q.get("stem", ""))
        if len(toks) < 8:            # صيغة قصيرة: الخيارات هي ما يميّزها
            toks += [w for o in opts for w in norm(o)]
        stems.append((qid, set(toks)))

    # تشابه نصّي بين الأسئلة داخل نفس الفرع
    by_branch = collections.defaultdict(list)
    idx = {q["id"]: q for q in bank["questions"]}
    for qid, toks in stems:
        by_branch[idx[qid]["branch"]].append((qid, toks))
    for br, lst in by_branch.items():
        for (a, ta), (b, tb) in itertools.combinations(lst, 2):
            if not ta or not tb:
                continue
            j = len(ta & tb) / len(ta | tb)
            if j > 0.72:
                W(f"{a} ≈ {b}: تشابه {j:.0%} — تحقق من الازدواج")


def check_laws(bank):
    """يقارن النصوص التي بين يديّ بالتعديلات المعلومة، ويُنذر على النص الذي فاته تعديل."""
    if not LAWS.exists():
        W("data/laws.json مفقود — لا رقابة على تقادم النصوص")
        return
    reg = json.loads(LAWS.read_text(encoding="utf-8"))["laws"]
    stale, blind = [], []
    for name, L in reg.items():
        held = L.get("held")
        cons = held.get("consolidated") if held else None
        later = [a for a in L.get("amendments", []) if cons and a["date"] > cons]
        if later:
            stale.append((name, cons, later))
        elif not held:
            blind.append(name)

    if stale:
        print("\n⚠ نصوص بين يديّ فاتها تعديل — لا يُعتمد عليها في المواد المعنية:")
        for name, cons, later in stale:
            for a in later:
                print(f"  {name}: نسختي موطّدة {cons} · القانون {a['law']} "
                      f"({a['date']}، ج.ر {a['bo']}) — {a['scope']}")
                W(f"{name}: نسخة {cons} أقدم من القانون {a['law']} ({a['scope']})")
    # سؤال في الطابور والقانونُ الذي يستشهد به بين يديّ: قابل للحسم الآن.
    # المطابقة على القانون لا على الفرع — فالفرع الواحد تحكمه نصوص عدة،
    # وقد أملك أحدها ولا أملك الآخر. ويُستثنى ما كان نصّه متقادماً للمادة المعنية.
    held_names = {name for name, L in reg.items() if L.get("held")}
    stale_names = {name for name, _c, _l in stale}

    def resolvable(q):
        law = q.get("source", {}).get("law", "")
        for name in held_names:
            if name in stale_names:
                continue
            key = re.search(r"\d+\.\d+", name)
            if (key and key.group(0) in law) or (not key and name in law):
                return True
        return False

    ready = [q for q in bank["questions"] if q.get("conf") == "r" and resolvable(q)]
    if ready:
        by_br = {}
        for q in ready:
            by_br.setdefault(q["branch"], []).append(q["id"])
        names = {b["id"]: b["ar"] for b in bank["branches"]}
        print(f"\n⚑ {len(ready)} سؤالاً في الطابور يستشهد بنصٍّ بين يديّ — قابل للحسم الآن:")
        for br, ids in sorted(by_br.items(), key=lambda x: -len(x[1])):
            print(f"  {names[br]}: {len(ids)} — {' · '.join(ids[:6])}"
                  + (" …" if len(ids) > 6 else ""))

    # الفروع التي أملك نصوصها مرتّبة بالتغطية: أضعفها أولى بالتنقيب.
    # التغطية أهم من العدد — فرعٌ كبير ضعيف التحقق أخطر من فرع صغير موثَّق.
    held_br = {br for L in reg.values() if L.get("held") for br in L.get("branches", [])}
    weak = []
    for b in bank["branches"]:
        if b["id"] not in held_br:
            continue
        s = [q for q in bank["questions"] if q["branch"] == b["id"]]
        if not s:
            continue
        v = sum(1 for q in s if q.get("src") in ("text", "bo"))
        weak.append((v / len(s), b["ar"], len(s), v))
    weak.sort()
    # قد يظهر الفرع مرتين إذا كان له أكثر من نص في السجل: نُبقي أدنى تغطية
    seen, uniq = set(), []
    for row in weak:
        if row[1] in seen:
            continue
        seen.add(row[1]); uniq.append(row)
    weak = uniq
    if weak and weak[0][0] < 0.90:
        line = " · ".join(f"{n} ({v}/{c} = {p:.0%})" for p, n, c, v in weak[:3])
        print(f"\n⚑ أضعف الفروع تحققاً ممّا أملك نصّه: {line}")

    if blind:
        # الترتيب بأثر كل نص على البنك: عدد الأسئلة التي تستشهد به
        import collections as _c
        weight = _c.Counter()
        for q in bank["questions"]:
            law = q.get("source", {}).get("law", "")
            for name in blind:
                if name in law or (re.search(r"\d+\.\d+", name)
                                   and re.search(r"\d+\.\d+", name).group(0) in law):
                    weight[name] += 1
                    break
        top = weight.most_common(6)
        rest = len(blind) - len(top)
        line = " · ".join(f"{n} ({c} سؤالاً)" for n, c in top if c)
        print(f"\nقوانين بلا نص بين يديّ: {len(blind)} — الأثقل أثراً على البنك:")
        print(f"  {line}")
        if rest > 0:
            print(f"  و{rest} نصاً آخر أخفّ أثراً (التفصيل في data/laws.json)")

    # سؤال يستشهد بقانون خارج السجل كلياً.
    # الاستشهاد قد يكون مركّباً («مدونة التجارة، القانون 73.17») أو موصوفاً
    # («القانون 39.08، المادة 4 كما غُيّرت بالقانون 41.24»)، فنطابق على الأرقام
    # وعلى أسماء النصوص غير المرقّمة معاً.
    nums = {n for k in reg for n in re.findall(r"\d+\.\d+", k)}
    names = {k for k in reg if not re.search(r"\d+\.\d+", k)}
    for q in bank["questions"]:
        law = q.get("source", {}).get("law", "")
        if not law:
            continue
        found = set(re.findall(r"\d+\.\d+", law))
        if found & nums:
            continue
        if any(n in law for n in names):
            continue
        W(f"{q['id']}: يستشهد بـ « {law} » وهو خارج data/laws.json")


def report(bank, batches):
    qs = bank["questions"]
    per = collections.Counter(q["branch"] for q in qs)
    rev = [q for q in qs if q.get("conf") == "r"]

    # سرد الدفعات كاملةً صار يملأ الشاشة بلا فائدة بعد الأربعين.
    # العدد والأحدث يكفيان، والجرد الكامل في مجلد data/.
    if len(batches) > 6:
        print(f"الدفعات المدمجة: questions.json + {len(batches)} دفعة "
              f"(الأحدث: {', '.join(batches[-3:])})\n")
    else:
        print(f"الدفعات المدمجة: questions.json + {', '.join(batches) or '—'}\n")
    print(f"{'الفرع':<22}{'الآن':>6}{'الهدف':>8}{'التغطية':>10}{'سهل':>6}{'متوسط':>7}{'صعب':>6}")
    print("─" * 65)
    for b in bank["branches"]:
        bid = b["id"]
        sub = [q for q in qs if q["branch"] == bid]
        n = len(sub)
        d = collections.Counter("سهل" if q["difficulty"] <= 2 else ("متوسط" if q["difficulty"] == 3 else "صعب") for q in sub)
        tgt = TARGET.get(bid, 0)
        print(f"{b['ar']:<22}{n:>6}{tgt:>8}{n/tgt:>9.1%}{d['سهل']:>6}{d['متوسط']:>7}{d['صعب']:>6}")
    total, goal = len(qs), sum(TARGET.values())
    print("─" * 65)
    print(f"{'المجموع':<22}{total:>6}{goal:>8}{total/goal:>9.1%}")

    # مزيج الصعوبة الإجمالي
    easy = sum(1 for q in qs if q["difficulty"] <= 2) / total
    mid  = sum(1 for q in qs if q["difficulty"] == 3) / total
    hard = sum(1 for q in qs if q["difficulty"] >= 4) / total
    print(f"\nمزيج الصعوبة: سهل {easy:.0%} · متوسط {mid:.0%} · صعب {hard:.0%}"
          f"   (المستهدف {DIFF_MIX[0]:.0%}/{DIFF_MIX[1]:.0%}/{DIFF_MIX[2]:.0%})")
    # كم سؤالاً في كل فئة يلزم لبلوغ المستهدف؟ رقم عملي بدل إنذار مجرد
    need = []
    for name, p, got in (("سهل", DIFF_MIX[0], easy), ("متوسط", DIFF_MIX[1], mid), ("صعب", DIFF_MIX[2], hard)):
        n = round((p * total - got * total) / (1 - p))   # كم يلزم إضافته من هذه الفئة وحدها
        if n > 0:
            need.append(f"{name}: +{n}")
    if need:
        # الرقم المطلق وحده يُضخّم فجوة صغيرة: «+12» على بنك من 1119 سؤالاً
        # فارقٌ عُشري لا أكثر. نعرض معه الفارق النسبي ليُقرأ في سياقه.
        devs = {"سهل": easy - DIFF_MIX[0], "متوسط": mid - DIFF_MIX[1], "صعب": hard - DIFF_MIX[2]}
        detail = " · ".join(f"{n} ({devs[n.split(':')[0]]:+.1%})" if n.split(":")[0] in devs else n
                            for n in need)
        print("  لبلوغ المستهدف بالإضافة وحدها → " + detail)
        # الوصفة رقم مطلق لا يقول متى ننتهي. نقدّر عدد الدفعات الباقية
        # بمعدل ما أنتجته الدفعات الثلاث الأخيرة فعلياً، لا بما نويتُه.
        # التقدير الزمني لا معنى له إذا كان البند داخل هامش التسامح:
        # «27 دفعة» لسدّ فجوة 0.3٪ رقمٌ صحيح حسابياً ومضلِّل عملياً.
        if abs(mid - DIFF_MIX[1]) <= TOL and abs(easy - DIFF_MIX[0]) <= TOL:
            srcs = []
        else:
            srcs = list(dict.fromkeys(q.get("_src", "") for q in qs))[-3:]
        recent = [q for q in qs if q.get("_src", "") in srcs]
        if recent:
            sz = max(1, round(len(recent) / len(srcs)))
            rate = sum(1 for q in recent if q["difficulty"] == 3) / len(recent)
            if rate > DIFF_MIX[1]:
                m, n2, k = sum(1 for q in qs if q["difficulty"] == 3), total, 0
                while m / n2 < DIFF_MIX[1] and k < 500:
                    m += round(sz * rate); n2 += sz; k += 1
                print(f"  بمعدل الدفعات الثلاث الأخيرة ({rate:.0%} متوسط، {sz} سؤالاً للدفعة) "
                      f"→ نحو {k} دفعة، يبلغ البنك عندها {n2} سؤالاً")
            elif mid < DIFF_MIX[1] - TOL:
                # الإنذار يصحّ فقط إذا كان البند خارج الهدف أصلاً؛ فمعدلٌ منخفض
                # مع نسبة بالغة هدفها ليس خطراً بل حفاظاً على التوازن.
                print(f"  ⚠ معدل الدفعات الثلاث الأخيرة ({rate:.0%} متوسط) دون المستهدف "
                      f"({DIFF_MIX[1]:.0%}) — لن يُبلغ الهدف مهما أُضيف")

    if total < MIX_MIN_N:
        print(f"  (الإنذار على المزيج معطّل دون {MIX_MIN_N} سؤالاً — العيّنة الحالية ضجيج)")
    else:
        for name, got, want in (("سهل", easy, DIFF_MIX[0]), ("متوسط", mid, DIFF_MIX[1]), ("صعب", hard, DIFF_MIX[2])):
            if abs(got - want) > TOL:
                W(f"مزيج الصعوبة: نسبة «{name}» {got:.0%} بعيدة عن المستهدف {want:.0%}")

    multi = sum(1 for q in qs if len(q["correct"]) > 1)
    none_ = sum(1 for q in qs if not q["correct"])
    one   = total - multi - none_
    print(f"\nشكل الجواب: واحد {one/total:.0%} · متعدد {multi/total:.0%} · لا شيء {none_/total:.0%}"
          f"   (المستهدف {ANS_MIX[0]:.0%}/{ANS_MIX[1]:.0%}/{ANS_MIX[2]:.0%})")
    if none_ == 0:
        W("لا يوجد أي سؤال بـ correct=[] — مسار «جميع الأجوبة خاطئة» غير مُجرَّب في البنك")
    if total >= ANS_MIN_N:
        for name, got, want in (("واحد", one/total, ANS_MIX[0]), ("متعدد", multi/total, ANS_MIX[1]),
                                ("لا شيء", none_/total, ANS_MIX[2])):
            if abs(got - want) > ANS_TOL:
                W(f"شكل الجواب: نسبة «{name}» {got:.0%} بعيدة عن المستهدف {want:.0%}")
    txt = [q for q in qs if q.get("src") in ("text", "bo")]
    n_t = sum(1 for q in qs if q.get("src") == "text")
    n_b = sum(1 for q in qs if q.get("src") == "bo")
    print(f"\nمُتحقَّق منه: {len(txt)} ({len(txt)/total:.0%}) — نصٌّ بين يديّ {n_t} · فهرست الجريدة الرسمية {n_b}"
          f" · مكتوب من الذاكرة {total-len(txt)} ({1-len(txt)/total:.0%})")
    print(f"{'الفرع':<22}{'الكل':>6}{'من النص':>9}{'التغطية':>10}")
    print("─" * 47)
    for b in bank["branches"]:
        sub = [q for q in qs if q["branch"] == b["id"]]
        v = sum(1 for q in sub if q.get("src") in ("text", "bo"))
        if sub:
            print(f"{b['ar']:<22}{len(sub):>6}{v:>9}{v/len(sub):>9.0%}")
    print()
    ty = collections.Counter(q["type"] for q in qs)
    apply_r = (ty["case"] + ty["problem"]) / total
    print(f"النوع: سؤال {ty['knowledge']/total:.0%} · نازلة {ty['case']/total:.0%} "
          f"· مسألة {ty['problem']/total:.0%}   (تطبيقي {apply_r:.0%}، المستهدف {APPLY_MIN:.0%})")
    if apply_r < APPLY_MIN - APPLY_TOL:
        need_apply = round((APPLY_MIN * total - (ty["case"] + ty["problem"])) / (1 - APPLY_MIN))
        W(f"الأسئلة التطبيقية {apply_r:.0%} دون المستهدف {APPLY_MIN:.0%}")
        print(f"  لبلوغ المستهدف بالإضافة وحدها → تطبيقي: +{need_apply}")
        # الفجوة هنا ليست انحرافاً طارئاً بل نمط تأليف: بنكٌ يستهدف 10.000 سؤال
        # يلزمه 3.000 تطبيقي. فالعلاج حصة ثابتة في كل دفعة لا حملة منفصلة.
        # الحصة التعويضية البسيطة لا تكفي: كل دفعة ترفع المقام فتأكل جزءاً من أثرها.
        # نعرض بدلها الأفق عند حصص مختلفة، ليكون الاختيار على بيّنة.
        srcs = list(dict.fromkeys(q.get("_src", "") for q in qs))
        sz = max(1, round(len(qs) / max(1, len(srcs))))
        print("  → الأفق بحسب الحصة المختارة في كل دفعة قادمة:")
        for share in (0.40, 0.50, 0.60, 0.75):
            a, n2, k = ty["case"] + ty["problem"], total, 0
            while a / n2 < APPLY_MIN and k < 400:
                a += round(sz * share); n2 += sz; k += 1
            tag = "" if k < 400 else " (لا يبلغ)"
            print(f"       {share:.0%} → {k} دفعة، البنك عندها {n2}{tag}")
    doc = sum(1 for q in qs if q.get("conf") == "d")
    print(f"الثقة: مُثبَّت {sum(1 for q in qs if q.get('conf') == 'v')} · مرجع عام {doc} · يحتاج تدقيق رقم {len(rev)}")

    print(f"\n{'الدفعة':<20}{'العدد':>7}{'واحد':>8}{'نازلة':>8}{'سهل':>7}{'متوسط':>8}")
    print("─" * 60)
    for src in dict.fromkeys(q["_src"] for q in qs):
        s = [q for q in qs if q["_src"] == src]; n = len(s)
        o = sum(1 for q in s if len(q["correct"]) == 1)
        m = sum(1 for q in s if len(q["correct"]) > 1)
        z = sum(1 for q in s if not q["correct"])
        c = sum(1 for q in s if q["type"] in ("case", "problem"))
        dev  = o/n - ANS_MIX[0]
        e  = sum(1 for q in s if q["difficulty"] <= 2)
        md = sum(1 for q in s if q["difficulty"] == 3)
        # شكل الجواب بلغ هدفه، فالعمود المفيد الآن هو الصعوبة:
        # هل تسحب الدفعة البنكَ نحو هدفه في أي بند؟
        flag = "" if (e/n > DIFF_MIX[0] or md/n > DIFF_MIX[1]) else "  ← لا تصحّح المزيج"
        print(f"{src:<20}{n:>7}{o/n:>8.0%}{c/n:>8.0%}{e/n:>7.0%}{md/n:>8.0%}{flag}")
    return rev


def write_review(rev):
    if not rev:
        RQ.write_text("# طابور المراجعة\n\nلا شيء. كل الأسئلة مُثبَّتة.\n", encoding="utf-8")
        return
    lines = ["# طابور المراجعة",
             "",
             "أسئلة مضمونها سليم لكن رقم المادة أو الرقم الوارد فيها يحتاج تثبيتاً",
             "في النص الرسمي قبل النشر. ضع `\"conf\": \"v\"` بعد التحقق.",
             ""]
    for q in sorted(rev, key=lambda x: x["id"]):
        s = q.get("source", {})
        lines.append(f"- [ ] **{q['id']}** — {s.get('law','?')} · {s.get('ref','?')}  \n      {q['stem']}")
    RQ.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# سجل النصوص للتطبيق: يُحقن ما يلزم لعرض «المستجدات التشريعية» و«صيغة النص المرجعي».
# لا يُشحن إلا تعديل له رقم عدد في الجريدة الرسمية وتاريخ، وخالٍ من علامات التحفظ؛
# وتُحذف من الوصف الملاحظات الداخلية (من قرأ ماذا، وأين) لأنها لا تعني المستخدم.
UNSURE = re.compile(r"مدقق|لم يُقرأ|لم يقرأ|لم يُتحقق|لم يتحقق|لم يتأكد|لم يُنشر|مشروع|على الأقل")
INNOTE = re.compile(r"\s*\((?:[^()]*?(?:بين يديّ|بين يدي|رفعها|فُحصت|فحصت|adala|مدقق|يُتحقق|يتحقق|منقول|قُرئ|قرئ)[^()]*)\)")

def laws_payload(bank):
    if not LAWS.exists():
        return [], {}
    reg = json.loads(LAWS.read_text(encoding="utf-8"))["laws"]
    keys = list(reg)
    laws = []
    for k in keys:
        L = reg[k]
        num = re.search(r"\d+(?:\.\d+)+", k)
        ar = L.get("ar") or k
        name = k if ar.startswith("مرجع") else ar     # «مرجع عام…» وصف لا اسم
        if num and num.group(0) not in name:
            name = f"{name} ({num.group(0)})"
        am = []
        for a in L.get("amendments", []):
            scope = a.get("scope") or ""
            if not a.get("date") or not a.get("bo") or UNSURE.search(scope + " " + (a.get("note") or "")):
                continue
            am.append({"l": a["law"], "d": a["date"], "bo": str(a["bo"]),
                       "s": INNOTE.sub("", scope).strip(" —،")})
        held = L.get("held") or {}
        laws.append({"n": name, "c": held.get("consolidated"), "a": am})
    # مصدر كل سؤال ← النص الأصلي في السجل لا القانون المعدِّل له، ولا المرجع العام الذي يحيل عليه.
    # الترتيب: رقم نص أصلي، ثم اسم نص أصلي (الأطول أولاً)، ثم رقم قانون معدِّل احتياطاً.
    amending = {i for i, k in enumerate(keys) if re.match(r"(تغيير|نسخ وتعويض)", reg[k].get("ar") or "")}
    by_num, by_num_am = {}, {}
    for i, k in enumerate(keys):
        m = re.search(r"\d+(?:\.\d+)+", k)
        if m:
            (by_num_am if i in amending else by_num).setdefault(m.group(0), i)
    names = []
    for i, k in enumerate(keys):
        if i in amending or re.search(r"\d+(?:\.\d+)+", k):
            continue
        names.append((k, i))
        ar = reg[k].get("ar") or ""
        if len(ar) >= 8 and not ar.startswith("مرجع"):
            names.append((ar, i))
    names.sort(key=lambda x: -len(x[0]))
    # «مرجع عام يحيل على …» يُوجَّه إلى النص المحال عليه
    redirect = {}
    for i, k in enumerate(keys):
        ar = reg[k].get("ar") or ""
        if ar.startswith("مرجع عام يحيل على"):
            tgt = ar[len("مرجع عام يحيل على"):]
            m = re.search(r"\d+(?:\.\d+)+", tgt)
            j = by_num.get(m.group(0)) if m else next((n for s, n in names if n != i and s in tgt), None)
            if j is not None:
                redirect[i] = j
    # أسماء بديلة يكتب بها المؤلفون بعض النصوص في حقل المصدر
    ALIAS = {"م.م.ج": "ق.م.ج", "مسطرة جنائية": "ق.م.ج", "1.58.008": "ظهير 24 فبراير 1958"}
    alias = [(a, keys.index(k)) for a, k in ALIAS.items() if k in reg]
    lawof = {}
    for q in bank["questions"]:
        law = q["source"]["law"]
        if law in lawof:
            continue
        idx = next((by_num[m.group(0)] for m in re.finditer(r"\d+(?:\.\d+)+", law) if m.group(0) in by_num), None)
        if idx is None:
            idx = next((i for s, i in names if s in law), None)
        if idx is None:
            idx = next((i for a, i in alias if a in law), None)
        if idx is None:
            idx = next((by_num_am[m.group(0)] for m in re.finditer(r"\d+(?:\.\d+)+", law) if m.group(0) in by_num_am), None)
        if idx is not None:
            lawof[law] = redirect.get(idx, idx)
    return laws, lawof


# ---------------------------------------------------------------------------
# تطبيق ويب قابل للتثبيت يعمل دون اتصال (للبناء المقسوم المنشور على الويب)
def star_points(c, R, r, n=8, rot=0.0):
    import math
    return [(c + (R if i % 2 == 0 else r) * math.cos(rot + i * math.pi / n),
             c + (R if i % 2 == 0 else r) * math.sin(rot + i * math.pi / n)) for i in range(2 * n)]

FONTS_DIR = ROOT / "resources" / "fonts"
FONT_FACES = (("Noto Naskh Arabic", "qt-naskh.woff"), ("El Messiri", "qt-messiri.woff"))


def fonts_html(prefix="fonts/", inline=False):
    """خطا التطبيق مضمَّنين (tools/make-fonts.py): روابط تحميل مسبق وقواعد @font-face، أو الخط نفسه داخل الصفحة (inline)
    للنسخة ذات الملف الواحد. لا اتصال بـ Google Fonts، فيظهر الخط نفسه على كل جهاز ودون اتصال."""
    import base64
    faces, pre = [], []
    for fam, name in FONT_FACES:
        f = FONTS_DIR / name
        if not f.exists():
            continue
        url = ("data:font/woff;base64," + base64.b64encode(f.read_bytes()).decode()) if inline else prefix + name
        faces.append(f'@font-face{{font-family:"{fam}";src:url({url}) format("woff");font-weight:400 700;font-style:normal;font-display:swap}}')
        if not inline:
            pre.append(f'<link rel="preload" href="{prefix}{name}" as="font" type="font/woff" crossorigin>')
    return "".join(pre) + (f"<style>{''.join(faces)}</style>" if faces else "")


def write_fonts():
    import shutil
    (APP / "fonts").mkdir(parents=True, exist_ok=True)
    for f in FONTS_DIR.glob("*"):
        if f.suffix in (".woff", ".txt"):
            shutil.copyfile(f, APP / "fonts" / f.name)


def write_pwa(version):
    """ملفات التثبيت: الأيقونات من resources/pwa (تولّدها tools/make-pwa-icons.py من شارة التطبيق، وتُلتزم في المستودع
    فلا يحتاج البناء إلى مكتبة صور)، والبيان، وعامل الخدمة."""
    import shutil
    src = ROOT / "resources" / "pwa"
    icons = []
    for name, sizes, typ, purpose in (("icon.svg", "any", "image/svg+xml", "any"), ("icon-192.png", "192x192", "image/png", "any"),
                                      ("icon-512.png", "512x512", "image/png", "any"),
                                      ("icon-maskable-512.png", "512x512", "image/png", "maskable")):
        if (src / name).exists():
            shutil.copyfile(src / name, APP / name)
            icons.append({"src": name, "sizes": sizes, "type": typ, "purpose": purpose})
    for extra in ("icon-180.png", "icon-32.png"):
        if (src / extra).exists():
            shutil.copyfile(src / extra, APP / extra)
    manifest = {"name": "قانون تاهيرو", "short_name": "تاهيرو", "description": "بنك أسئلة القانون المغربي",
                "lang": "ar", "dir": "rtl", "start_url": "./", "scope": "./", "display": "standalone",
                "background_color": "#12181F", "theme_color": "#12181F", "icons": icons}
    (APP / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    core = ["./", "./index.html", "./questions.json", "./manifest.webmanifest", "./icon.svg"] + \
           [f"./fonts/{n}" for _, n in FONT_FACES if (APP / "fonts" / n).exists()] + \
           (["./lib/index.json"] if (APP / "lib" / "index.json").exists() else []) + \
           [f"./{i['src']}" for i in icons if i["src"] == "icon-192.png"]     # الأيقونات الكبيرة يجلبها المتصفح عند التثبيت وحده
    (APP / "sw.js").write_text(f"""// قانون تاهيرو — عامل الخدمة: يُخزّن القشرة والبنك فيعمل التطبيق دون اتصال.
// الإصدار يتغير مع كل بناء، فيُجلب البنك الجديد مرة واحدة ثم يُقرأ من الذاكرة.
const V = 'qt-{version}';
const CORE = {json.dumps(core)};
self.addEventListener('install', e => {{
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
}});
self.addEventListener('activate', e => {{
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
}});
self.addEventListener('fetch', e => {{
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const keep = res => {{ if (res && (res.ok || res.type === 'opaque')) {{ const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }} return res; }};
  if (u.origin === location.origin) {{
    e.respondWith(caches.match(r, {{ ignoreSearch: true }})
      .then(m => m || fetch(r).then(keep).catch(() => caches.match('./index.html'))));
  }} else if (/fonts\\.(googleapis|gstatic)\\.com$/.test(u.hostname) || CDN.test(u.hostname)
             || (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'))) {{
    // الخطوط وحزم الخدمات السحابية: من الذاكرة أولاً، فيقلع التطبيق بسرعة ولا يتوقف إن انقطع المزود
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(keep)));
  }}
}});
const CDN = /^(cdn\\.jsdelivr\\.net|unpkg\\.com|cdn\\.ably\\.com)$/;
""", encoding="utf-8")
    return len(icons)


CORPUS = ROOT / "data" / "corpus"

def lib_payload():
    """مكتبة النصوص القانونية للتطبيق (v8): فهرس صغير وملف لكل قانون بصيغة مضغوطة
    (المادة مصفوفة [الرقم، العنوان، رقم المسار، النص، الحواشي]، والمسارات في جدول واحد لكل قانون)."""
    import hashlib
    if not (CORPUS / "index.json").exists():
        return {}, "nolib"
    ix = json.loads((CORPUS / "index.json").read_text(encoding="utf-8"))
    files, laws, h = {}, [], hashlib.sha1()
    for L in ix["laws"]:
        d = json.loads((CORPUS / f"{L['slug']}.json").read_text(encoding="utf-8"))
        paths, pidx, items = [], {}, []
        for it in d["items"]:
            p = it.get("path") or ""
            if p not in pidx:
                pidx[p] = len(paths)
                paths.append(p)
            row = [str(it["n"]), it.get("label") or str(it["n"]), pidx[p], it.get("text") or ""]
            notes = [x for x in (it.get("notes") or []) if x]
            if notes:
                row.append(notes)
            items.append(row)
        body = json.dumps({"slug": L["slug"], "title": L["title"], "word": L.get("word") or "المادة", "paths": paths, "items": items},
                          ensure_ascii=False, separators=(",", ":"))
        files[L["slug"] + ".json"] = body
        h.update(body.encode("utf-8"))
        laws.append({"slug": L["slug"], "title": L["title"], "short": L.get("key") or L["title"], "word": L.get("word") or "المادة",
                     "n": len(items), "branch": L.get("branch"), "consolidated": L.get("consolidated"), "stale": L.get("stale") or [],
                     "bank": L.get("bank")})
    index = json.dumps({"built": ix.get("built"), "laws": laws}, ensure_ascii=False, separators=(",", ":"))
    files["index.json"] = index
    h.update(index.encode("utf-8"))
    return files, h.hexdigest()[:10]


def write_lib(files):
    import shutil
    lib = APP / "lib"
    if lib.exists():
        shutil.rmtree(lib)
    lib.mkdir(parents=True)
    for name, body in files.items():
        (lib / name).write_text(body, encoding="utf-8")
    return sum(len(b.encode("utf-8")) for b in files.values())


def load_cloud():
    """المفاتيح العامة للخدمات السحابية (config/cloud.json). يرفض البناء أي سر خادم فيها."""
    if not CLOUDCFG.exists():
        return None
    raw = CLOUDCFG.read_text(encoding="utf-8")
    cfg = json.loads(raw)
    cfg.pop("_note", None)
    text = json.dumps(cfg, ensure_ascii=False)
    for pat in SECRET_MARKERS:
        if re.search(pat, text):
            sys.exit(f"✗ config/cloud.json يحمل سراً لا يجوز شحنه للعميل ({pat}). الأسرار تُضبط على الخادم فقط.")
    return cfg


def js_hash(s):
    """مطابقة لدالة hash في التطبيق: h = h*33 + رمز الحرف، في 32 بتاً بلا إشارة."""
    h = 0
    for ch in s:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    return h


def write_site(out, cloud, version):
    """الموقع: صفحة رئيسية حية + الخصوصية والبنود وحذف البيانات (أربع لغات) + لوحة المؤلف + نسخة الويب من التطبيق في app/."""
    import shutil, datetime
    if SITE.exists():
        shutil.rmtree(SITE)
    shutil.copytree(APP, SITE / "app")
    site_url = (cloud or {}).get("site", "").rstrip("/")
    qs = out["questions"]
    verified = sorted([q for q in qs if q.get("conf") != "r"], key=lambda q: q["id"])
    assert all(q["id"].isascii() for q in verified), "معرّف غير لاتيني يكسر مطابقة ترتيب سؤال اليوم مع التطبيق"
    today = datetime.date.today()
    daily = {}
    for k in range(-2, 75):
        d = (today + datetime.timedelta(days=k)).isoformat()
        q = verified[js_hash("qt-daily|" + d) % len(verified)]
        daily[d] = {"id": q["id"], "b": q["branch"], "d": q["difficulty"], "t": q.get("type", "knowledge"),
                    "stem": q["stem"], "o": q["options"], "c": q["correct"], "x": q["explain"],
                    "law": q["source"]["law"], "ref": q["source"]["ref"]}
    count = collections.Counter(q["branch"] for q in qs)
    branches = [{"id": b["id"], "ar": b["ar"], "fr": b["fr"], "en": b["en"], "hue": b["hue"], "n": count.get(b["id"], 0)}
                for b in out["branches"]]
    amends = sorted(({**a, "n": L["n"]} for L in out["laws"] for a in L["a"]), key=lambda a: a["d"], reverse=True)
    public = {k: v for k, v in (cloud or {}).items() if k in ("supabase", "pubnub", "ably", "play", "site")}
    data = {"cloud": public, "n": len(qs), "v": len(verified), "branches": branches, "daily": daily,
            "upd": amends[:6], "amd": len(amends), "built": today.isoformat(), "version": version}
    ld = {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": "قانون تاهيرو",
          "alternateName": "Qanoun Tahiro", "applicationCategory": "EducationalApplication",
          "operatingSystem": "Android, Web", "inLanguage": ["ar", "fr", "en"], "url": site_url + "/",
          "offers": {"@type": "Offer", "price": "0", "priceCurrency": "MAD"},
          "author": {"@type": "Person", "name": "Ahmed Bakkali Tahiri"},
          "description": f"بنك أسئلة القانون المغربي: {len(qs)} سؤالاً ومسألة ونازلة في ثلاثة عشر فرعاً."}
    # يُهرَّب «</» داخل JSON المحقون في <script> حتى لا يُغلق نص سؤالٍ الوسمَ قبل أوانه
    js = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    fill = lambda s: (s.replace("__SITE__", site_url).replace("__N__", f"{len(qs)}").replace("__V__", f"{len(verified)}")
                       .replace("__AMD__", str(len(amends))).replace("<!--__FONTS__-->", fonts_html("app/fonts/")))
    tpl = (ROOT / "src" / "site.html").read_text(encoding="utf-8")
    (SITE / "index.html").write_text(fill(tpl).replace("__LDJSON__", js(ld)).replace("/*__DATA__*/null", js(data)), encoding="utf-8")
    # الصفحات القانونية (v8.1) بأربع لغات: الخصوصية، والبنود والشروط، وحذف البيانات (تفتحها أزرار التطبيق في المتصفح)
    # v8.2.1: فقرات مستوى خدمة الذكاء الاصطناعي بحسب config/cloud.json ← "ai": {"tier": "free" أو "paid"}؛ وتُحذف فقرات المستوى الآخر
    ai_tier = str(((cloud or {}).get("ai") or {}).get("tier") or "free").strip().lower()
    if ai_tier not in ("free", "paid"):
        sys.exit("✗ config/cloud.json: ai.tier إما free أو paid")
    other = "paid" if ai_tier == "free" else "free"
    def tiered(s):
        s = re.sub(rf"<!--{other}-->.*?<!--/{other}-->", "", s, flags=re.S)
        s = s.replace(f"<!--{ai_tier}-->", "").replace(f"<!--/{ai_tier}-->", "")
        if re.search(r"<!--/?(free|paid)-->", s):
            sys.exit("✗ وسم مستوى غير مغلق في صفحة قانونية")
        return s
    for page in ("privacy", "terms", "delete-data"):
        (SITE / f"{page}.html").write_text(tiered(fill((ROOT / "src" / f"{page}.html").read_text(encoding="utf-8"))), encoding="utf-8")
    (SITE / "admin.html").write_text((ROOT / "src" / "admin.html").read_text(encoding="utf-8")
                                     .replace("/*__CLOUD__*/null", js(public)), encoding="utf-8")
    (SITE / "404.html").write_text(
        '<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>الصفحة غير موجودة — قانون تاهيرو</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;'
        'background:#0D1A22;color:#F0E7D6;font-family:system-ui;text-align:center"><div><h1 style="font-weight:500">الصفحة غير موجودة</h1>'
        '<p><a style="color:#3E9DB1" href="/">الرئيسية</a> · <a style="color:#3E9DB1" href="/app/">التطبيق</a></p></div></body></html>',
        encoding="utf-8")
    (SITE / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: {site_url}/sitemap.xml\n", encoding="utf-8")
    # app-ads.txt في جذر موقع المطوّر كما يطلب AdMob (الموقع نفسه المذكور في صفحة التطبيق على Google Play)
    appads = ((cloud or {}).get("admob") or {}).get("appAdsTxt", "").strip()
    if appads:
        if not re.fullmatch(r"google\.com, pub-\d{16}, DIRECT, f08c47fec0942fa0", appads):
            sys.exit("✗ config/cloud.json: سطر app-ads.txt غير صالح (google.com, pub-…, DIRECT, f08c47fec0942fa0)")
        (SITE / "app-ads.txt").write_text(appads + "\n", encoding="utf-8")
    (SITE / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        + "".join(f"<url><loc>{site_url}{p}</loc><lastmod>{today.isoformat()}</lastmod></url>" for p in ("/", "/app/", "/privacy", "/terms", "/delete-data"))
        + "</urlset>\n", encoding="utf-8")
    leaks = [str(p.relative_to(ROOT)) for p in SITE.rglob("*") if p.is_file() and p.suffix in (".html", ".js", ".json", ".txt", ".xml")
             and any(re.search(m, p.read_text(encoding="utf-8", errors="ignore")) for m in SECRET_MARKERS)]
    if leaks:
        sys.exit("✗ سر خادم في ملفات الموقع: " + ", ".join(leaks))
    return len(daily)


def main():
    bank, batches = load()
    validate(bank)
    check_laws(bank)
    rev = report(bank, batches)

    if warns:
        print(f"\nتنبيهات ({len(warns)}):")
        for w in warns[:15]:
            print("  !", w)
        if len(warns) > 15:
            print(f"  … و{len(warns)-15} أخرى")
    if errors:
        print(f"\nأخطاء ({len(errors)}):")
        for e in errors:
            print("  ✗", e)
        print("\nفشل التدقيق.")
        sys.exit(1)

    if TEST:
        print("\n✓ التدقيق نجح.")
        return

    OUT.parent.mkdir(exist_ok=True)
    write_review(rev)

    ship = bank["questions"]
    if STRICT:
        ship = [q for q in ship if q.get("conf") != "r"]
        print(f"\n--strict: استُبعد {len(bank['questions'])-len(ship)} سؤالاً من الناتج.")
    ship = [{k: v for k, v in q.items() if k != "_src"} for q in ship]
    laws, lawof = laws_payload(bank)
    out = dict(bank, questions=ship, laws=laws, lawOf=lawof)
    payload = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    tpl = TPL.read_text(encoding="utf-8")
    cloud = load_cloud()
    cloud_js = json.dumps(cloud, ensure_ascii=False, separators=(",", ":")) if cloud else "null"
    import hashlib
    lib_files, lib_sig = lib_payload()
    version = hashlib.sha1((payload + tpl + cloud_js + lib_sig).encode("utf-8")).hexdigest()[:10]
    tpl = tpl.replace("/*__CLOUD__*/null", cloud_js)

    # (1) بناء مستقل: البنك محقون كنص يُمرَّر لـ JSON.parse — أسرع تحليلاً من كائن JS
    literal = "JSON.parse(" + json.dumps(payload, ensure_ascii=False) + ")"
    OUT.write_text(tpl.replace("<!--__PWA__-->", "").replace("<!--__FONTS__-->", fonts_html(inline=True))
                   .replace("/*__BANK__*/null", literal), encoding="utf-8")

    # (2) بناء مقسوم: قشرة خفيفة + بنك مستقل، لـ Capacitor والبنوك الكبيرة، ومعه ملفات التثبيت
    APP.mkdir(parents=True, exist_ok=True)
    pwa = ('<link rel="manifest" href="manifest.webmanifest">'
           '<link rel="icon" href="icon.svg" type="image/svg+xml">'
           '<link rel="icon" href="icon-32.png" sizes="32x32" type="image/png">'
           '<link rel="apple-touch-icon" href="icon-180.png">')
    write_fonts()
    (APP / "index.html").write_text(tpl.replace("<!--__PWA__-->", pwa).replace("<!--__FONTS__-->", fonts_html("fonts/"))
                                    .replace("/*__BANK__*/null", "null"), encoding="utf-8")
    (APP / "questions.json").write_text(payload, encoding="utf-8")
    lib_bytes = write_lib(lib_files) if lib_files else 0
    n_icons = write_pwa(version)
    print(f"\nسجل النصوص في التطبيق: {len(laws)} نصاً، {sum(len(L['a']) for L in laws)} تعديلاً معتبراً، "
          f"و{len(lawof)} اسم مصدر مربوطاً بنصه · ملفات التثبيت: {n_icons} أيقونة، الإصدار {version}")
    if lib_files:
        print(f"مكتبة النصوص القانونية في التطبيق: {len(lib_files) - 1} قانوناً في app/lib/ ({lib_bytes / 1048576:.1f} م.ب، تُجلب عند الحاجة)")
    print("الخدمات السحابية: " + ("، ".join(k for k in ("supabase", "pubnub", "ably", "firebase") if cloud and cloud.get(k))
                                  if cloud else "لا شيء (تطبيق محلي)"))

    # (3) الموقع: يُبنى من البنك نفسه ويحمل التطبيق المقسوم في app/
    n_days = write_site(out, cloud, version)
    print(f"→ {SITE.relative_to(ROOT)}/  (الرئيسية + الخصوصية والبنود وحذف البيانات بأربع لغات + لوحة المؤلف + app/، وسؤال اليوم لـ{n_days} يوماً)")

    kb = lambda p: p.stat().st_size / 1024
    print(f"\n→ {OUT.relative_to(ROOT)}  ({kb(OUT):.0f} ك.ب، {len(ship)} سؤالاً) — مستقل")
    print(f"→ {APP.relative_to(ROOT)}/  (قشرة {kb(APP/'index.html'):.0f} ك.ب "
          f"+ بنك {kb(APP/'questions.json'):.0f} ك.ب) — مقسوم")
    print(f"→ {RQ.relative_to(ROOT)}  ({len(rev)} للمراجعة)")


if __name__ == "__main__":
    main()
