#!/usr/bin/env python3
"""Golden-model driver for the BBC Micro DOOM reference renderer.

The Spectrum port targets the same 256x160 fixed-point pipeline as the BBC
port, so that engine's bit-exact Python reference is usable directly as an
oracle: given (px, py, angle_byte) it yields the exact set of clipped line
segments the renderer should draw, and a 1bpp framebuffer.

Usage:
    oracle.py frame --x 1056 --y -3616 --angle 0 --out golden.json
    oracle.py sweep --n 32 --out corpus.json
"""
import os, sys, json, math, argparse

REF_DIR = os.environ.get("DOOM_BBC_REF", "/tmp/doom_bbc_ref")

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
os.environ.setdefault("DOOM_ANIM", "0")   # static geometry for the base oracle

_saved_cwd = os.getcwd()
sys.path.insert(0, REF_DIR)
os.chdir(REF_DIR)

import pygame  # noqa: E402
import doom_wireframe as dw  # noqa: E402
from endpoint_spans import EndpointClipSpans  # noqa: E402

os.chdir(_saved_cwd)

FB_W, FB_H = dw.FP_RENDER_W, dw.FP_RENDER_H   # 256 x 160

_calls = []
_real_line = dw._real_drawline


def _record_line(surface, color, p1, p2, w=1):
    _calls.append((int(p1[0]), int(p1[1]), int(p2[0]), int(p2[1])))
    return _real_line(surface, color, p1, p2, w)


class FastFixedSpans(EndpointClipSpans):
    def draw_clipped(self, lines, color, surface, stats=None, roles=None):
        super().draw_clipped(lines, color, surface, stats)


def _reset_trace():
    for k in dw.map_trace:
        if k == "vertex_muls":
            dw.map_trace[k] = {}
        elif k == "ss_order":
            dw.map_trace[k] = []
        else:
            dw.map_trace[k] = set()


def render(px, py, angle_byte):
    """Render one frame; returns (draw_calls, framebuffer_surface)."""
    global _calls
    _calls = []
    dw.fp_module.mul_reset()
    pygame.draw.line = _record_line

    px_88 = int((px - dw.MAP_CENTER_X) * 256 / dw.PRESCALE)
    py_88 = int((py - dw.MAP_CENTER_Y) * 256 / dw.PRESCALE)
    vz_ps = dw._prescale_height(dw.player_floor(px, py) + 41)
    ctx = dw.fp_view_context(px_88, py_88, dw.fp_sincos(angle_byte))
    ang_rad = angle_byte * 2 * math.pi / 256
    cos_f, sin_f = math.cos(ang_rad), math.sin(ang_rad)

    _reset_trace()
    fb = pygame.Surface((FB_W, FB_H))
    fb.fill((0, 0, 0))
    dw.render_bsp_fp(len(dw.nodes) - 1, FastFixedSpans(), ctx, vz_ps,
                     int(px), int(py), cos_f, sin_f, fb,
                     [None] * len(dw.vertexes), [None] * len(dw.vwh_table))
    return list(_calls), fb


def fb_to_bitmap(fb):
    """Pack the 256x160 surface into 1bpp rows (32 bytes/row, MSB = leftmost)."""
    out = bytearray(FB_H * 32)
    px = pygame.surfarray.pixels3d(fb)
    for y in range(FB_H):
        for x in range(FB_W):
            if px[x][y][0] or px[x][y][1] or px[x][y][2]:
                out[y * 32 + (x >> 3)] |= 0x80 >> (x & 7)
    del px
    return bytes(out)


def start_pos():
    return float(dw.player_x), float(dw.player_y), int(round(dw.pangle * 256 / 360)) & 0xff


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("frame")
    f.add_argument("--x", type=float, default=None)
    f.add_argument("--y", type=float, default=None)
    f.add_argument("--angle", type=int, default=None)
    f.add_argument("--out", default=None)
    f.add_argument("--pgm", default=None)

    s = sub.add_parser("sweep")
    s.add_argument("--n", type=int, default=16)
    s.add_argument("--out", required=True)

    sub.add_parser("start")

    a = ap.parse_args()
    sx, sy, sa = start_pos()

    if a.cmd == "start":
        print(json.dumps({"x": sx, "y": sy, "angle": sa,
                          "map_center": [dw.MAP_CENTER_X, dw.MAP_CENTER_Y],
                          "prescale": dw.PRESCALE,
                          "nodes": len(dw.nodes), "segs": len(dw.segs),
                          "ssectors": len(dw.ssectors),
                          "vertexes": len(dw.vertexes),
                          "sectors": len(dw.sectors)}, indent=1))
        return

    if a.cmd == "frame":
        px = sx if a.x is None else a.x
        py = sy if a.y is None else a.y
        ang = sa if a.angle is None else a.angle
        calls, fb = render(px, py, ang)
        bm = fb_to_bitmap(fb)
        rec = {"x": px, "y": py, "angle": ang, "calls": calls,
               "bitmap": bm.hex(), "w": FB_W, "h": FB_H}
        if a.out:
            with open(a.out, "w") as fh:
                json.dump(rec, fh)
        if a.pgm:
            with open(a.pgm, "wb") as fh:
                fh.write(b"P5\n%d %d\n255\n" % (FB_W, FB_H))
                for y in range(FB_H):
                    fh.write(bytes(255 if (bm[y*32 + (x >> 3)] >> (7 - (x & 7))) & 1
                                   else 0 for x in range(FB_W)))
        print(f"x={px} y={py} ang={ang} lines={len(calls)} "
              f"pixels_set={sum(bin(b).count('1') for b in bm)}")
        return

    if a.cmd == "sweep":
        import random
        random.seed(7)
        out = []
        for i in range(a.n):
            ang = (i * 256 // a.n) & 0xff
            calls, fb = render(sx, sy, ang)
            out.append({"x": sx, "y": sy, "angle": ang, "calls": calls,
                        "bitmap": fb_to_bitmap(fb).hex()})
            print(f"[{i}] angle={ang} lines={len(calls)}")
        with open(a.out, "w") as fh:
            json.dump({"w": FB_W, "h": FB_H, "frames": out}, fh)


if __name__ == "__main__":
    main()
