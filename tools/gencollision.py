#!/usr/bin/env python3
"""Regenerate test/collision_gold.json: colmap.box_blocked over a grid, the
golden for test/collision.test.js (the Z80 box_clear must match it)."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ref
ref.load_from_reference()
import colmap
out = []
for qx in range(-244, 245, 6):
    for qy in range(-244, 245, 6):
        out.append([qx, qy, 1 if colmap.box_blocked(qx * 8, qy * 8) else 0])
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "collision_gold.json")
open(p, "w").write(json.dumps(out))
print(f"{p}: {len(out)} points, {sum(x[2] for x in out)} blocked")
