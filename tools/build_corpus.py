#!/usr/bin/env python3
"""مكتبة النصوص القانونية لـ«المساعد»: من ملفات القوانين التي رفعها المؤلف إلى مواد مرقّمة نظيفة.

الاستعمال:  python3 tools/build_corpus.py [--only slug,...] [--report]
المخرجات:   data/corpus/<slug>.json  (قانون واحد في كل ملف: بياناته ومواده)
            data/corpus/index.json   (فهرس القوانين وإحصاءاتها وسبب استبعاد ما استُبعد)

لماذا حرفاً حرفاً (pdfminer) مع ترتيب يدوي؟
  • pdftotext يقلب ترتيب حروف الأربطة العربية (لم ← مل، لح ← حل…) فيكتب «املحكمة» بدل «المحكمة».
  • pypdf يقرأ الحروف صحيحة، لكنه قد يُلحق مقطعاً بموضع مقطع آخر فيضطرب ترتيب السطر.
  فنأخذ كل حرف بموضعه، ونجمع الأسطر بخط القاعدة، ونرتب السطر من اليمين إلى اليسار، والأرقام واللاتينية من اليسار إلى اليمين
  (وعموداً بعد عمود في الجريدة الرسمية).
لا يدخل المكتبة نص لم يجتز الفحوص: نسبة الكلمات السليمة، وتسلسل الأرقام، وتغطية المواد التي يستشهد بها بنك الأسئلة.
"""
import json, re, sys, pathlib, unicodedata, collections, subprocess, hashlib, argparse, statistics

ROOT = pathlib.Path(__file__).resolve().parent.parent
UP = pathlib.Path("/mnt/user-data/uploads")
AT = next(iter(sorted(pathlib.Path("/mnt/user-data/attachments").glob("*/"))), pathlib.Path("/nonexistent"))
TXT = ROOT / "txt"
OUT = ROOT / "data" / "corpus"

BIDI = dict.fromkeys(map(ord, "​‌‍‎‏‪‫‬‭‮"
                              "⁦⁧⁨⁩﻿­ـ"))
AR = re.compile(r"[؀-ۿ]")
DIG = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
TASHKEEL = re.compile(r"[ً-ْٰ]")


def find(name):
    """ملف مرفوع بالاسم (المرفقات تبدأ ببادئة عشوائية)."""
    for base in (UP, AT):
        p = base / name
        if p.exists():
            return p
    hits = sorted(AT.glob("*" + name)) if AT.exists() else []
    return hits[0] if hits else None


# ---------------------------------------------------------------- الاستخراج
TASHKEEL_CH = set(chr(c) for c in range(0x064B, 0x0660)) | {"\u0670"}


def pdf_glyphs(path, first=0, last=None):
    """حروف كل صفحة واحداً واحداً بموضعه كما يرسمه الملف (pdfminer): (خط القاعدة، يسار، يمين، الحجم، النص، عريض؟).
    الحرف المركّب (لام ألف، لام ميم…) يبقى نصه كما في خريطة الخط، فلا تنقلب حروفه كما في pdftotext."""
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTChar
    import pypdf
    total = len(pypdf.PdfReader(str(path)).pages)
    nums = list(range(first, min(total, last) if last else total))
    pages = []
    for page in extract_pages(str(path), page_numbers=nums, laparams=None):
        gl, stack = [], [page]
        while stack:
            o = stack.pop()
            if isinstance(o, LTChar):
                t = o.get_text()
                if t.startswith("(cid:"):
                    t = "\ufffd"
                t = "".join(ch for ch in t if ch not in TASHKEEL_CH and ch != "\u0640")
                if t:
                    bold = bool(re.search(r"bold|black|heavy|demi", o.fontname or "", re.I))
                    gl.append((o.matrix[5], o.x0, o.x1, o.size or 10, t, bold))
            elif hasattr(o, "__iter__"):
                stack.extend(o)
        pages.append((float(page.width), gl))
    return pages


def _kind(t):
    if re.fullmatch(r"[A-Za-z]+", t):
        return "L"
    if re.fullmatch(r"[0-9]+", t):
        return "D"
    if t in ("-", "–", ".", "/", ",", ":", "+"):
        return "S"
    if t in ("%", "°", "٪"):
        return "E"
    if not t.strip():
        return "W"
    return "R" if AR.search(t) else "N"


def fix_ltr(items):
    """الحروف مرتبة من اليمين إلى اليسار؛ الأرقام والعبارات اللاتينية تُقرأ من اليسار إلى اليمين (خوارزمية الاتجاه في يونيكود):
    «383-8» رقم واحد، و«106 - 2» رقمان بينهما فاصل يتبع اتجاه السطر، و«Code de commerce» عبارة واحدة."""
    ks = [_kind(t) for t in items]
    out, i, n = [], 0, len(items)
    while i < n:
        if ks[i] in "LD" or (ks[i] == "E" and i + 1 < n and ks[i + 1] == "D"):
            j, latin = i, ks[i] == "L"
            while j + 1 < n:
                nk = ks[j + 1]
                if nk in "LD":
                    latin |= nk == "L"
                    j += 1
                elif nk in "SE" and j + 2 < n and ks[j + 2] in "LD":
                    j += 2
                    latin |= ks[j] == "L"
                elif nk == "E":
                    j += 1
                elif latin and nk in "WNS":
                    m = j + 1
                    while m < n and ks[m] in "WNS":
                        m += 1
                    if m < n and ks[m] == "L":
                        j = m
                    else:
                        break
                else:
                    break
            out.extend(reversed(items[i:j + 1]))
            i = j + 1
        else:
            out.append(items[i])
            i += 1
    return out


def glyph_line(gs):
    """سطر واحد: الحروف من اليمين إلى اليسار بمراكزها، ومسافة حيث يتسع الفراغ بين حرفين."""
    gs = sorted(gs, key=lambda g: -(g[1] + g[2]) / 2)
    items, prev = [], None
    for y, x0, x1, size, t, *_ in gs:
        if prev is not None and prev[1] - x1 > 0.15 * size and items and items[-1] != " " and t != " ":
            items.append(" ")
        items.append(t)
        prev = (y, x0, x1, size, t)
    return "".join(fix_ltr(items))


def dedupe(gl):
    """الخط العريض المصطنع: الحرف نفسه مرسوم مرات بإزاحة صغيرة («ااااللللممممحححح…»)؛ نُبقي نسخة واحدة."""
    seen, out = {}, []
    for r in sorted(gl, key=lambda r: (r[0], r[1])):
        y, x0, x1, size, t = r[:5]
        tol = max(0.6, 0.12 * size)
        dup = False
        for ky in (int(y) - 1, int(y), int(y) + 1):
            for px in seen.get((t, ky), ()):
                if abs(px - x0) < tol:
                    dup = True
                    break
            if dup:
                break
        if not dup:
            seen.setdefault((t, int(y)), []).append(x0)
            out.append(r)
    return out


BOLD = "\u0001"          # بادئة السطر العريض (عناوين)؛ تُنزع قبل كتابة النص
NOTE = re.compile(r"⟦(\d+):(\d+)⟧")   # موضع رقم حاشية في السطر: ⟦الصفحة:الرقم⟧


def assemble(pages, cols=False):
    """الأسطر بخط القاعدة (فالحرف النازل كالراء لا يشذ عن سطره).
    ما صغر خطه عن المتن بوضوح حواشٍ: الرقم المرفوع يصير علامة ⟦ص:ر⟧ في السطر الذي يليه، ونص الحاشية يُحفظ في notes
    (فيعرف «المساعد» أن المادة نُسخت أو غُيّرت ولا يختلط ذلك بنص القانون)."""
    out = []
    for W, gl in pages:
        groups = [gl]
        if cols and gl:
            mid = W / 2
            right = [g for g in gl if (g[1] + g[2]) / 2 >= mid]
            left = [g for g in gl if (g[1] + g[2]) / 2 < mid]
            if len(right) > 40 and len(left) > 40:
                groups = [right, left]          # الجريدة الرسمية: العمود الأيمن أولاً ثم الأيسر
        lines = []
        for g in groups:
            g = dedupe(g)
            g = sorted(g, key=lambda r: -r[0])
            cur, base = [], None
            rows = []
            for r in g:
                if cur and abs(r[0] - base) > max(1.2, 0.25 * r[3]):
                    rows.append(cur)
                    cur = []
                if not cur:
                    base = r[0]
                cur.append(r)
            if cur:
                rows.append(cur)
            for row in rows:
                sz = statistics.median(r[3] for r in row)
                bold = sum(1 for r in row if len(r) > 5 and r[5]) > 0.6 * len(row)
                lines.append((glyph_line(row), sz, bold))
        out.append(lines)
    # حجم خط المتن: الأكثر حروفاً في الملف كله؛ وما صغر عنه بوضوح حواشي الناشر وتعاليقه (لا من نص القانون)
    sizes = collections.Counter()
    for p in out:
        for t, sz, _ in p:
            sizes[round(sz * 2) / 2] += len(t.strip())
    body = sizes.most_common(1)[0][0] if sizes else 0
    small = sum(len(t.strip()) for p in out for t, sz, _ in p if sz < body * 0.88)
    use_small = bool(body) and small < 0.3 * sum(sizes.values())
    bold_share = sum(len(t) for p in out for t, _, b in p if b) / max(1, sum(len(t) for p in out for t, _, _ in p))
    notes, res = {}, []
    for pi, p in enumerate(out):
        kept, marks, cur = [], [], None
        for t, sz, b in p:
            if use_small and sz < body * 0.88:
                m = re.fullmatch(r"\s*\(?(\d{1,4})\)?\s*", t)
                if m:                                              # رقم حاشية مرفوع: علامة في السطر التالي
                    marks.append(int(m.group(1)))
                    continue
                m = re.match(r"^\s*\(?(\d{1,4})\)?\s*[-–.]\s*(.+)$", t)
                if m:
                    cur = (pi, int(m.group(1)))
                    notes[cur] = m.group(2).strip()
                elif cur and t.strip():
                    notes[cur] += " " + t.strip()
                continue
            if marks and t.strip():
                t = t.rstrip() + " " + " ".join(f"⟦{pi}:{n}⟧" for n in marks)
                marks = []
            kept.append((BOLD if b and bold_share < 0.5 else "") + t)
        if marks and kept:
            kept[-1] = kept[-1].rstrip() + " " + " ".join(f"⟦{pi}:{n}⟧" for n in marks)
        res.append(kept)
    out = res
    # الأقواس: بعض الملفات تسمّي الحرف المعكوس باسم شكله، فيأتي «)نص(»؛ نقلبها إن غلب ذلك على الملف
    flat = [l for p in out for l in p]
    rev = sum(1 for l in flat if re.search(r"^[^()]*\)[^()]*\([^()]*$", l))
    ok = sum(1 for l in flat if re.search(r"^[^()]*\([^()]*\)[^()]*$", l))
    if rev > ok:
        tr = str.maketrans("()[]{}«»", ")(][}{»«")
        out = [[l.translate(tr) for l in p] for p in out]
        notes = {k: v.translate(tr) for k, v in notes.items()}
    notes = {k: norm_line(v) for k, v in notes.items()}
    return out, notes


def pdftotext_pages(path):
    raw = subprocess.run(["pdftotext", str(path), "-"], capture_output=True, text=True).stdout
    return [p.split("\n") for p in raw.split("\f")]


def txt_pages(path):
    t = path.read_text(encoding="utf-8", errors="replace")
    return [p.split("\n") for p in t.split("\f")]


FARSI = str.maketrans({"ھ": "ه", "ہ": "ه", "ی": "ي", "ې": "ي", "ک": "ك", "ٱ": "ا", "ۀ": "ة"})


SYMFONT = re.compile(r"[\u00C0-\u00FF\u0152-\u0178\u0192\u02C6-\u02DC\u2020-\u2030\u2039\u203A\u0080-\u009F]")


def norm_line(s):
    s = unicodedata.normalize("NFKC", s).translate(BIDI).translate(DIG).translate(FARSI)
    s = s.replace("\u2212", "-")
    s = re.sub(r"^[\s\uf000-\uf0ff]*[\uf000-\uf0ff]\s*", "- ", s)          # نقطة تعداد بخط رمزي
    s = re.sub(r"[\uf000-\uf0ff]", "", s)
    s = re.sub(r"(?<=[\u0600-\u06FF])[{}]+|[{}]+(?=[\u0600-\u06FF])", "", s)   # «يتع{{{ين» ← «يتعين»
    if "(" in s and ")" not in s and len(re.findall(r"(?<=[\u0600-\u06FF])\((?=[\u0600-\u06FF])", s)) >= 2:
        s = re.sub(r"(?<=[\u0600-\u06FF])\((?=[\u0600-\u06FF])", " ", s)
    letters = len(re.findall(r"[^\W\d_]", s))
    if len(SYMFONT.findall(s)) >= 3 and len(AR.findall(s)) < 0.5 * max(1, letters):
        return ""                                                          # سطر بخط رمزي لا مقابل عربياً لحروفه
    s = re.sub(r"[ \t ]+", " ", s).strip()
    s = re.sub(r"^([.:،؛,])\s+(.+)$", r"\2\1", s)           # علامة الوقف التي انتقلت إلى أول السطر
    s = re.sub(r"\s+([.:،؛,!؟)])", r"\1", s)
    s = re.sub(r"([(])\s+", r"\1", s)
    return s


FOOT = re.compile(r"^\(?\d{1,3}\)?\s*[-–]\s*(?:تم|تمت|انظر|أنظر|قارن|غير|غيرت|تغيير|نسخ|نسخت|أضيف|أضيفت|اضيف|ألغي|ألغيت|حذف|وردت|ورد|يراجع|راجع|"
                  r"راجعوا|صدر|الصيغة|النص|في النص|هكذا|كذا|المقصود|يقصد|أصبح|أصبحت|تمم|تممت|عدل|عدلت|عوض|عوضت)\b")
TOC = re.compile(r"\.{6,}|…{3,}|(?:\. ){5,}")


def fix_heading_word(l):
    l = re.sub(r"^ا\s?ل\s?م\s?ا\s?د\s?ة(?=\s|$)", "المادة", l)
    l = re.sub(r"^امل\s?ادة(?=\s|$)", "المادة", l)
    l = re.sub(r"^ا\s?ل\s?ف\s?ص\s?ل(?=\s|$)", "الفصل", l)
    l = re.sub(r"^(المادة|الفصل)\s+ال\s?(?:ا|أ)?\s?ول(ى)?(?=\s|$|[:.])", lambda m: m.group(1) + (" الأولى" if m.group(2) else " الأول"), l)
    return l


def clean_pages(pages, drop=()):
    """يحذف أرقام الصفحات والرؤوس والتذييلات المتكررة، وحواشي الناشر (تم تغيير…/انظر…) في ذيل الصفحة، والفهارس."""
    def prep(l):
        b = l.startswith(BOLD)
        l = fix_heading_word(norm_line(l.lstrip(BOLD)))
        return (BOLD + l) if (b and l) else l
    pages = [[prep(l) for l in p] for p in pages]
    core = lambda l: l.lstrip(BOLD)
    cut = []
    for p in pages:
        # حاشية الناشر: من أول سطر «رقم - تم تغيير/انظر/…» إلى آخر الصفحة
        k = next((i for i, l in enumerate(p) if FOOT.match(core(l))), None)
        cut.append(p[:k] if k is not None and k >= len(p) * 0.4 else [l for l in p if not FOOT.match(core(l))])
    pages = cut
    shape = lambda l: re.sub(r"\d+", "#", NOTE.sub("", core(l))).strip()
    edge = lambda p: [l for l in p[:3] + p[-3:] if core(l).strip()]      # الرأس والتذييل في طرفي الصفحة وحدهما
    freq = collections.Counter()
    for p in pages:
        for l in {shape(l) for l in edge(p)}:
            if 0 < len(l) < 90:
                freq[l] += 1
    rep = {l for l, c in freq.items() if c >= max(4, len(pages) * 0.25) and not HEAD.match(l.replace("#", "1"))}
    out = []
    for p in pages:
        ends = set(map(id, edge(p)))
        for l in p:
            c = core(l)
            if not c or (id(l) in ends and shape(l) in rep) or re.fullmatch(r"[-–—\s\d/()]+", c) or TOC.search(c):
                continue
            if any(re.search(d, c) for d in drop):
                continue
            out.append(l)
    return out


# ---------------------------------------------------------------- التقسيم إلى مواد
ORD = {"الأولى": 1, "الاولى": 1, "الأول": 1, "الاول": 1, "الثانية": 2, "الثاني": 2, "الثالثة": 3, "الثالث": 3}
NUM = r"(?P<num>\d{1,4}(?:\s*[-–]\s*\d{1,3}){0,2}|الأولى|الاولى|الأول|الاول|الثانية|الثاني|الثالثة|الثالث)"
SUF = r"(?P<suf>(?:\s*(?:مكرر(?:ة)?|المكرر(?:ة)?)(?:\s*(?:مرتين|ثلاث\s*مرات|أربع\s*مرات|ثانية|ثالثة|\d))?)?)"
HEAD = re.compile(r"^\s*(?:\d{1,3}\s+(?=ال))?(?P<w>(?:ا\s?ل\s?)?(?:مادة|فصل))\s*[:.\-–]?\s*" + NUM + SUF + r"(?![\d.])\s*(?P<after>[:.\-–]?\s*.*)$")
SECTION = re.compile(r"^(?:ال)?(?:كتاب|قسم|باب|فرع|جزء|فصل\s+(?:تمهيدي|الأول|الثاني|الثالث|الرابع|الخامس))(?:\s|$)|^(?:الكتاب|القسم|الباب|الفرع|الجزء)\b"
                     r"|^(?:ا\s?ل\s?)?(?:ك\s?ت\s?ا\s?ب|ق\s?س\s?م|ب\s?ا\s?ب|ف\s?ر\s?ع|ج\s?ز\s?ء)\s(?:ال)?\s?(?:أ\s?و\s?ل|ث\s?ا\s?ن|ث\s?ا\s?ل\s?ث|ر\s?ا\s?ب\s?ع|خ\s?ا\s?م\s?س|س\s?ا\s?د\s?س|س\s?ا\s?ب\s?ع|ث\s?ا\s?م\s?ن|ت\s?ا\s?س\s?ع|ع\s?ا\s?ش\s?ر|ت\s?م\s?ه\s?ي\s?د)")
BIS = {"": 0, "مكرر": 1, "مكررة": 1, "المكرر": 1, "المكررة": 1}


def parse_num(num, suf):
    num = re.sub(r"\s+", "", num.translate(DIG)).replace("–", "-")
    sub2 = 0
    if num in ORD:
        base, sub = ORD[num], 0
    else:
        parts = [int(x) for x in num.split("-")]
        base, sub = parts[0], parts[1] if len(parts) > 1 else 0
        sub2 = parts[2] if len(parts) > 2 else 0
        if len(parts) == 2 and parts[1] > parts[0] and parts[0] < 10:   # «1-618» مقلوبة في الاستخراج
            base, sub = parts[1], parts[0]
    suf = re.sub(r"\s+", " ", suf.strip())
    bis = 0
    if suf:
        bis = 1
        if re.search(r"مرتين|ثانية|2", suf):
            bis = 2
        elif re.search(r"ثلاث|ثالثة|3", suf):
            bis = 3
        elif re.search(r"أربع|4", suf):
            bis = 4
    return base, sub, sub2, bis


def label_of(word, base, sub, sub2, bis):
    n = f"{base}" + (f"-{sub}" if sub else "") + (f"-{sub2}" if sub2 else "")
    tail = {0: "", 1: " مكرر", 2: " مكرر مرتين", 3: " مكرر ثلاث مرات", 4: " مكرر أربع مرات"}[bis]
    return n + tail, f"{word} {n}{tail}"


TAIL = r"^(?:الفهرس|فهرس|الملاحق|ملحق|الملحق|نماذج|النماذج|جدول المحتويات|المحتويات)(?:\s|$|:)"


def split_articles(lines, word, tail=None, notes=None):
    """يختار سلسلة العناوين الأطول تسلسلاً (فتسقط الإحالات وفهارس المحتوى)، ثم يقطع النص عندها."""
    notes = notes or {}
    bold = [l.startswith(BOLD) for l in lines]
    lines = [l.lstrip(BOLD) for l in lines]
    cands = []
    for i, l in enumerate(lines):
        m = HEAD.match(NOTE.sub("", l).rstrip())
        if not m:
            continue
        w = m.group("w").replace(" ", "")
        if ("مادة" in w) != (word == "المادة"):
            continue
        marks = " ".join(f"⟦{p}:{n}⟧" for p, n in NOTE.findall(l))       # حاشية على سطر العنوان تبقى للمادة
        after = (m.group("after").strip(" :.-–") + " " + marks).strip()
        # عنوان المادة سطر وحده، أو يتبعه نص قصير يبدأ الجملة (لا «من هذا القانون»: تلك إحالة)
        if after and re.match(r"^(?:من|أعلاه|أدناه|و|إلى|او|أو|في|بعده|قبله|الى|على)\b", after):
            continue
        key = parse_num(m.group("num"), m.group("suf") or "")
        sp = re.match(r"^(\d{1,3})\s+(\d{1,3})(?=\s|$)", after)
        if sp and m.group("num").isdigit() and not m.group("suf"):
            x, y = m.group("num"), sp.group(1)
            rest = after[sp.end():].strip(" :.-–")
            for joined in (y + x, x + y):
                cands.append((i, (int(joined), 0, 0, 0), rest))
            continue
        cands.append((i, key, after))
    if not cands:
        return []
    # أطول سلسلة متزايدة بفجوة معقولة (برمجة ديناميكية)
    n = len(cands)
    best = [1] * n
    prev = [-1] * n
    for j in range(n):
        kj = cands[j][1]
        for i in range(max(0, j - 400), j):
            ki = cands[i][1]
            # عند التساوي نأخذ الأقرب (الأحدث موضعاً): فصول ظهير الإصدار وفهرس المحتوى تسبق النص، ونصّ القانون بعدها
            if cands[i][0] < cands[j][0] and kj > ki and kj[0] - ki[0] <= 12 and best[i] + 1 >= best[j]:
                best[j], prev[j] = best[i] + 1, i
    j = max(range(n), key=lambda k: (best[k], k))
    chain = []
    while j >= 0:
        chain.append(cands[j])
        j = prev[j]
    chain.reverse()
    arts = []
    path = []
    sec_by_line = {}
    cur = []
    for i, l in enumerate(lines):
        if SECTION.match(l) and len(l) < 120:
            cur = (cur + [NOTE.sub("", l).strip()])[-3:]
        sec_by_line[i] = " ← ".join(cur)
    tail_end = len(lines)
    if chain:
        for t in range(chain[-1][0] + 1, len(lines)):
            if re.match(TAIL, lines[t]) or (tail and re.search(tail, lines[t])):
                tail_end = t
                break
    for k, (i, key, after) in enumerate(chain):
        end = chain[k + 1][0] if k + 1 < len(chain) else tail_end
        body = ([after] if after else []) + lines[i + 1:end]
        bb = ([False] if after else []) + bold[i + 1:end]
        # عناوين الأقسام التي تسبق المادة التالية ليست من نصها (وقد تمتد العريضة منها على سطرين،
        # أو يتلو العنوانَ سطرٌ قصير مثل «(الفصول 13 - 109)»)
        while body:
            last = NOTE.sub("", body[-1]).strip()
            if len(last) < 160 and (SECTION.match(last) or (bb[-1] and not all(bb))):
                body.pop()
                bb.pop()
            elif len(body) >= 2 and len(last) < 80 and len(body[-2]) < 160 and SECTION.match(NOTE.sub("", body[-2]).strip()):
                body.pop()
                bb.pop()
            else:
                break
        text = join_lines(body)
        refs = [(int(p), int(n)) for p, n in NOTE.findall(text)]
        text = re.sub(r"[ ]{2,}", " ", NOTE.sub("", text)).replace(" \n", "\n").strip()
        lead, text = lead_note(text)
        n, label = label_of(word, *key)
        art = {"n": n, "label": label, "path": sec_by_line.get(i, ""), "text": text, "_key": key}
        got = ([lead] if lead else []) + [notes[r] for r in refs if notes.get(r, "").strip()]
        if got:
            art["notes"] = got
        arts.append(art)
    return arts


LEAD = re.compile(r"^\((?:معدل|معدلة|غير|غيرت|عدل|عدلت|أضيف|أضيفت|اضيف|اضيفت|نسخ|نسخت|تمم|تممت|عوض|عوضت|ألغي|ألغيت|"
                  r"ظهير|الظهير|القانون رقم|بمقتضى|كما غير|كما وقع)")


def lead_note(text):
    """«(غيرت بموجب المادة الأولى من القانون رقم 106.12 …) تسري أحكام…» ← حاشية + نص المادة."""
    if not LEAD.match(text):
        return "", text
    depth = 0
    for k, ch in enumerate(text[:900]):
        depth += (ch == "(") - (ch == ")")
        if depth == 0:
            return text[1:k].strip(), text[k + 1:].lstrip(" .:،\n")
    return "", text


def join_lines(body):
    out = ""
    for l in body:
        if not out:
            out = l
        elif re.search(r"[.:؛!؟]$", out) or re.match(r"^(?:[-–•*]|\d+\s*[-–.)]|[أ-ي]\s*[-–)])\s", l):
            out += "\n" + l
        else:
            out += " " + l
    return re.sub(r"[ ]{2,}", " ", out).strip()


# ---------------------------------------------------------------- الدستور (أرقام فصوله بخط زخرفي)
def dustour_articles(path):
    t = unicodedata.normalize("NFKC", subprocess.run(["pdftotext", str(path), "-"], capture_output=True, text=True).stdout).translate(BIDI)
    marks = [(int(m.group(1)), m.start(), m.end()) for m in re.finditer(r"<\s*(\d{1,3})\s*<", t)]
    # الفصول من 1 إلى 180 بالترتيب: نأخذ أطول سلسلة متتابعة
    chain, expect = [], 1
    for n, s, e in marks:
        if expect <= n <= expect + 2 and n <= 180:      # يتسامح مع علامة رقم سقطت من الاستخراج
            chain.append((n, s, e))
            expect = n + 1
    arts = []
    for k, (n, s, e) in enumerate(chain):
        end = chain[k + 1][1] if k + 1 < len(chain) else e + 4000
        seg = t[e:end]
        seg = seg.split("\n", 1)[1] if "\n" in seg else seg   # بقية سطر العنوان المزخرف
        lines = [norm_line(l) for l in seg.split("\n")]
        lines = [l for l in lines if l and not re.search(r"[^؀-ۿ0-9\s،.:؛()\-\"«»/%]", l)
                 and not re.fullmatch(r"[\d\s]+", l) and "مركز الدراسات" not in l]
        while lines and SECTION.match(lines[-1]):
            lines.pop()
        if n == 180:
            stop = next((i for i, l in enumerate(lines) if "قرار" in l and "المجلس الدستوري" in l), None)
            lines = lines[:stop] if stop else lines[:6]
        arts.append({"n": str(n), "label": f"الفصل {n}", "path": "", "text": join_lines(lines), "_key": (n, 0, 0, 0)})
    return arts


# ---------------------------------------------------------------- الإصلاح المعجمي
# المعجم من النصوص النظيفة نفسها (المستخرجة بحروف صحيحة)، فيُصلَح به ما فسد في غيرها:
#   • قلب حروف الأربطة في pdftotext: «املحكمة» ← «المحكمة»، «احلبس» ← «الحبس»
#   • قلب لام ألف أو سقوط ألفها: «إصالح» ← «إصلاح»، «اإلدارة» ← «الإدارة»، «التفاق» ← «الاتفاق»
#   • كلمة انشطرت بمسافة: «الماد ة» ← «المادة»، «ت حتوي» ← «تحتوي»
#   • كلمات التصقت: «التعويضالرامية» ← «التعويض الرامية»
TOK = re.compile(r"[\u0621-\u064A]+")
# نصوص مستخرجة بحروف صحيحة وهمزات سليمة: منها وحدها يُبنى المعجم
LEX_SOURCES = {"doc", "commerce", "family", "civil_proc", "labour", "criminal", "judicial_org", "civil_service", "copropriety",
               "commercial_lease", "residential_lease", "land_registry", "admin_courts", "admin_appeal"}
LEX = collections.Counter()
VOCAB = collections.Counter()       # في كم قانوناً ترد الكلمة (لقياس «المجهول» دون معاقبة مفردات قانون خاص)
RAW = {}                            # كلمات كل قانون قبل الإصلاح
CUR = collections.Counter()         # كلمات القانون الجاري إصلاحه (الكلمة غير المشطورة في موضع آخر منه دليل على صحة الدمج)


def bank_texts():
    import glob
    files = [ROOT / "data" / "questions.json"] + sorted(pathlib.Path(p) for p in glob.glob(str(ROOT / "data" / "batch-*.json")))
    for f in files:
        for q in json.loads(f.read_text(encoding="utf-8"))["questions"]:
            yield q.get("stem", "")
            yield q.get("explain", "")
            for o in q.get("options", []):
                yield o


def lexicon_from(laws):
    LEX.clear()
    for law in laws:
        for a in law["articles"]:
            LEX.update(TOK.findall(a["text"]))
    for t in bank_texts():
        LEX.update(TOK.findall(unicodedata.normalize("NFKC", t).translate(BIDI)))
    return LEX


def candidates(w):
    out = set()
    for pat, rep in (("مل", "لم"), ("حل", "لح"), ("جل", "لج"), ("خل", "لخ")):
        idx = [m.start() for m in re.finditer(pat, w)]
        for mask in range(1, 1 << min(len(idx), 3)):
            c = list(w)
            for b, i in enumerate(idx[:3]):
                if mask >> b & 1:
                    c[i], c[i + 1] = c[i + 1], c[i]
            out.add("".join(c))
    for pat, rep in (("ال", "لا"), ("إل", "لإ"), ("أل", "لأ"), ("آل", "لآ")):
        for m in re.finditer(pat, w):
            if m.start() == 0 and pat == "ال":
                continue                      # أداة التعريف في أول الكلمة صحيحة
            out.add(w[:m.start()] + rep + w[m.end():])
    for m in re.finditer("ل(?=[^اأإآ])", w):
        for ins in ("ا", "أ", "إ"):
            out.add(w[:m.end()] + ins + w[m.end():])
    if w.startswith("ال") and len(w) > 3:
        for ins in ("أ", "إ", "ا"):
            out.add("ال" + ins + w[2:])
    for i, ch in enumerate(w):
        if ch == "ا" and "hamza" in QUIRKS:          # خط يرسم الهمزة حرفاً بلا مقابل: «الاجر» ← «الأجر»
            out.update(w[:i] + h + w[i + 1:] for h in "أإآ")
        if ch == "س" and "sad" in QUIRKS:            # خط يُسقط نقط الصاد والضاد والشين: «قاسي» ← «قاضي»، «السيء المقضي» ← «الشيء»
            out.update(w[:i] + h + w[i + 1:] for h in "صضش")
        if ch == "س" and "alef_sin" in QUIRKS:       # خط الجريدة الرسمية: الألف المهموزة سين، والسين الأخيرة ساقطة
            out.add(w[:i] + "أ" + w[i + 1:])
        if ch in "يى" and i == len(w) - 1:
            out.add(w[:i] + ("ى" if ch == "ي" else "ي"))
    if "alef_sin" in QUIRKS:
        out.add(w + "س")
    if "hamza" in QUIRKS and w.endswith("ي"):
        out.add(w[:-1] + "ئ")
    out.discard(w)
    return out


QUIRKS = set()


def fix_token(w):
    if len(w) < 2 or (len(w) == 2 and not QUIRKS & {"hamza", "alef_sin"}):
        return w
    if LEX[w] >= (60 if QUIRKS & {"hamza", "alef_sin", "sad"} else 3):
        return w
    c1 = candidates(w)
    if w[0] == "ا" and len(w) > 2:
        c1 |= {h + w[1:] for h in "أإآ"}
    best = max(c1, key=lambda c: LEX[c], default=w)
    if LEX[best] < 5 and len(w) <= 14:            # تعديلان: «اإلسالمي» ← «الإسلامي»
        c2 = set()
        for c in list(c1)[:60]:
            c2 |= candidates(c)
        b2 = max(c2, key=lambda c: LEX[c], default=w)
        if LEX[b2] > LEX[best]:
            best = b2
    return best if LEX[best] >= (3 if QUIRKS else 5) and LEX[best] > 20 * LEX[w] else w


def split_glued(w):
    if len(w) < 9 or LEX[w] >= 2:
        return w
    n = len(w)
    best = [None] * (n + 1)
    best[0] = (0, [])
    for i in range(1, n + 1):
        for j in range(max(0, i - 16), i):
            if best[j] is None:
                continue
            piece = w[j:i]
            if len(piece) >= 2 and LEX[piece] >= 8:
                cand = (best[j][0] + 1, best[j][1] + [piece])
                if best[i] is None or cand[0] < best[i][0]:
                    best[i] = cand
    return " ".join(best[n][1]) if best[n] and best[n][0] <= 3 else w


FRAG = re.compile(r"^[سشض][يىئ]$")


def fix_unmapped(text):
    """بعض خطوط الناشرين ترسم «ض» أو الهمزة بحرف لا مقابل له (�)، وتضع بقية الكلمة (سي/شي/شى) في طرف السطر.
    نركّب الكلمة من جديد بالمعجم: «الأرا � … شي» ← «الأراضي»، «كل � … شي» ← «كل شيء»."""
    if "\ufffd" not in text:
        return text
    toks = text.split(" ")
    used = set()
    for r, t in enumerate(toks):
        if "\ufffd" not in t:
            continue
        core = t.replace("\ufffd", "")
        frags = sorted((f for f in range(max(0, r - 25), min(len(toks), r + 3)) if f not in used and f != r and FRAG.match(toks[f])),
                       key=lambda f: (abs(f - r) > 1, abs(f - r)))
        prev = toks[r - 1] if r > 0 else ""
        best = None
        for f in frags[:3] + [None]:
            fr = toks[f] if f is not None else ""
            for Y in {fr, "ض" + fr[1:], fr + "ء", "ض" + fr[1:] + "ء", "ض", "ء", "ضي", "ضى"} - {""}:
                for how, word in (("join", prev + core + Y), ("alone", core + Y)):
                    if how == "join" and (not prev or not re.match(r"^[\u0621-\u064A]+$", prev)):
                        continue
                    c = LEX[word]
                    if c >= 3 and (best is None or c > best[0]):
                        best = (c, how, word, f)
        if best:
            c, how, word, f = best
            if how == "join":
                toks[r - 1], toks[r] = word, ""
            else:
                toks[r] = word
            if f is not None:
                toks[f] = ""
                used.add(f)
        else:
            toks[r] = core
    return re.sub(r" {2,}", " ", " ".join(t for t in toks if t != "")).strip()


def attach_frags(text):
    """قطع «سي/شي/ضي…» الشاردة في أول السطر بقيةُ كلمة ناقصة بعدها (قا … ← قاضي، بمقت … ← بمقتضى)."""
    toks = text.split(" ")
    for f, t in enumerate(toks):
        if not FRAG.match(t):
            continue
        best = None
        for r in range(f + 1, min(len(toks), f + 30)):
            w = toks[r]
            if not re.fullmatch(r"[\u0621-\u064A]+", w or "") or LEX[w] >= 50:
                continue
            for Y in (t, "ض" + t[1:]):
                c = LEX[w + Y]
                if c >= 3 and c > LEX[w] and (best is None or c > best[0]):
                    best = (c, r, w + Y)
        if best:
            toks[best[1]], toks[f] = best[2], ""
    return " ".join(x for x in toks if x != "")


def merge_pieces(text):
    """كلمة انشطرت قطعاً («الث اني»، «م ق اب ل»، «وظ يف ة»): تُدمج القطع المتتالية إن كان المدمج معروفاً
    (في المعجم، أو غير مشطور في القانون نفسه) وفيها قطعة غير معروفة."""
    pieces = re.split(r"([\u0621-\u064A]+)", text)
    freq = lambda x: max(LEX[x], 3 * CUR[x])
    i = 1
    while i < len(pieces):
        merged = False
        for k in (5, 4, 3, 2):
            j = i + 2 * (k - 1)
            if j >= len(pieces) or any(pieces[m] != " " for m in range(i + 1, j, 2)):
                continue
            parts = pieces[i:j + 1:2]
            if k > 2 and max(len(x) for x in parts) > 5:
                continue
            ab = "".join(parts)
            if freq(ab) < 5:
                ab = fix_token(ab)          # «اك ثر» ← «أكثر»
            # المدمج معروف، وأكثر وروداً بوضوح من أندر قطعه (فلا تُدمج كلمتان صحيحتان كـ«كل ما»)
            if freq(ab) >= 5 and freq(ab) >= 3 * min(LEX[x] for x in parts):
                pieces[i:j + 1] = [ab]
                merged = True
                break
        if not merged:
            i += 2
    return "".join(pieces)


def repair(text):
    def word(m):
        return split_glued(fix_token(m.group(0)))
    if "hamza" in QUIRKS:
        text = re.sub(r"(?<![\u0600-\u06FF(])[أآ] (?=[\u0621-\u064A])", "", text)     # همزات شاردة: «أ أ أ إذا» ← «إذا»
    if "alef_sin" in QUIRKS:
        text = re.sub(r"(?<=[\u0621-\u064A])0(?![0-9])", "س", text)               # «المجل0» ← «المجلس»
        text = re.sub(r"(?<![\u0600-\u06FF])سو(?![\u0600-\u06FF])", "أو", text)
        text = re.sub(r"(?<![\u0600-\u06FF])سن(?= (?:[يت][\u0621-\u064A]|لا ))", "أن", text)   # «سن يكون» ← «أن يكون»
    text = re.sub(r"ا([أإ])", r"\1", text)
    text = fix_unmapped(text)
    text = attach_frags(text)
    text = TOK.sub(word, text)
    text = merge_pieces(text)
    text = re.sub(r"(?<![\u0600-\u06FF])ل(?= [يتن][\u0621-\u064A])", "لا", text)       # «ل يمكن» ← «لا يمكن»
    text = re.sub(r"(?<![\u0600-\u06FF])إل(?= [\u0621-\u064A])", "إلا", text)
    return re.sub(r" {2,}", " ", text)


def quality(law):
    """نسبة الكلمات غير المعروفة (لا في المعجم ولا في نص قانون آخر)، وعلامات الفساد الصريحة."""
    toks = [t for a in law["articles"] for t in TOK.findall(a["text"]) if len(t) >= 3]
    mine = RAW.get(law["slug"], set())
    unk = sum(1 for t in toks if LEX[t] < 2 and VOCAB[t] - (t in mine) < 1)
    bad = sum(1 for a in law["articles"] for _ in re.finditer(r"(?<![\u0600-\u06FF])ا[محجخ]ل[\u0600-\u06FF]{2,}|اإل|\ufffd", a["text"]))
    return {"tokens": len(toks), "unknown": round(unk / max(1, len(toks)), 4), "garbled": bad}


# ---------------------------------------------------------------- المصادر
# (المفتاح في سجل القوانين، الاسم المختصر، العنوان، الفرع، كلمة المادة، المصادر المرشحة [(الطريقة، الملف، خيارات)]، خيارات القانون)
# إن تعددت المصادر بُني القانون من كل واحد واختير أسلمها بالقياس (التغطية، والحروف المشوهة، والكلمات المجهولة، والثغرات).
R, T, D = "rtl", "txt", "dustour"
SOURCES = [
    ("ق.ل.ع", "doc", "قانون الالتزامات والعقود", "obligations", "الفصل", [(R, "4_ONC_Law_ar-MA.pdf", {})], {}),
    ("مدونة التجارة 15.95", "commerce", "مدونة التجارة (القانون 15.95)", "commercial", "المادة", [(R, "3_TradeRecord_ar-MA.pdf", {})], {}),
    ("القانون 39.08", "real_rights", "مدونة الحقوق العينية (القانون 39.08)", "real_estate", "المادة", [(R, "18729844-39_08.pdf", {})], {}),
    ("مدونة الأسرة 70.03", "family", "مدونة الأسرة (القانون 70.03)", "family", "المادة", [(R, "mudawwana-usra.pdf", {})], {}),
    ("القانون 58.25", "civil_proc", "قانون المسطرة المدنية (القانون 58.25)", "civil_proc", "المادة", [(R, "e488000d-_____________________.pdf", {})], {}),
    ("ق.م.ج", "criminal_proc", "قانون المسطرة الجنائية (القانون 22.01 كما غيّره القانون 03.23)", "criminal_proc", "المادة",
     [(R, "قانون_المسطرة_الجنائية_الجديد_2025__مكتبة_امين_اليعقوبي__.pdf", {})], {"quirks": ["sad"]}),
    ("مدونة الشغل 65.99", "labour", "مدونة الشغل (القانون 65.99)", "labour", "المادة", [(R, "القانون_رقم_65_99_المتعلق_بمدونة_الشغل__1_.pdf", {})], {}),
    ("مجموعة القانون الجنائي", "criminal", "مجموعة القانون الجنائي", "criminal", "الفصل", [(R, "مجموعة-القانون-الجنائي-المعدلة-2025.pdf", {})], {}),
    # عناوين الفصول بخط زخرفي لا مقابل عربياً لحروفه: «[ÖË’Ø<12<» = «الفصل 12»؛ وبعد الفصل 180 قرار المجلس الدستوري
    ("دستور 2011", "constitution", "دستور المملكة المغربية (2011)", "constitutional", "الفصل",
     [(R, "constitution_marocaine_2011-ar__1_.pdf", {"head": (r"^<?\[?ÖË’Ø[<\s]*(\d{1,3})[<\s]*$", r"الفصل \1"),
                                                     "tail": r"^قرار للمجلس الدستوري"}),
      (D, "constitution_marocaine_2011-ar__1_.pdf", {})], {}),
    ("القانون 38.15", "judicial_org", "التنظيم القضائي (القانون 38.15)", "judicial_org", "المادة",
     [(R, "ظهير-شريف-رقم-1_22_38-بتنفيذ-القانون-رقم-38_15-المتعلق-بالتنظيم-القضائي__1_.pdf", {})], {}),
    ("القانون 17.95", "sa", "شركات المساهمة (القانون 17.95)", "companies", "المادة", [(T, "sa_17_95.txt", {})], {}),
    ("القانون 5.96", "companies_other", "شركة التضامن والتوصية والمسؤولية المحدودة والمحاصة (القانون 5.96)", "companies", "المادة",
     [(R, "39843aa9-3-_______-___-5.96-_______-_____-_______-_____-_______-_______.pdf", {}), (T, "sharikat_5_96.txt", {})], {}),
    ("ظهير 24 فبراير 1958", "civil_service", "النظام الأساسي العام للوظيفة العمومية (ظهير 24 فبراير 1958)", "administrative", "الفصل",
     [(R, "SGFP_06092024_Ar.pdf", {})], {}),
    ("القانون 18.00", "copropriety", "نظام الملكية المشتركة للعقارات المبنية (القانون 18.00)", "real_estate", "المادة", [(R, "3647cd9f-18_00.pdf", {})], {}),
    # فصول كثيرة منسوخة (2 إلى 5 و33… بالقانون 14.07)، فالثغرات هنا نسخ لا عناوين ضائعة
    ("ظهير التحفيظ العقاري", "land_registry", "التحفيظ العقاري (ظهير 12 غشت 1913 كما غُيّر وتُمّم)", "real_estate", "الفصل",
     [(R, "04e0233f-______-_______-________-_______.pdf", {})], {"gaps_ok": True}),
    ("القانون 41.90", "admin_courts", "إحداث المحاكم الإدارية (القانون 41.90)", "administrative", "المادة",
     [(R, "94baead7-____-____-___-1.91.225-______-_______-___-41.90-______-______-_____-______.pdf", {})], {}),
    ("القانون 42.10", "proximity_courts", "قضاء القرب (القانون 42.10)", "judicial_org", "المادة",
     [(R, "37c07dce-____-____-___-1.11.151-_____-___-42.10-_____-______-____-_____-______-_________.pdf", {})], {}),
    ("القانون 49.16", "commercial_lease", "كراء العقارات للاستعمال التجاري أو الصناعي أو الحرفي (القانون 49.16)", "commercial", "المادة",
     [(R, "6f2691f3-____-________-________-_______-_________-_______-__-_______-__-______.pdf", {})], {}),
    ("القانون 67.12", "residential_lease", "كراء المحلات المعدة للسكنى أو للاستعمال المهني (القانون 67.12)", "obligations", "المادة",
     [(R, "464a2ae0-_______-______-______-__-_________-______.pdf", {})], {}),
    ("القانون 15.01", "kafala", "كفالة الأطفال المهملين (القانون 15.01)", "family", "المادة", [(T, "kafala_15_01.txt", {})], {}),
    ("القانون 18.12", "work_accidents", "التعويض عن حوادث الشغل (القانون 18.12)", "labour", "المادة", [(T, "hawadith_18_12.txt", {})], {}),
    ("القانون 19.12", "domestic_work", "شروط الشغل والتشغيل المتعلقة بالعاملات والعمال المنزليين (القانون 19.12)", "labour", "المادة",
     [(R, "f2af9882-_____-___-19.12-______-____-_____-________-________-_________-_______-_________.pdf", {})], {"quirks": ["hamza"]}),
    ("القانون 31.08", "consumer", "تدابير حماية المستهلك (القانون 31.08)", "commercial", "المادة", [(T, "mustahlik_31_08.txt", {})], {}),
    ("مدونة التأمينات 17.99", "insurance", "مدونة التأمينات (القانون 17.99)", "commercial", "المادة", [(T, "taaminat_17_99.txt", {})], {}),
    ("القانون 09.08", "personal_data", "حماية الأشخاص الذاتيين تجاه معالجة المعطيات ذات الطابع الشخصي (القانون 09.08)", "administrative", "المادة",
     [(R, "d456903a-Loi-09-08-Ar.pdf", {}), (R, "d456903a-Loi-09-08-Ar.pdf", {"cols": True}), (T, "maatiyat_09_08.txt", {})], {}),
    ("القانون 31.13", "access_info", "الحق في الحصول على المعلومات (القانون 31.13)", "administrative", "المادة",
     [(R, "9d8c776c-____-__-________.pdf", {}), (T, "31_13_maaloumat.txt", {})], {}),
    ("القانون 103.12", "credit", "مؤسسات الائتمان والهيئات المعتبرة في حكمها (القانون 103.12)", "commercial", "المادة",
     [(R, "8bc562a3-loi-103-12-credit-ar.pdf", {})], {"quirks": ["hamza"]}),
    ("مدونة الأوقاف", "awqaf", "مدونة الأوقاف (ظهير 23 فبراير 2010)", "real_estate", "المادة",
     [(R, "f73ab2af-_____-_______.pdf", {}), (T, "awqaf_2010.txt", {})], {"quirks": ["hamza"]}),
    ("القانون 80.03", "admin_appeal", "إحداث محاكم استئناف إدارية (القانون 80.03)", "administrative", "المادة",
     [(R, "الظهير-الشريف-رقم-1_06_07-بتنفيذ-القانون-رقم-80_03-المحدثة-بموجبه-محاكم-استئناف-إدارية.pdf", {"cols": True}),
      (R, "الظهير-الشريف-رقم-1_06_07-بتنفيذ-القانون-رقم-80_03-المحدثة-بموجبه-محاكم-استئناف-إدارية.pdf", {})], {}),
    ("القانون 55.19", "simplification", "تبسيط المساطر والإجراءات الإدارية (القانون 55.19)", "local_gov", "المادة",
     [(R, "القانون_رقم_19-55_المتعلق_بتبسيط_المساطر_والإجراءات_الإدارية.pdf", {"cols": True}),
      (R, "القانون_رقم_19-55_المتعلق_بتبسيط_المساطر_والإجراءات_الإدارية.pdf", {})], {}),
    ("القانون 36.21", "civil_status", "الحالة المدنية (القانون 36.21)", "family", "المادة",
     [(R, "1eaaa27a-Dahir_n__1.21.81_en_date_du_14_Juillet_2021_en_application_de_la_loi_36.21_relative___l__tat_civil.pdf", {"cols": True})],
     {"quirks": ["sad"]}),
    ("القانون 97.15", "strike", "القانون التنظيمي لممارسة حق الإضراب (القانون 97.15)", "labour", "المادة",
     [(R, "80f0c616-97-15-Ar.pdf", {"cols": True}), (R, "80f0c616-97-15-Ar.pdf", {})], {}),
    ("القانون 051.26", "adoul", "تنظيم مهنة العدول (القانون 051.26)", "judicial_org", "المادة",
     [(R, "da5b606c-BO_7533_Ar.pdf", {"cols": True, "pages": (37, 67)})], {"quirks": ["alef_sin"]}),
]


CACHE = pathlib.Path(__import__("os").environ.get("QT_CORPUS_CACHE", "/tmp/qt-corpus-cache"))


def cached_lines(path, how, opt):
    import pickle
    CACHE.mkdir(parents=True, exist_ok=True)
    first, last = opt.get("pages", (0, None))
    f = CACHE / (hashlib.sha256(path.read_bytes()).hexdigest()[:16] + f"-glyphs2-{first}-{last}.pkl")
    if f.exists():
        pages = pickle.loads(f.read_bytes())
    else:
        pages = pdf_glyphs(path, first, last)
        f.write_bytes(pickle.dumps(pages))
    return assemble(pages, cols=opt.get("cols", False))


def build_one(src, how, fname, opt):
    key, slug, title, branch, word = src[:5]
    ocr = False
    if how == "txt":
        path = TXT / fname
        if not path.exists():
            return None, f"الملف غير موجود: txt/{fname}"
        raw = path.read_text(encoding="utf-8", errors="replace")
        ocr = bool(re.search(r"^=== p-\d+", raw, re.M))     # نص مستخرج بالتعرف الضوئي على صور الصفحات
        lines = clean_pages(txt_pages(path))
        arts = split_articles(lines, word)
    else:
        path = find(fname)
        if not path:
            return None, f"الملف غير موجود: {fname}"
        if how == "dustour":
            arts = dustour_articles(path)
        else:
            pages, notes = cached_lines(path, how, opt)
            if opt.get("head"):
                rx, rep = opt["head"]
                pages = [[(BOLD if l.startswith(BOLD) else "") + re.sub(rx, rep, l.lstrip(BOLD)) for l in p] for p in pages]
            lines = clean_pages(pages)
            arts = split_articles(lines, word, opt.get("tail"), notes)
    return {"key": key, "slug": slug, "title": title, "branch": branch, "word": word, "how": how, "opt": opt, "ocr": ocr,
            "source": path.name, "sha": hashlib.sha256(path.read_bytes()).hexdigest()[:16], "articles": arts}, None


def build(src):
    """كل المرشحين لقانون واحد (يُختار أسلمهم بعد بناء المعجم)."""
    outs, errs = [], []
    for how, fname, opt in src[5]:
        law, err = build_one(src, how, fname, opt)
        (errs.append(err) if err else outs.append(law))
    return outs, errs


# حواشي الناشر: نُبقي ما يخبر بنسخ أو تغيير أو إحالة على نص رسمي (يحتاجه «المساعد» ليعرف الصيغة النافذة)،
# ونترك التعاليق والمقارنات والترجمات (رأي المحرر، لا معلومة تشريعية)
NOTE_KEEP = re.compile(r"(?:تم|وقع)\s+(?:نسخ|تغيير|تتميم|تعويض|إضافة|اضافة|حذف|إلغاء|الغاء)|نسخت|نسخ |غيرت|غير وتمم|تممت|عوضت|أضيفت|اضيفت"
                       r"|ألغيت|الغيت|بمقتضى|الجريدة الرسمية|القانون رقم|الظهير الشريف رقم|المرسوم رقم|ج\.\s?ر|معدل|ظهير|ظهائر")


# ---------------------------------------------------------------- التحقق ببنك الأسئلة
BANK_ALIAS = {
    "doc": r"^ق\.ل\.ع|قانون الالتزامات والعقود", "commerce": r"مدونة التجارة", "real_rights": r"39\.08", "family": r"مدونة الأسرة",
    "civil_proc": r"58\.25|المسطرة المدنية", "criminal_proc": r"المسطرة الجنائية|ق\.م\.ج|م\.م\.ج", "labour": r"مدونة الشغل",
    "criminal": r"مجموعة القانون الجنائي|^القانون الجنائي", "constitution": r"دستور", "judicial_org": r"38\.15", "sa": r"17\.95",
    "companies_other": r"5\.96", "civil_service": r"1958|1\.58\.008", "copropriety": r"18\.00", "land_registry": r"التحفيظ العقاري",
    "admin_courts": r"41\.90", "proximity_courts": r"42\.10", "commercial_lease": r"49\.16", "residential_lease": r"67\.12",
    "kafala": r"15\.01", "work_accidents": r"18\.12", "domestic_work": r"19\.12", "consumer": r"31\.08", "insurance": r"17\.99|التأمينات",
    "personal_data": r"09\.08", "access_info": r"31\.13", "adoul_plan": r"16\.03|خطة العدالة", "credit": r"103\.12", "awqaf": r"الأوقاف",
    "deconcentration": r"2\.17\.618|اللاتمركز", "admin_appeal": r"80\.03", "simplification": r"55\.19", "civil_status": r"36\.21",
    "strike": r"97\.15", "adoul": r"051\.26",
}


# كيف يُذكر كل قانون في سؤال المستخدم (يُطابَق على نص مُطبَّع: الهمزات ألفاً، والتشكيل محذوف) — للبحث الدقيق «المادة N من …»
USER_ALIAS = {
    "doc": r"الالتزامات والعقود|ق\.?\s?ل\.?\s?ع|code des obligations|\bdoc\b",
    "commerce": r"مدونة التجارة|القانون التجاري|15\.95|code de commerce",
    "real_rights": r"الحقوق العينية|39\.08|droits r[ée]els",
    "family": r"مدونة الاسرة|قانون الاسرة|70\.03|code de la famille|moudawana",
    "civil_proc": r"المسطرة المدنية|ق\.?\s?م\.?\s?م|58\.25|proc[ée]dure civile",
    "criminal_proc": r"المسطرة الجنائية|ق\.?\s?م\.?\s?ج|22\.01|03\.23|proc[ée]dure p[ée]nale",
    "labour": r"مدونة الشغل|قانون الشغل|65\.99|code du travail",
    "criminal": r"القانون الجنائي|ق\.?\s?ج\b|code p[ée]nal",
    "constitution": r"الدستور|دستور|constitution",
    "judicial_org": r"التنظيم القضائي|38\.15|organisation judiciaire",
    "companies_other": r"5\.96|شركة التضامن|شركة التوصية|ذات المسؤولية المحدودة|شركة المحاصة|\bsarl\b",
    "civil_service": r"الوظيفة العمومية|النظام الاساسي العام|fonction publique",
    "copropriety": r"الملكية المشتركة|18\.00|copropri[ée]t[ée]",
    "land_registry": r"التحفيظ العقاري|immatriculation fonci[èe]re",
    "admin_courts": r"المحاكم الادارية|41\.90|tribunaux administratifs",
    "proximity_courts": r"قضاء القرب|42\.10|juridictions de proximit[ée]",
    "commercial_lease": r"الكراء التجاري|49\.16|bail commercial",
    "residential_lease": r"67\.12|المعدة للسكنى|الكراء السكني|bail d.habitation",
    "domestic_work": r"المنزليين|المنزليات|العمل المنزلي|العمال المنزلي|19\.12|travail domestique",
    "personal_data": r"المعطيات ذات الطابع الشخصي|المعطيات الشخصية|09\.08|donn[ée]es personnelles",
    "access_info": r"الحصول على المعلومات|31\.13|acc[èe]s [àa] l.information",
    "credit": r"مؤسسات الائتمان|103\.12|القانون البنكي|[ée]tablissements de cr[ée]dit",
    "awqaf": r"الاوقاف|الوقف|الحبس|الاحباس|habous|waqf",
    "admin_appeal": r"محاكم الاستئناف الادارية|80\.03",
    "civil_status": r"الحالة المدنية|36\.21|[ée]tat civil",
    "strike": r"الاضراب|97\.15|gr[èe]ve",
    "adoul": r"العدول|خطة العدالة|\badoul\b",
}


def bank_refs():
    import glob
    out = collections.defaultdict(collections.Counter)
    files = [ROOT / "data" / "questions.json"] + sorted(pathlib.Path(p) for p in glob.glob(str(ROOT / "data" / "batch-*.json")))
    for f in files:
        for q in json.loads(f.read_text(encoding="utf-8"))["questions"]:
            src = q.get("source") or {}
            if q.get("src") != "text" or "اجتهاد" in src.get("law", ""):
                continue
            ref = src.get("ref", "").translate(DIG)
            if not re.search(r"(المادة|المادتان|المادتين|المواد|الفصل|الفصلان|الفصلين|الفصول)", ref):
                continue
            nums = []
            for m in re.finditer(r"(?<![\d.])(\d{1,4}(?:-\d{1,3})*)(?![\d.])(\s*مكرر(?:ة)?(?:\s*مرتين)?)?", ref):
                tok, parts = m.group(1), m.group(1).split("-")
                if len(parts) == 2 and int(parts[1]) > int(parts[0]):
                    nums += parts
                elif not (len(parts) == 1 and int(parts[0]) > 1300):
                    nums.append(tok + ((" مكرر مرتين" if "مرتين" in m.group(2) else " مكرر") if m.group(2) else ""))
            for slug, rx in BANK_ALIAS.items():
                if re.search(rx, src.get("law", "")):
                    out[slug].update(n.lstrip("0") or "0" for n in nums)
    return out


def check(law, refs):
    have = {a["n"] for a in law["articles"]}
    cited = refs.get(law["slug"], collections.Counter())
    miss = sorted(n for n in cited if n not in have)
    bases = {a["_key"][0] for a in law["articles"]}
    top = max(bases) if bases else 0
    gaps = [b for b in range(1, top + 1) if b not in bases]
    lens = [len(a["text"]) for a in law["articles"]] or [0]
    return {"articles": len(law["articles"]), "cited": len(cited), "missing": miss,
            "coverage": round(1 - len(miss) / len(cited), 4) if cited else None,
            "gaps": gaps, "gap_rate": round(len(gaps) / max(1, top), 4), "longest": max(lens)}


GATES = dict(coverage=0.95, gap_rate=0.10, garbled=0.002, unknown=0.10, longest=12000)


def verdict(chk, q, meta=None, law=None):
    meta = meta or {}
    why = []
    if law and law.get("ocr"):
        why.append("النص المتاح مستخرج بالتعرف الضوئي على صور الصفحات، وفيه أخطاء حرفية لا تصلح للاستشهاد")
    if chk["articles"] < 5:
        why.append("لم تُستخرج مواده")
    if chk["coverage"] is not None and chk["cited"] >= 10 and chk["coverage"] < GATES["coverage"]:
        why.append(f"تغطية مراجع البنك {chk['coverage']:.0%}")
    if chk["gap_rate"] > GATES["gap_rate"] and not meta.get("gaps_ok"):
        why.append(f"ثغرات في الترقيم {chk['gap_rate']:.0%}")
    if q["garbled"] > GATES["garbled"] * max(1, q["tokens"]):
        why.append(f"حروف مشوهة ({q['garbled']})")
    if q["unknown"] > GATES["unknown"]:
        why.append(f"كلمات غير معروفة {q['unknown']:.0%}")
    if chk["longest"] > GATES["longest"]:
        why.append(f"مادة طولها {chk['longest']} حرفاً (عناوين ضائعة)")
    return why


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--show", default="")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    cands, errs = {}, {}
    for s in SOURCES:
        if only and s[1] not in only:
            continue
        outs, e = build(s)
        if outs:
            cands[s[1]] = (s, outs)
        else:
            errs[s[1]] = "؛ ".join(e)
    # المعجم من القوانين المستخرجة بحروف سليمة ومن نص بنك الأسئلة، دون ما فيه حروف بلا خريطة
    lexicon_from([l for slug, (_, outs) in cands.items() for l in outs[:1] if slug in LEX_SOURCES])
    for k in [k for k, c in LEX.items() if "\ufffd" in k]:
        del LEX[k]
    # كم قانوناً ترد فيه الكلمة: مفردة قانون خاص تُعرف إن وردت في قانون آخر، والكلمة المشوهة لا ترد إلا في ملفها
    VOCAB.clear()
    for slug, (_, outs) in cands.items():
        RAW[slug] = {t for l in outs for a in l["articles"] for t in TOK.findall(a["text"])}
        VOCAB.update(RAW[slug])
    refs = bank_refs()
    laws, before = [], {}
    for slug, (s, outs) in cands.items():
        scored = []
        QUIRKS.clear()
        QUIRKS.update(s[6].get("quirks", ()))
        CUR.clear()
        CUR.update(t for l in outs[:1] for a in l["articles"] for t in TOK.findall(a["text"]))
        for l in outs:
            b = quality(l)
            for art in l["articles"]:
                art["text"] = repair(art["text"])
                art["path"] = repair(art["path"])
                if art.get("notes"):
                    art["notes"] = [x for x in (repair(x).strip() for x in art["notes"]) if x and NOTE_KEEP.search(x)]
                    if not art["notes"]:
                        del art["notes"]
            q, chk = quality(l), check(l, refs)
            why = verdict(chk, q, s[6], l)
            score = (not why, chk["coverage"] if chk["coverage"] is not None else 1.0, -q["garbled"] / max(1, q["tokens"]),
                     -q["unknown"], -chk["gap_rate"], chk["articles"])
            scored.append((score, l, b))
        scored.sort(key=lambda x: x[0], reverse=True)
        if a.show and slug in a.show.split(","):
            for sc, l, _ in scored:
                print(f"      مرشح {l['how']}:{l['source'][:30]}{' (عمودان)' if l['opt'].get('cols') else ''}: {len(l['articles'])} مادة، "
                      f"سليم={sc[0]} تغطية={sc[1]} مجهول={-sc[3]:.3f} ثغرات={-sc[4]:.3f}")
        best = scored[0]
        laws.append(best[1])
        before[slug] = best[2]
        if len(scored) > 1:
            print(f"   {slug}: اختير {best[1]['how']}:{best[1]['source'][:40]}{' (عمودان)' if best[1]['opt'].get('cols') else ''} من {len(scored)} مرشحين")
    report = []
    for l in laws:
        s = cands[l["slug"]][0]
        q, chk = quality(l), check(l, refs)
        why = verdict(chk, q, s[6], l)
        report.append((l, q, chk, why))
        cov = f"{chk['coverage']:.1%}" if chk["coverage"] is not None else "—"
        print(f"{'✓' if not why else '✗'} {l['slug']:<18} {chk['articles']:>4} مادة · تغطية {cov:>6} ({chk['cited']}) · ثغرات {chk['gap_rate']:.1%} · "
              f"مجهول {before[l['slug']]['unknown']:.1%}→{q['unknown']:.1%} · مشوه {before[l['slug']]['garbled']}→{q['garbled']} · الأطول {chk['longest']}"
              + (f"  ← {'؛ '.join(why)}" if why else ""))
        if a.show and l["slug"] in a.show.split(","):
            for art in l["articles"][:: max(1, len(l["articles"]) // 4)][:4]:
                print(f"      [{art['label']}] {art['text'][:300]}")
    for k, e in errs.items():
        print(f"✗ {k:<18} {e}")
    if a.write:
        write(report)


def write(report):
    OUT.mkdir(parents=True, exist_ok=True)
    reg = json.loads((ROOT / "data" / "laws.json").read_text(encoding="utf-8"))["laws"]
    index = {"note": "مكتبة النصوص التي يجيب منها «المساعد». يولّدها tools/build_corpus.py من ملفات القوانين التي رفعها المؤلف، "
                     "ولا يدخلها إلا نص اجتاز الفحوص (تغطية مراجع بنك الأسئلة، وتسلسل الأرقام، وسلامة الحروف).",
             "built": __import__("datetime").date.today().isoformat(), "laws": [], "excluded": []}
    for old in OUT.glob("*.json"):
        old.unlink()
    for l, q, chk, why in report:
        r = reg.get(l["key"]) or {}
        held = r.get("held") or {}
        stale = [am for am in (r.get("amendments") or [])
                 if held.get("consolidated") and am.get("date") and am["date"] > held["consolidated"]]
        meta = {"slug": l["slug"], "key": l["key"], "title": l["title"], "branch": l["branch"], "word": l["word"],
                "match": USER_ALIAS.get(l["slug"], ""), "bank": BANK_ALIAS.get(l["slug"], ""),
                "source": l["source"], "sha": l["sha"], "consolidated": held.get("consolidated"),
                "stale": [{"law": am.get("law"), "date": am.get("date"), "scope": am.get("scope")} for am in stale],
                "articles": chk["articles"], "coverage": chk["coverage"], "cited": chk["cited"]}
        if why:
            index["excluded"].append({**meta, "why": why})
            continue
        arts = [{"n": x["n"], "label": x["label"], "path": x["path"], "text": x["text"], **({"notes": x["notes"]} if x.get("notes") else {})}
                for x in l["articles"]]
        (OUT / f"{l['slug']}.json").write_text(json.dumps({**meta, "items": arts}, ensure_ascii=False, indent=0), encoding="utf-8")
        index["laws"].append(meta)
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nكُتب {len(index['laws'])} قانوناً في data/corpus/ · استُبعد {len(index['excluded'])}")


if __name__ == "__main__":
    main()
