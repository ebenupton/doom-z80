#!/usr/bin/env python3
"""Build the viewpoint set the BBC port's baseline.json measures."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ref
md = ref.load_from_reference()
base = json.load(open(os.environ.get("DOOM_BBC_REF", "/tmp/doom_bbc_ref") + "/baseline.json"))
out = []
for key in base["cycles"]:
    xs, ys, angs = key.split(",")
    x, y, ang = float(xs), float(ys), int(angs)
    px88 = int((x - md.map_center[0]) * 256 / md.prescale)
    py88 = int((y - md.map_center[1]) * 256 / md.prescale)
    vz = md._dw._prescale_height(md._dw.player_floor(x, y) + 41)
    out.append({"key": key, "px88": px88, "py88": py88, "ang": ang, "vz": vz,
                "wx": int(x), "wy": int(y),
                "px_int": px88 >> 8, "px_f": px88 & 0xff,
                "py_int": py88 >> 8, "py_f": py88 & 0xff})
json.dump(out, open("build/parity.json", "w"))
print(f"{len(out)} viewpoints")
