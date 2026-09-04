#!/usr/bin/env python3
"""Emit expected values for the Z80 view/projection unit tests."""
import os, sys, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ref
from fp import _sin_mag_sign, fp_recip, fp_project_x, fp_project_y

random.seed(11)
out = {}

out["sincos"] = []
for a in range(256):
    m, neg, u = _sin_mag_sign(a)
    out["sincos"].append([m, 1 if neg else 0, 1 if u else 0])

# view contexts and vertex transforms
ctxs = []
angles = list(range(0, 256, 7)) + [0, 63, 64, 65, 127, 128, 191, 192, 255, 62, 66]
for ang in angles:
    px88 = random.randint(-80000, 80000)
    py88 = random.randint(-80000, 80000)
    ctx = ref.view_context(px88, py88, ang, 6)
    pts = []
    for _ in range(24):
        wx = random.randint(-330, 330)
        wy = random.randint(-330, 330)
        tvx, tvy = ref.to_view(wx, wy, ctx)
        pts.append([wx, wy, tvx, tvy])
    ctxs.append({"px88": px88, "py88": py88, "ang": ang,
                 "px_int": px88 >> 8, "px_f": px88 & 0xff,
                 "py_int": py88 >> 8, "py_f": py88 & 0xff,
                 "rx": ctx.rx, "ry": ctx.ry, "pts": pts})
out["ctx"] = ctxs

out["recip"] = []
for tvy in list(range(2, 400)) + [512, 1000, 4000, 9000, 16000, 32000, 17, 16, 31, 32]:
    m, s = fp_recip(max(2, tvy >> 4))
    out["recip"].append([tvy, m, s])

out["projy"] = []
for _ in range(400):
    h = random.randint(-60, 60)
    tvy = random.randint(32, 20000)
    m, s = fp_recip(max(2, tvy >> 4))
    out["projy"].append([h, m, s, fp_project_y(h, m, s)])

out["projx"] = []
for _ in range(600):
    tvx = random.randint(-20000, 20000)
    tvy = random.randint(32, 20000)
    m, s = fp_recip(max(2, tvy >> 4))
    X88 = tvx << 3
    v = fp_project_x(X88 >> 8, X88 & 0xff, m, s)
    out["projx"].append([tvx, m, s, max(-32768, min(32767, v))])

json.dump(out, open("build/vec.json", "w"))
print("ctx", len(ctxs), "recip", len(out["recip"]), "projx", len(out["projx"]))
