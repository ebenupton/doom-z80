#!/usr/bin/env python3
"""Golden frames from the BBC port's REAL 6502 engine, run under py65
(banked_bsp.BankedBspRender): the Beeb's own pixels and plotted lines.

Writes build/frames.json in the layout test/frame.test.js reads.  The pure-
Python model (tools/genframes.py) is kept for op-level tracing, but the
Spectrum port is to match THIS output pixel for pixel."""
import os, sys, json, random, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
dw = oracle.dw
import ref
os.chdir(oracle.REF_DIR)
import pygame
from banked_bsp import BankedBspRender

md = ref.load_from_reference()
N = int(os.environ.get("NFRAMES", "40"))
random.seed(3)                             # the same viewpoints as genframes.py
sx, sy, sa = oracle.start_pos()
cases = [(sx, sy, (sa + k * 8) & 0xff) for k in range(32)]
while len(cases) < N:
    cases.append((sx + random.randint(-700, 700), sy + random.randint(-700, 700),
                  random.randint(0, 255)))
cases = cases[:N]
if os.environ.get("PARITY"):            # the parity viewpoints instead
    cases = [(f["wx"] if f.get("px_frac") is None else f["wx"], f["wy"], f["ang"]) for f in []]
    cases = []
    for f in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "parity.json"))):
        px, py, ab = f["key"].split(",")
        cases.append((float(px), float(py), int(ab)))

r = BankedBspRender(dw.packed_layout, dw.packed_rom_main, dw.packed_rom_detail,
                    dw.packed_bbox_table, dw.MAP_CENTER_X, dw.MAP_CENTER_Y, dw.PRESCALE)
out = []
t0 = time.time()
for (px, py, ang) in cases:
    px88 = int((px - md.map_center[0]) * 256 / md.prescale)
    py88 = int((py - md.map_center[1]) * 256 / md.prescale)
    z = md._dw._prescale_height(md._dw.player_floor(px, py) + 41)
    fz = dw.player_floor(px, py)
    cyc = r.render_frame(px, py, ang, fz)
    assert r.sc.mpu.pc == 0xFF00, "6502 engine did not return"
    s = pygame.Surface((256, 160)); r.blit_framebuffer_to(s)
    out.append({
        "px88": px88, "py88": py88, "ang": ang, "vz": z,
        "wx": int(px), "wy": int(py), "fx": px, "fy": py,
        "px_int": px88 >> 8, "px_f": px88 & 0xff,
        "py_int": py88 >> 8, "py_f": py88 & 0xff,
        "lines": [list(l) for l in r.sc.last_lines],
        "bitmap": oracle.fb_to_bitmap(s).hex(),
        "cycles": cyc,
        "nodes": 0, "ss": 0, "segs": 0, "segs_processed": 0,
    })
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
json.dump(out, open(os.environ.get("OUT", "build/frames.json"), "w"))
print(f"{len(out)} frames from the 6502 in {time.time()-t0:.0f}s, "
      f"avg {sum(f['cycles'] for f in out)/len(out):.0f} cycles, avg {sum(len(f['lines']) for f in out)/len(out):.1f} lines")
