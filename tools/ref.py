#!/usr/bin/env python3
"""Bit-exact Python reference for the ZX Spectrum DOOM wireframe engine.

This is the contract the Z80 implementation must reproduce exactly. It shares
the BBC port's fixed-point primitives (fp.py) and its 256x160 raster geometry,
so frames can be eyeballed against that engine's output, but the seg pipeline
is the simpler per-seg-verticals scheme of RENDERING_ENGINE.md section 11
rather than the BBC port's vertex-span descriptor machinery.

Everything here is integer arithmetic in the formats the Z80 will use:
    s16 prescaled world coords, s8 sector heights, 0.8 slopes, 8.0 screen.
"""
import os, sys, math, json

REF_DIR = os.environ.get("DOOM_BBC_REF", "/tmp/doom_bbc_ref")
sys.path.insert(0, REF_DIR)

import fp as fpm  # noqa: E402
from fp import (m8, fp_mul8, fp_div8, fp_sincos, fp_recip, rns,   # noqa: E402
                fp_project_x, fp_project_y, _rot_int, _frac_rot_term,
                T16_NEAR_VERDICT, T16_NEAR_CROSS, fp_cross_t16)

W, H = 256, 160
HALF_W, HALF_H = 128, 80
NF_SUBSECTOR = 0x8000

# ---------------------------------------------------------------------------
# Map data
# ---------------------------------------------------------------------------

class MapData:
    """Prescaled, Z80-ready tables for one level."""
    __slots__ = ("vx", "vy", "sec_fh", "sec_ch", "segs", "ssectors", "nodes",
                 "map_center", "prescale", "start", "_dw",
                 "ss_sector", "sector_floor_world")


def load_from_reference(mapname="E1M1"):
    """Pull the derived tables out of the BBC port's loader.

    That module does the hard precomputation - dead-seg elimination,
    colinear merging, and the NOVT vertical-suppression analysis - so the
    Spectrum packer inherits all of it.
    """
    os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
    os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
    os.environ.setdefault("DOOM_ANIM", "0")
    cwd = os.getcwd()
    os.chdir(REF_DIR)
    import doom_wireframe as dw
    os.chdir(cwd)

    md = MapData()
    md.map_center = (dw.MAP_CENTER_X, dw.MAP_CENTER_Y)
    md.prescale = dw.PRESCALE
    md.vx = [v[0] for v in dw.fp_vertexes]
    md.vy = [v[1] for v in dw.fp_vertexes]
    md.sec_fh = [s[0] for s in dw.fp_sectors]
    md.sec_ch = [s[1] for s in dw.fp_sectors]

    md.segs = []
    for si, svwh in enumerate(dw.fp_segs_vwh):
        s = svwh[0]
        novt = dw._seg_novt_flags[si]
        back = svwh[2]
        md.segs.append({
            "v1": s[0], "v2": s[1],
            "front": svwh[1], "back": (-1 if back is None else back),
            "fh": svwh[3], "ch": svwh[4],
            "ldx": svwh[13], "ldy": svwh[14],
            "dir": s[4],
            "linedef_v1": dw.linedefs[s[3]][0],
            "no_vt1": bool(novt & dw._SF_NOVT1),
            "no_vt2": bool(novt & dw._SF_NOVT2),
        })

    # Back-face reference point: the linedef's first vertex, prescaled.
    # Keep the *rounded* prescaled coordinate so the whole test is s16.
    for sg in md.segs:
        rv = dw.vertexes[sg["linedef_v1"]]
        # the back-face reference point in prescaled 8.8, exactly as
        # fp_render_seg's _lx88/_ly88 (world * 32): integer part (floor)
        # and fraction, so the runtime test can be exact against the
        # player's own 8.8 position
        lx88 = (rv[0] - dw.MAP_CENTER_X) * 32
        ly88 = (rv[1] - dw.MAP_CENTER_Y) * 32
        sg["lx"], sg["lxf"] = lx88 >> 8, lx88 & 255
        sg["ly"], sg["lyf"] = ly88 >> 8, ly88 & 255

    md.ssectors = [(c, f) for (c, f) in dw.fp_ssectors]   # (count, first)

    # Which sector each subsector belongs to, taken from its first seg's front
    # side, plus each sector's raw floor height for the eye-height table.
    md.ss_sector = []
    for (cnt, first) in md.ssectors:
        md.ss_sector.append(dw.fp_segs_vwh[first][1])
    md.sector_floor_world = [s[0] for s in dw.sectors]

    md.nodes = []
    for n in dw.nodes:
        md.nodes.append({
            "x": n[0], "y": n[1], "dx": n[2], "dy": n[3],
            # DOOM bbox order is top, bottom, left, right
            "bbox": [(n[4], n[5], n[6], n[7]), (n[8], n[9], n[10], n[11])],
            "child": (n[12], n[13]),
        })
    # Prescale bboxes into the same space as the vertices, expanding outward so
    # the rounded box still contains the true one, then quantise to multiples
    # of four: the packed table stores quarter-prescale bytes, so the engine
    # only ever sees the quantised box and the reference must match it.
    import math as _m
    Q = 4
    for nd in md.nodes:
        nd["bboxp"] = []
        for (top, bot, left, right) in nd["bbox"]:
            ps = dw.PRESCALE
            t = -(-(top - dw.MAP_CENTER_Y) // ps)         # ceil
            b = (bot - dw.MAP_CENTER_Y) // ps             # floor
            l = (left - dw.MAP_CENTER_X) // ps            # floor
            rr = -(-(right - dw.MAP_CENTER_X) // ps)      # ceil
            nd["bboxp"].append((-(-t // Q) * Q, (b // Q) * Q,
                                (l // Q) * Q, -(-rr // Q) * Q))
        # Reduce the partition direction so the side test's multiplies stay
        # 8x16 rather than 16x16.
        g = _m.gcd(abs(nd["dx"]), abs(nd["dy"])) or 1
        nd["rdx"] = nd["dx"] // g
        nd["rdy"] = nd["dy"] // g

    md.start = (float(dw.player_x), float(dw.player_y),
                int(round(dw.pangle * 256 / 360)) & 0xff,
                dw.player_floor(dw.player_x, dw.player_y) + 41)
    md._dw = dw
    return md


# ---------------------------------------------------------------------------
# Linear boundary functions: (slope 0.8 signed, intercept 8.0 signed)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Trapezoid clip spans, in the BBC port's data model
#
# A span's two boundaries are two-point records - the y at each end of an
# anchor range covering the span - and a drawn line is the same thing, so a
# line that lies inside a span's aperture becomes that span's boundary by
# copying its record: nothing is evaluated and there is no slope, so there is
# no divide.  Evaluation, where it is needed, is one round-to-nearest lerp.
# Every y here is biased by Y_BIAS into a byte: the visible rows [0, 159] are
# [48, 207] and the band [0, 255] holds a line's excursions above and below;
# beyond it a line is a flat at 0 or 255, which every aperture is inside of.
# Column ranges are inclusive.
# ---------------------------------------------------------------------------

Y_BIAS = 48
VIS_LO, VIS_HI = Y_BIAS, Y_BIAS + H - 1


def interp(x, x0, y0, x1, y1):
    """Round-to-nearest lerp with |dy| and the offset unsigned, the BBC
    port's interp_store: exact at both ends."""
    if x1 == x0:
        return y0
    off, den = x - x0, x1 - x0
    if den < 0:
        off, den = -off, -den
    if y1 >= y0:
        return y0 + (off * (y1 - y0) + den // 2) // den
    return y0 - (off * (y0 - y1) + den // 2) // den


def interp_x(y, x0, y0, x1, y1):
    """The column where the line reaches y, the lerp with its axes swapped."""
    return interp(y, y0, x0, y1, x1)


def cross_col(a, b, d0, d1, dfn):
    """First column in [a, b] where the linear-ish difference dfn is >= 0,
    given its values d0 at a and d1 at b of opposite sign: one rounded
    divide, then the column is checked rather than trusted."""
    n0, n1 = abs(d0), abs(d1)
    den = n0 + n1
    num = (b - a) * n0
    if den > 255:                      # the Z80 divides by a byte
        num >>= 1
        den >>= 1
    xc = a + min(255, (num + den // 2) // den)
    xc = max(a, min(b, xc))
    if dfn(xc) < 0:
        if d0 < 0:                     # rising through zero
            xc += 1
            if xc > b:
                return None
        else:
            xc -= 1
            if xc < a:
                return None
    return xc


def ge_range(v0, v1, a, b, dfn):
    """The sub-interval of [a, b] where the difference is >= 0, from its
    values at the ends; empty comes back as (a+1, a)."""
    if v0 >= 0 and v1 >= 0:
        return a, b
    if v0 < 0 and v1 < 0:
        return a + 1, a
    xc = cross_col(a, b, v0, v1, dfn)
    if xc is None:
        return a + 1, a
    return (xc, b) if v0 < 0 else (a, xc)


class Line:
    """A drawn line, clipped to the screen columns and the y band: an
    in-band record (xa, ya, xb, yb) plus flats at 0 or 255 either side.
    `run` is the visible stretch being accumulated as the walk goes right:
    abutting visible pieces come out as one segment."""
    __slots__ = ("pieces", "run")

    def __init__(self, sx1, y1, sx2, y2):
        # sx1 < sx2; y biased s16
        self.run = None
        pieces = []
        if sx1 < 0:
            y1 = interp(0, sx1, y1, sx2, y2)
            sx1 = 0
        if sx2 > W - 1:
            y2 = interp(W - 1, sx1, y1, sx2, y2)
            sx2 = W - 1
        if sx1 > sx2:
            self.pieces = pieces
            return
        if y1 < 0 and y2 < 0:
            pieces.append((sx1, sx2, 0, 0, 0))
        elif y1 > 255 and y2 > 255:
            pieces.append((sx1, sx2, 255, 255, 255))
        else:
            if y1 < 0 or y1 > 255:
                tgt = 0 if y1 < 0 else 255
                cx = max(sx1, min(sx2, interp_x(tgt, sx1, y1, sx2, y2)))
                if cx > sx1:
                    pieces.append((sx1, cx - 1, tgt, tgt, tgt))
                sx1, y1 = cx, tgt
            right = None
            if y2 < 0 or y2 > 255:
                tgt = 0 if y2 < 0 else 255
                cx = max(sx1, min(sx2, interp_x(tgt, sx1, y1, sx2, y2)))
                if cx < sx2:
                    right = (cx + 1, sx2, tgt, tgt, tgt)
                sx2, y2 = cx, tgt
            pieces.append((sx1, sx2, y1, y2, None))
            if right is not None:
                pieces.append(right)
        self.pieces = pieces

    def at(self, x):
        for (xa, xb, ya, yb, flat) in self.pieces:
            if xa <= x <= xb:
                return ya if flat is not None else interp(x, xa, ya, xb, yb)
        raise ValueError("column outside the line")


class Span:
    __slots__ = ("xs", "xlast", "top", "bot", "ot", "it", "ob", "ib")

    def __init__(self, xs, xlast, top, bot):
        self.xs, self.xlast, self.top, self.bot = xs, xlast, top, bot
        # extremes over the anchor ranges, which cover the span: the
        # outer/inner top and outer/inner bottom
        self.ot, self.it = min(top[1], top[3]), max(top[1], top[3])
        self.ob, self.ib = max(bot[1], bot[3]), min(bot[1], bot[3])

    def top_at(self, x):
        return interp(x, *self.top)

    def bot_at(self, x):
        return interp(x, *self.bot)


TOP0 = (0, VIS_LO, W - 1, VIS_LO)
BOT0 = (0, VIS_HI, W - 1, VIS_HI)


class Spans:
    """Visible region as a sorted list of inclusive column ranges."""
    __slots__ = ("spans", "out")

    def __init__(self, out):
        self.spans = [Span(0, W - 1, TOP0, BOT0)]
        self.out = out

    def is_full(self):
        return not self.spans

    def has_gap(self, lo, hi):
        """Any live span overlapping the range: the BBC port's cheapened
        test, every live span being taken to have an aperture."""
        ilo, ihi = max(0, lo), min(W - 1, hi)
        if ilo > ihi:
            return False
        for s in self.spans:
            if s.xs > ihi:
                break
            if s.xlast >= ilo:
                return True
        return False

    # -- drawing ----------------------------------------------------------

    def _emit(self, x0, y0, x1, y1):
        self.out.append((x0, y0 - Y_BIAS, x1, y1 - Y_BIAS))

    def _run_add(self, ln, a, b, ya, yb):
        """[a, b] of the line is visible: continue the run being drawn if
        it abuts, else flush it and start another."""
        r = ln.run
        if r is not None and r[2] + 1 == a:
            ln.run = (r[0], r[1], b, yb)
            return
        self._run_flush(ln)
        ln.run = (a, ya, b, yb)

    def _run_flush(self, ln):
        r = ln.run
        if r is not None:
            self._emit(r[0], r[1], r[2], r[3])
            ln.run = None

    def draw_verticals(self, verts):
        for (x, ya, yb) in verts:
            self._draw_vertical(x, ya, yb)

    def _draw_vertical(self, x, ya, yb):
        if x < 0 or x >= W:
            return
        ya = max(0, min(255, ya + Y_BIAS))
        yb = max(0, min(255, yb + Y_BIAS))
        if ya > yb:
            ya, yb = yb, ya
        for s in self.spans:
            if s.xs > x:
                return
            if s.xlast < x:
                continue
            if yb < s.ot or ya > s.ob:
                return
            if ya >= s.it and yb <= s.ib:
                self._emit(x, ya, x, yb)
                return
            t, b = s.top_at(x), s.bot_at(x)
            if t >= b:
                return
            a2, b2 = max(ya, t), min(yb, b)
            if a2 <= b2:
                self._emit(x, a2, x, b2)
            return

    # -- one line against one span piece ------------------------------------

    def _verdicts(self, ln, s, a, b):
        """The line over [a, b] of span s as a list of (x0, x1, kind,
        extras): kind 'above' (over the top), 'below' (under the bottom) or
        'in' (inside the aperture, drawn), with the line's y at the ends
        for 'in' pieces.  The whole line's y range decides most of them
        without an evaluation."""
        out = []
        for (xa, xb, ya, yb, flat) in ln.pieces:
            p0, p1 = max(a, xa), min(b, xb)
            if p0 > p1:
                continue
            if flat is not None:
                out.append((p0, p1, 'above' if flat == 0 else 'below', None))
                continue
            ylo, yhi = min(ya, yb), max(ya, yb)
            if yhi < s.ot:
                out.append((p0, p1, 'above', None))
                continue
            if ylo > s.ob:
                out.append((p0, p1, 'below', None))
                continue
            if ylo >= s.it and yhi <= s.ib:
                y0 = ya if p0 == xa else interp(p0, xa, ya, xb, yb)
                y1 = yb if p1 == xb else interp(p1, xa, ya, xb, yb)
                out.append((p0, p1, 'in', (y0, y1)))
                continue
            out.extend(self._exact(ln, (xa, ya, xb, yb), s, p0, p1))
        return out

    def _exact(self, ln, rec, s, a, b):
        xa, ya_, xb, yb_ = rec
        lat = lambda x: interp(x, xa, ya_, xb, yb_)
        ya, yb = lat(a), lat(b)
        ta, tb = s.top_at(a), s.top_at(b)
        ba, bb = s.bot_at(a), s.bot_at(b)
        t0, t1 = ge_range(ya - ta, yb - tb, a, b, lambda x: lat(x) - s.top_at(x))
        b0, b1 = ge_range(ba - ya, bb - yb, a, b, lambda x: s.bot_at(x) - lat(x))
        r0, r1 = max(t0, b0), min(t1, b1)
        above = lambda x: x < t0 or x > t1
        out = []
        if r0 <= r1:
            if r0 > a:
                out.append((a, r0 - 1, 'above' if above(a) else 'below', None))
            y0 = ya if r0 == a else lat(r0)
            y1 = yb if r1 == b else lat(r1)
            # the drawn ends sit inside the aperture at those columns
            e0 = max(ta if r0 == a else s.top_at(r0), min(ba if r0 == a else s.bot_at(r0), y0))
            e1 = max(tb if r1 == b else s.top_at(r1), min(bb if r1 == b else s.bot_at(r1), y1))
            out.append((r0, r1, 'in', (y0, y1, e0, e1)))
            if r1 < b:
                out.append((r1 + 1, b, 'above' if above(b) else 'below', None))
        elif above(a) == above(b):
            out.append((a, b, 'above' if above(a) else 'below', None))
        else:
            c = max(a + 1, min(b, t0 if above(a) else b0))
            out.append((a, c - 1, 'above' if above(a) else 'below', None))
            out.append((c, b, 'above' if above(b) else 'below', None))
        return out

    def _draw_pieces(self, ln, pieces):
        for (x0, x1, kind, ys) in pieces:
            if kind == 'in':
                if len(ys) == 4:
                    self._run_flush(ln)
                    self._emit(x0, ys[2], x1, ys[3])
                else:
                    self._run_add(ln, x0, x1, ys[0], ys[1])
            else:
                self._run_flush(ln)

    def _draw_only(self, ln, s, a, b):
        self._draw_pieces(ln, self._verdicts(ln, s, a, b))

    def _apply(self, ln, s, a, b, side, emit):
        """The line as a new boundary of span s over [a, b]: the pieces
        that survive, with the line where it ran inside."""
        pieces = self._verdicts(ln, s, a, b)
        if emit:
            self._draw_pieces(ln, pieces)
        out = []
        for (x0, x1, kind, ys) in pieces:
            if kind == 'in':
                rec = (x0, ys[0], x1, ys[1])
                ns = Span(x0, x1, rec, s.bot) if side else Span(x0, x1, s.top, rec)
                if ns.it < ns.ib or ns.top_at(x0) < ns.bot_at(x0) or ns.top_at(x1) < ns.bot_at(x1):
                    out.append(ns)
            elif (kind == 'above') == side:
                out.append(Span(x0, x1, s.top, s.bot))     # the line never reached it
            # else the line ran past the far boundary: closed
        return out

    # -- occlusion updates -------------------------------------------------

    def _finish(self, new, lines):
        """Abutting pieces with the same boundaries coalesce."""
        self.spans = []
        for sp in new:
            if self.spans:
                p = self.spans[-1]
                if p.xlast + 1 == sp.xs and p.top == sp.top and p.bot == sp.bot:
                    p.xlast = sp.xlast
                    continue
            self.spans.append(sp)
        for ln in lines:
            self._run_flush(ln)

    def mark_solid(self, extra, lo, hi):
        """Draw a solid wall's edges and delete its columns, in one walk."""
        ilo, ihi = max(0, lo), min(W, hi) - 1
        if ilo > ihi:
            return
        new = []
        for s in self.spans:
            if s.xlast < ilo or s.xs > ihi:
                new.append(s)
                continue
            ox0, ox1 = max(s.xs, ilo), min(s.xlast, ihi)
            for ln in extra:
                self._draw_only(ln, s, ox0, ox1)
            if s.xs < ox0:
                new.append(Span(s.xs, ox0 - 1, s.top, s.bot))
            if s.xlast > ox1:
                new.append(Span(ox1 + 1, s.xlast, s.top, s.bot))
        self._finish(new, extra)

    def fuse_seg(self, tln, bln, x1, x2, emit_t, emit_b, extra):
        """Both of a seg's boundary lines against the span list, drawn and
        made the new boundaries in one walk: the top line over each span's
        overlap, the bottom line over what that leaves."""
        new = []
        for s in self.spans:
            ox0, ox1 = max(s.xs, x1), min(s.xlast, x2)
            if ox0 > ox1:
                new.append(s)
                continue
            for ln in extra:
                self._draw_only(ln, s, ox0, ox1)
            if s.xs < ox0:
                new.append(Span(s.xs, ox0 - 1, s.top, s.bot))
            for p in self._apply(tln, s, ox0, ox1, True, emit_t):
                new.extend(self._apply(bln, p, p.xs, p.xlast, False, emit_b))
            if s.xlast > ox1:
                new.append(Span(ox1 + 1, s.xlast, s.top, s.bot))
        self._finish(new, list(extra) + [tln, bln])


# ---------------------------------------------------------------------------
# View transform / projection
# ---------------------------------------------------------------------------

class ViewCtx:
    __slots__ = ("sc", "rx", "ry", "px_int", "py_int", "px88", "py88", "vz", "ang")


def view_context(px88, py88, angle, vz):
    sc = fp_sincos(angle)
    s_mag, s_neg, s_unity, c_mag, c_neg, c_unity = sc
    dx_lo = (-px88) & 0xFF
    dy_lo = (-py88) & 0xFF
    frac_vx = (_frac_rot_term(dx_lo, s_mag, s_neg, s_unity)
               - _frac_rot_term(dy_lo, c_mag, c_neg, c_unity))
    frac_vy = (_frac_rot_term(dx_lo, c_mag, c_neg, c_unity)
               + _frac_rot_term(dy_lo, s_mag, s_neg, s_unity))
    nx = (-px88) >> 8
    ny = (-py88) >> 8
    ref_vx = (_rot_int(nx, s_mag, s_neg, s_unity)
              - _rot_int(ny, c_mag, c_neg, c_unity))
    ref_vy = (_rot_int(nx, c_mag, c_neg, c_unity)
              + _rot_int(ny, s_mag, s_neg, s_unity))
    ctx = ViewCtx()
    ctx.sc = sc
    ctx.rx = rns(ref_vx, 3) + rns(frac_vx, 3)
    ctx.ry = rns(ref_vy, 3) + rns(frac_vy, 3)
    ctx.px_int = px88 >> 8
    ctx.py_int = py88 >> 8
    ctx.px88, ctx.py88 = px88, py88
    ctx.vz = vz
    ctx.ang = angle & 0xff
    return ctx


def to_view(wx, wy, ctx):
    """Prescaled world -> s16 view-space counts (32 counts per prescaled unit)."""
    s_mag, s_neg, s_unity, c_mag, c_neg, c_unity = ctx.sc
    bx = (_rot_int(wx, s_mag, s_neg, s_unity)
          - _rot_int(wy, c_mag, c_neg, c_unity))
    by = (_rot_int(wx, c_mag, c_neg, c_unity)
          + _rot_int(wy, s_mag, s_neg, s_unity))
    return rns(bx, 3) + ctx.rx, rns(by, 3) + ctx.ry


def project_x(tvx, m8v, s):
    """Screen column, saturated to s16: far off-screen endpoints only need to
    keep sign and ordering, and wrapping would put them back on screen."""
    v = fp_project_x(((tvx << 3) >> 8), (tvx << 3) & 0xFF, m8v, s)
    return max(-32768, min(32767, v))


def project_y(hdelta, m8v, s):
    return fp_project_y(hdelta, m8v, s)


def recip_for(tvy):
    return fp_recip(max(2, tvy >> 4))


# ---------------------------------------------------------------------------
# BSP traversal and seg rendering
# ---------------------------------------------------------------------------

NEAR = T16_NEAR_VERDICT      # 16 counts = 0.5 prescaled units

# DOOM's R_CheckBBox corner table: for each of the nine positions the viewer
# can occupy relative to a box, which two corners are its angular extremes.
# Indices are into (top, bottom, left, right); entry 5 means "inside".
CHECKCOORD = [
    (3, 0, 2, 1), (3, 0, 2, 0), (3, 1, 2, 0), None,
    (2, 0, 2, 1), None,         (3, 1, 3, 0), None,
    (2, 0, 3, 1), (2, 1, 3, 1), (2, 1, 3, 0),
]


# The same tables the engine gets baked into ROM.
_ATAN = [int(round(math.atan(t / 256.0) * 65536 / (2 * math.pi))) for t in range(257)]
_ANGTOX = [max(0, min(255, int(round(128.0 - 128.0 * math.tan(
    ((k << 6) - 8192) * 2 * math.pi / 65536))))) for k in range(257)]


def slope_t(num, den):
    """num/den as a 0.8 fraction, 0 <= num <= den.

    Only the divisor is shifted down to fit a byte; the numerator is shifted
    up by the complement, which keeps full precision and still leaves an
    eight-iteration 16-by-8 divide for the Z80.
    """
    k = 0
    while den > 255:
        den >>= 1
        k += 1
    if den == 0:
        return 256
    n = num << (8 - k)
    if (n >> 8) >= den:
        return 256
    return n // den


# The bounding-box angles come from a log2 subtraction and one lookup rather
# than a divide, as the BBC port does it:
#
#   ta(num, den) = ATANEXP[L(den) - L(num)]      (num < den)
#   L(v) = L8[v] for v < 256, else L8[v >> 3] + 96 with the shifted-out
#          half-bit averaging the two neighbouring entries
#
# ATANEXP[k] is the midpoint of the exact angle over the pairs that land in
# bucket k, which minimises the worst-case bucket error; ANGEPS is that error,
# and every box is widened by it.
_L8 = [0] + [min(255, int(round(math.log2(v) * 32))) for v in range(1, 256)]


def _lf(v):
    if v < 256:
        return _L8[v]
    i = v >> 3
    if (v & 4) and i < 255:
        return ((_L8[i] + _L8[i + 1] + 1) >> 1) + 96
    return _L8[i] + 96


def _build_atanexp():
    span = {}
    for den in range(2, 2048):
        for num in range(1, den):
            k = min(255, max(0, _lf(den) - _lf(num)))
            e = _ATAN[slope_t(num, den)]
            lo, hi = span.get(k, (1 << 30, -1))
            span[k] = (min(lo, e), max(hi, e))
    out, eps, prev = [], 0, 8192
    for k in range(256):
        if k in span:
            lo, hi = span[k]
            a = (lo + hi) // 2
            eps = max(eps, a - lo, hi - a)
        else:
            a = prev
        prev = a
        out.append(a)
    return out, eps


_ATANEXP, ANGEPS = _build_atanexp()


def _ta(num, den):
    """The angle for num/den (num <= den) through the log2 buckets."""
    if num == 0:
        return 0
    return _ATANEXP[min(255, max(0, _lf(den) - _lf(num)))]


def point_to_angle16(dx, dy):
    """atan2(dy, dx) as a 16-bit angle, folded through the first octant."""
    if dx == 0 and dy == 0:
        return 0
    if dx >= 0:
        if dy >= 0:
            if dx > dy:
                return _ta(dy, dx)
            return 16384 - _ta(dx, dy)
        dy = -dy
        if dx > dy:
            return (-_ta(dy, dx)) & 0xffff
        return (49152 + _ta(dx, dy)) & 0xffff
    dx = -dx
    if dy >= 0:
        if dx > dy:
            return 32768 - _ta(dy, dx)
        return 16384 + _ta(dx, dy)
    dy = -dy
    if dx > dy:
        return 32768 + _ta(dy, dx)
    return 49152 - _ta(dx, dy)


def silhouette(bb, px, py):
    """The two corners of a bbox that bound its angular extent, or None when
    the viewpoint is inside it."""
    top, bot, left, right = bb
    if px <= left:
        bx = 0
    elif px < right:
        bx = 1
    else:
        bx = 2
    if py >= top:
        by = 0
    elif py > bot:
        by = 1
    else:
        by = 2
    c = CHECKCOORD[(by << 2) + bx]
    if c is None:
        return None
    v = (top, bot, left, right)
    return (v[c[0]], v[c[1]]), (v[c[2]], v[c[3]])


class Renderer:
    def __init__(self, md):
        self.md = md
        self.stats = {}

    # -- caches --------------------------------------------------------------

    def _reset_frame(self):
        n = len(self.md.vx)
        self.vcache = [None] * n     # vertex -> (tvx, tvy, sx, m8, s)
        self.lines = []
        self.spans = Spans(self.lines)
        self.nodes_visited = 0
        self.segs_tested = 0
        self.segs_drawn = 0
        self.ss_visited = 0

    def _vertex(self, vi):
        c = self.vcache[vi]
        if c is not None:
            return c
        md = self.md
        tvx, tvy = to_view(md.vx[vi], md.vy[vi], self.ctx)
        if tvy < NEAR:
            c = (tvx, tvy, None, None, None)
        else:
            m, s = fp_recip(max(2, tvy >> 4))
            sx = project_x(tvx, m, s)
            c = (tvx, tvy, sx, m, s)
        self.vcache[vi] = c
        return c

    # -- frame ---------------------------------------------------------------

    def render(self, px88, py88, angle, vz, wx=None, wy=None):
        self.ctx = view_context(px88, py88, angle, vz)
        # The BSP side test runs in raw world coordinates for exactness.
        self.wx = wx if wx is not None else self.ctx.px_int
        self.wy = wy if wy is not None else self.ctx.py_int
        self._reset_frame()
        self.walk(len(self.md.nodes) - 1)
        return self.lines

    # -- bbox culling --------------------------------------------------------

    def bbox_range(self, bb):
        """Screen-X range [lo, hi] of a prescaled bbox, or None if invisible.

        Worked in angle space, as DOOM does: the two angular extremes of the
        box are turned into view-relative angles, clipped against the 45-degree
        field of view, and mapped to columns through a tangent table. Nothing
        is transformed or projected, so a box straddling the near plane - the
        case that costs a Cartesian bbox test four transforms and an edge walk
        - is no harder than any other.
        """
        px, py = self.ctx.px_int, self.ctx.py_int
        sil = silhouette(bb, px, py)
        if sil is None:
            return 0, W - 1                     # viewpoint inside the box
        va = (self.ctx.ang << 8) & 0xffff
        a1 = (point_to_angle16(sil[0][0] - px, sil[0][1] - py) - va
              + ANGEPS) & 0xffff
        a2 = (point_to_angle16(sil[1][0] - px, sil[1][1] - py) - va
              - ANGEPS) & 0xffff
        span = (a1 - a2) & 0xffff
        if span >= 32768:
            return 0, W - 1                     # more than 180 degrees across
        C = 8192
        t = (a1 + C) & 0xffff
        if t > 2 * C:
            t = (t - 2 * C) & 0xffff
            if t >= span:
                return None                     # wholly off the left
            a1 = C
        t = (C - a2) & 0xffff
        if t > 2 * C:
            t = (t - 2 * C) & 0xffff
            if t >= span:
                return None                     # wholly off the right
            a2 = (-C) & 0xffff
        sx1 = _ANGTOX[((a1 + C) & 0xffff) >> 6]
        sx2 = _ANGTOX[((a2 + C) & 0xffff) >> 6]
        if sx1 > sx2:
            sx1, sx2 = sx2, sx1
        # One column of slack each side absorbs the table's quantisation, so
        # the range can only ever be too wide.
        sx1 = 0 if sx1 == 0 else sx1 - 1
        sx2 = W - 1 if sx2 >= W - 1 else sx2 + 1
        return sx1, sx2

    def bbox_range_near(self, bb):
        """Slow path: the box straddles the near plane."""
        top, bot, left, right = bb
        pts = [to_view(wx, wy, self.ctx)
               for (wx, wy) in ((left, top), (right, top), (right, bot), (left, bot))]
        xs = []
        for p in pts:
            if p[1] >= NEAR:
                m, s = fp_recip(max(2, p[1] >> 4))
                xs.append(project_x(p[0], m, s))
        if not xs:
            return None
        cm, cs = fp_recip(max(2, T16_NEAR_CROSS >> 4))
        for i in range(4):
            a, b = pts[i], pts[(i + 1) & 3]
            if (a[1] < NEAR) == (b[1] < NEAR):
                continue
            if a[1] < NEAR:
                cx = fp_cross_t16(a[0], a[1], b[0], b[1])
            else:
                cx = fp_cross_t16(b[0], b[1], a[0], a[1])
            if cx is None:
                continue
            xs.append(project_x(cx, cm, cs))
        lo, hi = min(xs), max(xs)
        if hi < 0 or lo > W - 1:
            return None
        return max(0, lo), min(W - 1, hi)

    def point_on_side(self, node):
        """DOOM R_PointOnSide, on the gcd-reduced partition direction."""
        dx = self.wx - node["x"]
        dy = self.wy - node["y"]
        ndx, ndy = node["rdx"], node["rdy"]
        if ndx == 0:
            if dx <= 0:
                return 1 if ndy > 0 else 0
            return 1 if ndy < 0 else 0
        if ndy == 0:
            if dy <= 0:
                return 1 if ndx < 0 else 0
            return 1 if ndx > 0 else 0
        return 0 if (dy * ndx) < (ndy * dx) else 1

    # -- traversal -----------------------------------------------------------

    def walk(self, nid):
        if self.spans.is_full():
            return
        if nid & NF_SUBSECTOR:
            self.render_subsector(0 if nid == 0xFFFF else nid & 0x7FFF)
            return
        self.nodes_visited += 1
        node = self.md.nodes[nid]
        side = self.point_on_side(node)
        # DOOM's order: the near child is always visited, and only the far
        # child pays a bounding-box test. Testing the near box as well prunes
        # under 7% of subtrees while doubling the culling cost.
        self.walk(node["child"][side])
        if self.spans.is_full():
            return
        br = self.bbox_range(node["bboxp"][side ^ 1])
        if br is None:
            return
        if not self.spans.has_gap(br[0], br[1]):
            return
        self.walk(node["child"][side ^ 1])

    def render_subsector(self, ssid):
        self.ss_visited += 1
        cnt, first = self.md.ssectors[ssid]
        for si in range(first, first + cnt):
            self.render_seg(si)

    # -- seg -----------------------------------------------------------------

    def render_seg(self, si):
        md = self.md
        sg = md.segs[si]
        # Back-face: the seg is visible only from the side its linedef faces.
        dot = (sg["ldy"] * (self.ctx.px_int - sg["lx"])
               - sg["ldx"] * (self.ctx.py_int - sg["ly"]))
        if sg["dir"] == 1:
            dot = -dot
        if dot <= 0:
            return
        self.segs_tested += 1

        v1, v2 = sg["v1"], sg["v2"]
        c1 = self._vertex(v1)
        c2 = self._vertex(v2)
        n1 = c1[1] < NEAR
        n2 = c2[1] < NEAR
        if n1 and n2:
            return

        if not n1 and not n2:
            sx1, m1, s1 = c1[2], c1[3], c1[4]
            sx2, m2, s2 = c2[2], c2[3], c2[4]
        elif n1:
            cx = fp_cross_t16(c1[0], c1[1], c2[0], c2[1])
            if cx is None:
                return
            m1, s1 = fp_recip(max(2, T16_NEAR_CROSS >> 4))
            sx1 = project_x(cx, m1, s1)
            sx2, m2, s2 = c2[2], c2[3], c2[4]
        else:
            cx = fp_cross_t16(c2[0], c2[1], c1[0], c1[1])
            if cx is None:
                return
            m2, s2 = fp_recip(max(2, T16_NEAR_CROSS >> 4))
            sx2 = project_x(cx, m2, s2)
            sx1, m1, s1 = c1[2], c1[3], c1[4]

        if sx1 == sx2:
            return
        x_lo, x_hi = min(sx1, sx2), max(sx1, sx2)
        if x_hi < 0 or x_lo > W - 1:
            return
        if not self.spans.has_gap(x_lo, x_hi):
            return
        self.segs_drawn += 1

        vz = self.ctx.vz
        fh, ch = sg["fh"], sg["ch"]
        ft1 = project_y(ch - vz, m1, s1)
        fb1 = project_y(fh - vz, m1, s1)
        ft2 = project_y(ch - vz, m2, s2)
        fb2 = project_y(fh - vz, m2, s2)

        back = sg["back"]
        solid = back < 0
        if not solid:
            bfh, bch = md.sec_fh[back], md.sec_ch[back]
            if bch <= fh or bfh >= ch:
                solid = True

        if sx1 < sx2:
            mk = lambda a, b: Line(sx1, a + Y_BIAS, sx2, b + Y_BIAS)
        else:
            mk = lambda a, b: Line(sx2, b + Y_BIAS, sx1, a + Y_BIAS)
        extra, verts = [], []
        if solid:
            if ch > vz:
                extra.append(mk(ft1, ft2))
            if fh < vz:
                extra.append(mk(fb1, fb2))
            if not sg["no_vt1"]:
                verts.append((sx1, ft1, fb1))
            if not sg["no_vt2"]:
                verts.append((sx2, ft2, fb2))
            self.spans.draw_verticals(verts)
            self.spans.mark_solid(extra, x_lo, x_hi + 1)
            return

        need_bt = bch < ch
        need_bb = bfh > fh
        bt1 = bt2 = bb1 = bb2 = None
        if need_bt:
            bt1 = project_y(bch - vz, m1, s1)
            bt2 = project_y(bch - vz, m2, s2)
            if ch > vz:
                extra.append(mk(ft1, ft2))
        if need_bb:
            bb1 = project_y(bfh - vz, m1, s1)
            bb2 = project_y(bfh - vz, m2, s2)
            if fh < vz:
                extra.append(mk(fb1, fb2))

        # Verticals bound the visible step faces at each endpoint.
        if not sg["no_vt1"]:
            if need_bt:
                verts.append((sx1, ft1, bt1))
            if need_bb:
                verts.append((sx1, bb1, fb1))
        if not sg["no_vt2"]:
            if need_bt:
                verts.append((sx2, ft2, bt2))
            if need_bb:
                verts.append((sx2, bb2, fb2))
        self.spans.draw_verticals(verts)

        # The two boundary lines are drawn by the fuse itself, in the same
        # walk that narrows the aperture to them.
        tt1 = bt1 if need_bt else ft1
        tt2 = bt2 if need_bt else ft2
        tb1 = bb1 if need_bb else fb1
        tb2 = bb2 if need_bb else fb2
        self.spans.fuse_seg(mk(max(ft1, tt1), max(ft2, tt2)),
                            mk(min(fb1, tb1), min(fb2, tb2)),
                            x_lo, x_hi,
                            need_bt or bch > ch, need_bb or bfh < fh, extra)

# ---------------------------------------------------------------------------
# Rasterisation (for comparison against the Z80 framebuffer)
# ---------------------------------------------------------------------------

def raster(lines, w=W, h=H):
    """Bresenham the emitted segments into a 1bpp bitmap, 32 bytes per row."""
    fb = bytearray(h * (w // 8))

    def plot(x, y):
        if 0 <= x < w and 0 <= y < h:
            fb[y * (w // 8) + (x >> 3)] |= 0x80 >> (x & 7)

    for (x1, y1, x2, y2) in lines:
        dx, dy = abs(x2 - x1), abs(y2 - y1)
        sx = 1 if x1 < x2 else -1
        sy = 1 if y1 < y2 else -1
        if dx >= dy:
            err = dx >> 1
            x, y = x1, y1
            for _ in range(dx + 1):
                plot(x, y)
                err -= dy
                if err < 0:
                    y += sy
                    err += dx
                x += sx
        else:
            err = dy >> 1
            x, y = x1, y1
            for _ in range(dy + 1):
                plot(x, y)
                err -= dx
                if err < 0:
                    x += sx
                    err += dy
                y += sy
    return bytes(fb)


def write_pgm(path, fb, w=W, h=H):
    with open(path, "wb") as f:
        f.write(b"P5\n%d %d\n255\n" % (w, h))
        for y in range(h):
            f.write(bytes(255 if (fb[y * (w // 8) + (x >> 3)] >> (7 - (x & 7))) & 1
                          else 0 for x in range(w)))
