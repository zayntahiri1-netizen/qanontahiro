#!/usr/bin/env python3
"""يصلح طبقة النص في ملفات PDF التي تفسد فيها خرائط ToUnicode، فيخرج النص منها حروفاً مُبدلة أو ناقصة.

علتان رأيناهما في ملفات القوانين المرفوعة:
  • «font»: علة Word 2010 مع خط Times New Roman: الخريطة مدى متزايد على أشكال الحرف الواحد (أول الكلمة ووسطها وآخرها)،
    فتصير «إحداث الوكالة الوطنية» «إحذاث الىكالة الىطنٍة»، وتصير الأرقام 58.00 «36.55». العلاج من الخط المضمَّن نفسه:
    جدول cmap فيه يربط كل شكل بحرفه الصحيح (FExx)، فنعيد بناء الخريطة منه ثم نرد الأشكال إلى حروفها (NFKC).
  • «map»: خطوط Sakkal Majalla مقتطعة بلا جدول cmap، وخريطتها تغفل الأشكال البديلة (تر، لخ، في، ني…)، فتسقط حروف من الكلمات.
    العلاج خريطة صريحة لتلك الأشكال (رقم الشكل ← حروفه) تُستخرج مرة واحدة بمحاذاة طبقة النص مع التعرف الضوئي للصفحات
    ثم تُراجع بالعين على صور الأشكال نفسها، وتُحفظ مع مصدرها في tools/build_corpus.py.

الاستعمال:  python3 tools/fix_tounicode.py in.pdf out.pdf      (الوضع font)
"""
import collections
import io
import re
import sys
import unicodedata


def parse_tu(tu):
    """خريطة ToUnicode ← {رقم الشكل: النص}."""
    m = {}

    def hx(s):
        return bytes.fromhex(s).decode("utf-16-be", errors="replace")

    for blk in re.findall(r"beginbfchar(.*?)endbfchar", tu, re.S):
        for a, b in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
            m[int(a, 16)] = hx(b)
    for blk in re.findall(r"beginbfrange(.*?)endbfrange", tu, re.S):
        for a, b, arr, c in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[([^\]]*)\]|<([0-9A-Fa-f]+)>)", blk):
            lo, hi = int(a, 16), int(b, 16)
            if arr:
                for k, d in zip(range(lo, hi + 1), re.findall(r"<([0-9A-Fa-f]+)>", arr)):
                    m[k] = hx(d)
            else:
                s = hx(c)
                for k in range(lo, hi + 1):
                    last = ord(s[-1]) + k - lo
                    if last < 0x110000:
                        m[k] = s[:-1] + chr(last)
    return m


def build_tu(m):
    items = sorted(m.items())
    out = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
           "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
           "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
           "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"]
    for i in range(0, len(items), 100):
        ch = items[i:i + 100]
        out.append(f"{len(ch)} beginbfchar")
        out += [f"<{k:04X}> <{v.encode('utf-16-be').hex().upper()}>" for k, v in ch]
        out.append("endbfchar")
    out += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    return "\n".join(out).encode("latin1")


def _type0_fonts(pdf):
    done = set()
    for page in pdf.pages:
        res = page.get("/Resources")
        if res is None or "/Font" not in res:
            continue
        for _, f in res.Font.items():
            if f.get("/Subtype") != "/Type0" or f.objgen in done:
                continue
            done.add(f.objgen)
            yield f


def family(f):
    """اسم عائلة الخط بلا بادئة الاقتطاع ولا الوزن: «EPCEML+SakkalMajalla,Bold» ← «SakkalMajalla»."""
    return str(f.get("/BaseFont", "")).lstrip("/").split("+")[-1].split(",")[0].split("-")[0]


def fix_pdf(src, dst, mode="font", cidmap=None, families=None):
    """ينسخ src إلى dst بخرائط ToUnicode مصححة، ويعيد إحصاء ما صُحح."""
    import pikepdf
    from fontTools.ttLib import TTFont
    pdf = pikepdf.open(str(src))
    stats = collections.Counter()
    fonts = list(_type0_fonts(pdf))
    if mode == "map":
        union = collections.defaultdict(dict)
        for f in fonts:
            if "/ToUnicode" in f:
                union[family(f)].update(parse_tu(f.ToUnicode.read_bytes().decode("latin1")))
        for f in fonts:
            fam = family(f)
            if families and fam not in families:
                continue
            new = dict(union[fam])
            for cid, txt in (cidmap or {}).items():
                if int(cid) not in new:
                    new[int(cid)] = txt
                    stats["mapped"] += 1
            f.ToUnicode = pdf.make_stream(build_tu(new))
    else:
        for f in fonts:
            if "/ToUnicode" not in f:
                continue
            d = f.DescendantFonts[0]
            fd = d.get("/FontDescriptor")
            if fd is None or "/FontFile2" not in fd:
                continue
            tt = TTFont(io.BytesIO(fd.FontFile2.read_bytes()))
            if "cmap" not in tt:
                continue
            g2u = collections.defaultdict(set)
            for t in tt["cmap"].tables:
                if t.isUnicode():
                    for u, g in t.cmap.items():
                        g2u[tt.getGlyphID(g)].add(u)
            c2g = d.get("/CIDToGIDMap")
            raw = c2g.read_bytes() if isinstance(c2g, pikepdf.Stream) else None
            m = parse_tu(f.ToUnicode.read_bytes().decode("latin1"))
            new = {}
            for cid, u in m.items():
                g = int.from_bytes(raw[2 * cid:2 * cid + 2], "big") if raw else cid
                us = g2u.get(g)
                nu = unicodedata.normalize("NFKC", u)
                if not us:
                    new[cid] = u
                    stats["kept"] += 1
                    continue
                forms = {unicodedata.normalize("NFKC", chr(x)) for x in us}
                if nu in forms:
                    new[cid] = nu
                    stats["ok"] += 1
                else:
                    new[cid] = sorted(forms, key=lambda s: (len(s) != len(nu), s))[0]
                    stats["fixed"] += 1
            f.ToUnicode = pdf.make_stream(build_tu(new))
    pdf.save(str(dst), deterministic_id=True)
    return dict(stats)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(fix_pdf(sys.argv[1], sys.argv[2]))
