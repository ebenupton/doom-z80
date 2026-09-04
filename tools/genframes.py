#!/usr/bin/env python3
"""Emit expected display lists for the Z80 frame-level test."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ref

md = ref.load_from_reference()
sx, sy, sa, eye = md.start
vz = md._dw._prescale_height(eye)
r = ref.Renderer(md)
out = []
import random, os
N = int(os.environ.get("NFRAMES", "40"))
cases = [(sx, sy, a) for a in range(0, 256, 8)]
random.seed(3)
while len(cases) < N:
    cases.append((sx + random.randint(-700, 700), sy + random.randint(-700, 700),
                  random.randint(0, 255)))
cases = cases[:N]
for (px, py, ang) in cases:
    px88 = int((px - md.map_center[0]) * 256 / md.prescale)
    py88 = int((py - md.map_center[1]) * 256 / md.prescale)
    z = md._dw._prescale_height(md._dw.player_floor(px, py) + 41)
    lines = r.render(px88, py88, ang, z, int(px), int(py))
    out.append({
        "px88": px88, "py88": py88, "ang": ang, "vz": z,
        "wx": int(px), "wy": int(py),
        "px_int": px88 >> 8, "px_f": px88 & 0xff,
        "py_int": py88 >> 8, "py_f": py88 & 0xff,
        "lines": lines,
        "nodes": r.nodes_visited, "ss": r.ss_visited, "segs": r.segs_drawn,
    })
json.dump(out, open("build/frames.json", "w"))
print(f"{len(out)} frames, avg {sum(len(f['lines']) for f in out)/len(out):.1f} lines")
