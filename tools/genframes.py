#!/usr/bin/env python3
"""Emit the expected draw calls for the Z80 frame-level test, from the BBC
port's own model (tools/oracle.py): the Z80 is to match it pixel for pixel."""
import os, sys, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
import ref
sys.path.insert(0, oracle.REF_DIR)
import nj_raster


def nj_bitmap(calls):
    """The BBC port's rasteriser over the draw calls, as 32-byte rows."""
    fb = nj_raster.new_fb()
    for (x1, y1, x2, y2) in calls:
        nj_raster.draw_line(fb, x1, y1, x2, y2)
    out = bytearray(160 * 32)
    for y in range(160):
        for xb in range(32):
            out[y * 32 + xb] = fb[((y >> 3) << 8) + xb * 8 + (y & 7)]
    return bytes(out)

dw = oracle.dw
md = ref.load_from_reference()
sx, sy, sa = oracle.start_pos()
out = []
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
    calls, fb = oracle.render(px, py, ang)
    tr = dw.map_trace
    out.append({
        "px88": px88, "py88": py88, "ang": ang, "vz": z,
        "wx": int(px), "wy": int(py),
        "px_int": px88 >> 8, "px_f": px88 & 0xff,
        "py_int": py88 >> 8, "py_f": py88 & 0xff,
        "lines": [list(c) for c in calls],
        "bitmap": nj_bitmap(calls).hex(),
        "nodes": len(tr["nodes_visited"]), "ss": len(tr["subsectors"]),
        "segs": len(tr["segs_drawn"]), "segs_processed": len(tr["segs_processed"]),
    })
json.dump(out, open("build/frames.json", "w"))
print(f"{len(out)} frames, avg {sum(len(f['lines']) for f in out)/len(out):.1f} lines")
