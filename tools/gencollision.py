#!/usr/bin/env python3
"""Regenerate test/collision_gold.json: colmap.box_blocked over a grid, the
golden for test/collision.test.js (the Z80 box_clear must match it)."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ref
ref.load_from_reference()
import colmap
m = colmap.build()
# box_scan (walls + door/step ports) verdict over a grid of moves; the Z80
# box_clear must match this bit-for-bit (test/collision.test.js).
sgn = lambda v: v - 256 if v >= 128 else v
ssvz = m["ss_vz"]
deltas = [(16,0),(0,16),(22,22),(-16,-16)]
out = []
for qx in range(-244, 245, 12):
    for qy in range(-244, 245, 12):
        rx, ry = qx*8, qy*8
        if colmap.box_blocked(rx, ry): continue
        z = sgn(ssvz[colmap.find_ss(rx, ry)])
        for ddx, ddy in deltas:
            blocked, _ = colmap.box_scan(rx+ddx, ry+ddy, z, [0]*6)
            out.append([rx, ry, ddx, ddy, z & 0xff, 1 if blocked else 0])
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "collision_gold.json")
open(p, "w").write(json.dumps(out))
print(f"{p}: {len(out)} cases, {sum(x[5] for x in out)} blocked")
