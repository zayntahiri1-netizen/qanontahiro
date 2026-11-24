#!/usr/bin/env python3
"""قانون تاهيرو — يستخرج شارة التطبيق من صورة المؤلف (الشارة على خلفية بيضاء بإطار ملصق أبيض وظل)
ويحفظها شفافة الخلفية في resources/brand/qt-badge.png، وهي الأصل الذي تُولَّد منه كل الأيقونات:

    python3 tools/make-badge.py صورة-الشعار.jpg
    python3 tools/make-android-res.py && python3 tools/make-ios-res.py && python3 tools/make-pwa-icons.py

الطريقة: كل لون فاتح قليل التشبع متصل بحافة الصورة خلفية (الأبيض والإطار الأبيض والظل الرمادي)، وما بقي فهو الشارة؛
نأخذ أكبر جزء متصل منها ونسد ثقوبه (البياض داخل الشارة، كربطة القاضي، يبقى)، ثم نُنعّم الحافة نصف بكسل.
"""
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "resources" / "brand" / "qt-badge.png"


def extract(src):
    import cv2
    im = np.array(Image.open(src).convert("RGB")).astype(np.int16)
    H, W, _ = im.shape
    mx, mn = im.max(2), im.min(2)
    light = (mn > 200) & ((mx - mn) < 28)
    lab = cv2.connectedComponents(light.astype(np.uint8), connectivity=4)[1]
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = ~np.isin(lab, list(edge))
    n, lab2, st, _ = cv2.connectedComponentsWithStats(fg.astype(np.uint8), connectivity=8)
    k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    mask = (lab2 == k).astype(np.uint8)
    ff = mask.copy()
    cv2.floodFill(ff, np.zeros((H + 2, W + 2), np.uint8), (0, 0), 1)
    mask = mask | (1 - ff)
    x, y, w, h = cv2.boundingRect(mask)
    m = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 0.8)
    m = np.clip((m - 0.25) / 0.5, 0, 1)
    rgba = np.dstack([im.astype(np.uint8), (m * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA").crop((x, y, x + w, y + h))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    b = extract(sys.argv[1])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    b.save(OUT, optimize=True)
    print(f"✓ {OUT.relative_to(ROOT)}  {b.size[0]}×{b.size[1]}")
