#!/usr/bin/env python3
"""اختبار طفرات: يزرع خطأً من كل نوع ويتحقق أن فحص البناء يلتقطه.

الغرض: اختبارات الانحدار تحرس **البيانات**، وهذا يحرس **الحرّاس**. فحصٌ
يتقادم أو يُكسر بتعديل لاحق يبقى موجوداً في الكود ويوهم بالحماية وهو لا يحمي.
"""
import json, subprocess, shutil, pathlib, copy, sys

ROOT = pathlib.Path(__file__).parent.parent
TARGET = ROOT / "data" / "batch-36.json"
BACKUP = None

MUTS = {
    "حقل غير معرَّف":  lambda q: q.update({"zzz": 1}),
    "بلا علم ثقة":     lambda q: q.pop("conf", None),
    "بلا مموِّه عامل":  lambda q: q.update({"correct": [0, 1, 2]}),
    "جواب مُقسَّم":     lambda q: (q["options"].__setitem__(1, "بشرط أن يكون كذلك"),
                                 q.update({"correct": [0, 1]})),
    "بلا تعليل":       lambda q: q.update({"explain": ""}),
    "بلا مرجع":        lambda q: q.update({"source": {"law": "مدونة التجارة 15.95", "ref": ""}}),
    "قانون خارج السجل": lambda q: q.update({"source": {"law": "قانون وهمي 99.99", "ref": "المادة 1"}}),
    "معرّف مكرر":      lambda q: q.update({"id": "COM-001"}),
    "خيار مكرر":       lambda q: q["options"].__setitem__(1, q["options"][0]),
    "صعوبة خارج المدى": lambda q: q.update({"difficulty": 9}),
    "src غير مقبول":    lambda q: q.update({"src": "guess"}),
}

def build_output():
    return subprocess.run([sys.executable, "build.py"], cwd=ROOT,
                          capture_output=True, text=True).stdout

def check_prescription():
    """الوصفة يجب أن تعرض الرقم المطلق **والفارق النسبي** معاً.
    الرقم وحده يُضخّم فجوة عُشرية على بنك كبير، والنسبة وحدها لا تقول كم يلزم."""
    out = build_output()
    import re as _re
    m = _re.search(r"لبلوغ المستهدف بالإضافة وحدها → (.+)", out)
    if not m:
        return []                      # لا وصفة: كل البنود عند هدفها
    line = m.group(1)
    fails = []
    if "+" not in line:
        fails.append("الوصفة بلا رقم مطلق")
    if "%" not in line:
        fails.append("الوصفة بلا فارق نسبي — الرقم المطلق وحده يُضلّل على بنك كبير")
    return fails


def check_deviation_display():
    """الوصفة يجب أن تعرض الفارق النسبي مع الرقم المطلق.
    الرقم وحده يُضخّم فجوة عُشرية على بنك من الألف."""
    out = build_output()
    for line in out.splitlines():
        if "لبلوغ المستهدف" in line:
            return "%" in line
    return True   # لا وصفة معروضة = المزيج عند هدفه


def main():
    global BACKUP
    BACKUP = TARGET.read_text(encoding="utf-8")
    orig = json.loads(BACKUP)
    fails = []
    try:
        for lab, mut in MUTS.items():
            d = copy.deepcopy(orig)
            mut(d["questions"][0])
            TARGET.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
            out = build_output()
            caught = ("تنبيهات" in out and out.count("!") > 1) or "أخطاء" in out
            if not caught:
                fails.append(lab)
    finally:
        TARGET.write_text(BACKUP, encoding="utf-8")
        build_output()          # إعادة بناء المخرجات السليمة

    fails += check_prescription()
    if not check_deviation_display():
        fails.append("الوصفة تعرض الرقم المطلق بلا فارق نسبي")

    if fails:
        print("✗ فحوص لا تلتقط ما وُضعت له:")
        for f in fails:
            print("   ", f)
        sys.exit(1)
    print(f"✓ {len(MUTS)} فحصاً — كلها تلتقط الخطأ الذي وُضعت له")

if __name__ == "__main__":
    main()
