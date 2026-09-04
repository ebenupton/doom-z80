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
        sg["lx"] = dw._prescale_round(rv[0] - dw.MAP_CENTER_X, dw.PRESCALE)
        sg["ly"] = dw._prescale_round(rv[1] - dw.MAP_CENTER_Y, dw.PRESCALE)

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

def div8s(num, den):
    """(num << 8) / den, truncated toward zero, saturating - the exact
    behaviour of the Z80 `divs` routine, whose first phase yields only an
    8-bit integer quotient."""
    if den == 0:
        return 0
    neg = (num < 0) != (den < 0)
    n, d = abs(num), abs(den)
    if d > 0x7fff:
        d = 0x7fff
    if n // d >= 128:
        q = 0x7fff              # the full quotient would not fit s16
    else:
        q = (n << 8) // d
    return -q if neg else q


def linfn(y1, y2, sx1, sx2):
    dx = sx2 - sx1
    if dx == 0:
        return (0, (y1 + y2) >> 1)
    slope = div8s(y2 - y1, dx)
    if slope == 0:
        return (0, y1)
    if abs(sx1) <= abs(sx2):
        return (slope, y1 - fp_mul8(slope, sx1))
    return (slope, y2 - fp_mul8(slope, sx2))


def ev(fn, x):
    if fn[0] == 0:
        return fn[1]
    return fp_mul8(fn[0], x) + fn[1]


def ev88(fn, x):
    """Evaluate to 8.8 - used where a half-pixel matters (vertical clipping)."""
    if fn[0] == 0:
        return fn[1] << 8
    return m8(fn[0], x) + (fn[1] << 8)


TOP0 = (0, 0)
BOT0 = (0, H - 1)


# ---------------------------------------------------------------------------
# Trapezoid clip spans
# ---------------------------------------------------------------------------

class Spans:
    """Visible region as a sorted array of inclusive column ranges."""
    __slots__ = ("spans", "out")

    def __init__(self, out):
        self.spans = [(0, W - 1, TOP0, BOT0)]
        self.out = out       # collects emitted line segments

    def is_full(self):
        return not self.spans

    def has_gap(self, lo, hi):
        ilo = max(0, lo)
        ihi = min(W - 1, hi)
        if ilo > ihi:
            return False
        for xlo, xlast, tfn, bfn in self.spans:
            if xlo > ihi:
                break
            if xlast < ilo:
                continue
            clo, chi = max(xlo, ilo), min(xlast, ihi)
            # The aperture is monotone in x, so its two ends decide it.
            if ev(tfn, clo) < ev(bfn, clo) or ev(tfn, chi) < ev(bfn, chi):
                return True
        return False

    # -- drawing ----------------------------------------------------------

    def draw_verticals(self, verts):
        for (x, ya, yb) in verts:
            self._draw_vertical(x, ya, yb)

    def _draw_extras(self, extra, ox0, ox1, tfn, bfn, ta, ba, tb, bb):
        """The seg's other edges, clipped to one span's trapezoid."""
        for fn in extra:
            c = clip_to_trap(fn, ox0, ox1, tfn, bfn, ta, ba, tb, bb)
            if c:
                self.out.append(c)

    def _draw_vertical(self, x, ya, yb):
        if x < 0 or x >= W:
            return
        if ya > yb:
            ya, yb = yb, ya
        for xlo, xlast, tfn, bfn in self.spans:
            if xlo > x:
                return
            if xlast < x:
                continue
            yt = ev(tfn, x)
            yb2 = ev(bfn, x)
            if yt >= yb2:
                return
            a = max(ya, yt)
            b = min(yb, yb2)
            if a <= b:
                self.out.append((x, a, x, b))
            return

    # -- occlusion updates -------------------------------------------------

    def mark_solid(self, extra, lo, hi):
        """Draw a solid wall's edges and delete its columns, in one walk."""
        ilo, ihi = max(0, lo), min(W, hi) - 1
        if ilo > ihi:
            return
        new = []
        for xlo, xlast, tfn, bfn in self.spans:
            if xlast < ilo or xlo > ihi:
                new.append((xlo, xlast, tfn, bfn))
                continue
            ox0, ox1 = max(xlo, ilo), min(xlast, ihi)
            self._draw_extras(extra, ox0, ox1, tfn, bfn,
                              ev(tfn, ox0), ev(bfn, ox0),
                              ev(tfn, ox1), ev(bfn, ox1))
            if xlo < ilo:
                new.append((xlo, ilo - 1, tfn, bfn))
            if xlast > ihi:
                new.append((ihi + 1, xlast, tfn, bfn))
        self.spans = new

    def fuse_seg(self, tfn, bfn, x1, x2, emit_t, emit_b, extra):
        """Clip both of a seg's boundary lines to the span list, draw them,
        and make them the new boundaries - all in one walk.

        A line that was drawn is, by construction, inside the aperture on
        every column it lit: there max(old_top, line) is just the line, so
        the tighten is a copy rather than a piecewise max with a crossover
        search.  Columns where the line ran past the far boundary close;
        columns where it never reached the near one keep what they had.  The
        bottom line then meets whatever the top line left behind, which is
        what a second pass over the list would have shown it.
        """
        new = []
        for (xlo, xlast, sp_t, sp_b) in self.spans:
            ox0, ox1 = max(xlo, x1), min(xlast, x2)
            if ox0 > ox1:
                new.append((xlo, xlast, sp_t, sp_b))
                continue
            if xlo < ox0:
                new.append((xlo, ox0 - 1, sp_t, sp_b))
            ta, ba = ev(sp_t, ox0), ev(sp_b, ox0)
            tb, bb = ev(sp_t, ox1), ev(sp_b, ox1)
            self._draw_extras(extra, ox0, ox1, sp_t, sp_b, ta, ba, tb, bb)
            for (a, b, tf, bf) in self._apply(tfn, ox0, ox1, sp_t, sp_b,
                                              True, emit_t, ta, ba, tb, bb):
                new.extend(self._apply(bfn, a, b, tf, bf, False, emit_b))
            if xlast > ox1:
                new.append((ox1 + 1, xlast, sp_t, sp_b))
        # A fuse splits at the seg's own column range whether or not the
        # boundaries changed there, so abutting pieces that ended up
        # identical are coalesced again.
        self.spans = []
        for sp in new:
            if self.spans:
                p = self.spans[-1]
                if p[1] + 1 == sp[0] and p[2] == sp[2] and p[3] == sp[3]:
                    self.spans[-1] = (p[0], sp[1], p[2], p[3])
                    continue
            self.spans.append(sp)

    def _apply(self, fn, x0, x1, tfn, bfn, side, emit,
               ta_=None, ba_=None, tb_=None, bb_=None):
        """One line against one trapezoid piece: draw the visible run and
        return the pieces that survive, the run carrying the line."""
        if ta_ is None:
            ta_, ba_ = ev(tfn, x0), ev(bfn, x0)
            tb_, bb_ = ev(tfn, x1), ev(bfn, x1)
        ya, yb = ev(fn, x0), ev(fn, x1)
        t0, t1 = ge_range(ya - ta_, yb - tb_,
                          (fn[0] - tfn[0], fn[1] - tfn[1]), x0, x1)
        b0, b1 = ge_range(ba_ - ya, bb_ - yb,
                          (bfn[0] - fn[0], bfn[1] - fn[1]), x0, x1)
        r0, r1 = max(t0, b0), min(t1, b1)
        if emit and r0 <= r1:
            if r0 != x0:
                ya, ta_, ba_ = ev(fn, r0), ev(tfn, r0), ev(bfn, r0)
            if r1 != x1:
                yb, tb_, bb_ = ev(fn, r1), ev(tfn, r1), ev(bfn, r1)
            ea = ta_ if ya < ta_ else (ba_ if ya > ba_ else ya)
            eb = tb_ if yb < tb_ else (bb_ if yb > bb_ else yb)
            self.out.append((r0, ea, r1, eb))

        above = lambda x: x < t0 or x > t1
        pieces = []
        if r0 <= r1:
            if r0 > x0:
                pieces.append((x0, r0 - 1, above(x0)))
            pieces.append((r0, r1, None))
            if r1 < x1:
                pieces.append((r1 + 1, x1, above(x1)))
        elif above(x0) == above(x1):
            pieces.append((x0, x1, above(x0)))
        else:
            c = max(x0 + 1, min(x1, t0 if above(x0) else b0))
            pieces.append((x0, c - 1, above(x0)))
            pieces.append((c, x1, above(x1)))

        out = []
        for a, b, kind in pieces:
            if kind is None:
                nt, nb = (fn, bfn) if side else (tfn, fn)
            elif kind == side:
                nt, nb = tfn, bfn
            else:
                continue                    # the line ran past the far side
            d = (nb[0] - nt[0], nb[1] - nt[1])
            if evd(d, a) > 0 or evd(d, b) > 0:
                out.append((a, b, nt, nb))
        return out


def evd(d, x):
    """Evaluate a difference function (slope, intercept) at a column."""
    if d[0] == 0:
        return d[1]
    return fp_mul8(d[0], x) + d[1]


def pw(f, g, x0, x1, want_max):
    """Piecewise max (or min) of two linear functions over the inclusive
    column range [x0, x1].

    Comparisons run on the difference f - g, so parallel boundaries - which
    includes the common both-flat case - cost no multiply, and the crossover
    is a single divide rather than a search.
    """
    d = (f[0] - g[0], f[1] - g[1])
    d0 = evd(d, x0)
    d1 = evd(d, x1)
    if want_max:
        if d0 >= 0 and d1 >= 0: return [(x0, x1, f)]
        if d0 <= 0 and d1 <= 0: return [(x0, x1, g)]
    else:
        if d0 <= 0 and d1 <= 0: return [(x0, x1, f)]
        if d0 >= 0 and d1 >= 0: return [(x0, x1, g)]
    if d[0] == 0:
        keep_f = (d0 >= 0) if want_max else (d0 <= 0)
        return [(x0, x1, f if keep_f else g)]
    cx = div8s(-d[1], d[0])
    cx = max(x0 + 1, min(x1, cx))
    dc = evd(d, cx)
    fwins = (dc >= 0) if want_max else (dc <= 0)
    if fwins:
        cx += 1
        if cx > x1:
            return [(x0, x1, f)]
    else:
        if cx <= x0:
            return [(x0, x1, g)]
    first_f = (d0 > 0) if want_max else (d0 < 0)
    if first_f:
        return [(x0, cx - 1, f), (cx, x1, g)]
    return [(x0, cx - 1, g), (cx, x1, f)]


def cross_col(d, xa, xb):
    """First column in [xa, xb] on the side where the linear d(x) >= 0.

    Only reached when d disagrees in sign at the two ends, so exactly one
    divide settles it; the column is then verified rather than trusted.
    """
    if d[0] == 0:
        return None
    xc = div8s(-d[1], d[0])
    xc = max(xa, min(xb, xc))
    if evd(d, xc) < 0:
        if d[0] > 0:
            xc += 1
            if xc > xb:
                return None
        else:
            xc -= 1
            if xc < xa:
                return None
    return xc


def ge_range(v0, v1, d, x0, x1):
    """The sub-interval of [x0, x1] on which the linear d(x) is >= 0, given
    its already-known values v0, v1 at the two ends.

    The ends are compared as evaluated boundaries rather than as a difference,
    which keeps the flat-boundary short circuit; the difference is only formed
    when they disagree and a crossing has to be divided out.  d disagrees in
    sign at most once, so the answer is one contiguous piece anchored at an
    end.  Empty comes back as (x0+1, x0).
    """
    if v0 >= 0 and v1 >= 0:
        return x0, x1
    if v0 < 0 and v1 < 0:
        return x0 + 1, x0
    xc = cross_col(d, x0, x1)
    if xc is None:
        return x0 + 1, x0
    return (xc, x1) if v0 < 0 else (x0, xc)


def clip_to_trap(fn, xa, xb, tfn, bfn, ta_, ba_, tb_, bb_):
    """Clip the line y = fn to the trapezoid, in column space.

    The boundaries are evaluated once per span by the caller and shared by
    every line clipped against it; evaluating them directly rather than as
    differences from the line keeps the flat-boundary short circuit - well
    over a third of them are flat - and leaves the exact aperture in hand, so
    the endpoint clamp costs nothing extra.
    """
    ya, yb = ev(fn, xa), ev(fn, xb)

    if ya < ta_ or yb < tb_:                       # y >= top(x)
        if ya < ta_ and yb < tb_:
            return None
        xc = cross_col((fn[0] - tfn[0], fn[1] - tfn[1]), xa, xb)
        if xc is None:
            return None
        if ya < ta_:
            xa = xc
            ya, ta_, ba_ = ev(fn, xa), ev(tfn, xa), ev(bfn, xa)
        else:
            xb = xc
            yb, tb_, bb_ = ev(fn, xb), ev(tfn, xb), ev(bfn, xb)
        if xa > xb:
            return None

    if ya > ba_ or yb > bb_:                       # y <= bot(x)
        if ya > ba_ and yb > bb_:
            return None
        xc = cross_col((bfn[0] - fn[0], bfn[1] - fn[1]), xa, xb)
        if xc is None:
            return None
        if ya > ba_:
            xa = xc
            ya, ta_, ba_ = ev(fn, xa), ev(tfn, xa), ev(bfn, xa)
        else:
            xb = xc
            yb, tb_, bb_ = ev(fn, xb), ev(tfn, xb), ev(bfn, xb)
        if xa > xb:
            return None

    ya = ta_ if ya < ta_ else (ba_ if ya > ba_ else ya)
    yb = tb_ if yb < tb_ else (bb_ if yb > bb_ else yb)
    return (xa, ya, xb, yb)


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
            mk = lambda a, b: linfn(a, b, sx1, sx2)
        else:
            mk = lambda a, b: linfn(b, a, sx2, sx1)
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
