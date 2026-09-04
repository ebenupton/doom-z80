#!/usr/bin/env python3
"""Pack E1M1 into the Spectrum's banks.

Layout (see src/spec.inc for the matching EQUs):

  bank 0 ($C000, uncontended) - geometry, paged in for the whole of pass 1
    $C000  VERTS   455 x 4   prescaled s16 x, s16 y
    $C720  SEGS    644 x 16
    $EF60  SSEC    196 x 3   count, first_lo, first_hi
    $F1B0  SECFH   85 x s8
    $F210  SECCH   85 x s8
    $F270  NODES   195 x 16

  bank 2 ($8000, uncontended) - code and hot tables
    $8800  RECIP_M8  256
    $8900  RECIP_S   256
    $8A00  SIN_MAG   65      unsigned 0.8 magnitude, one quadrant
    $8A41  SIN_UNITY 65      1 where |sin| rounds to 1.0
    $8B00  NODEBB    195 x 8 quarter-prescale s8 bounds

Seg record:
    +0  v1_lo      +1  v2_lo      +2  vhi (bit0 = v1>>8, bit1 = v2>>8)
    +3  flags      +4  fh (s8)    +5  ch (s8)
    +6  bfh (s8)   +7  bch (s8)
    +8  lx (s16)   +10 ly (s16)   back-face reference point, prescaled
    +12 ldx (s8)   +13 ldy (s8)   direction, already signed for the seg's side
    +14 spare

Node record:
    +0  px (s16 world)  +2  py (s16 world)
    +4  rdx (s8)        +5  rdy (s8)     gcd-reduced partition direction
    +6  child0 (u16)    +8  child1 (u16) DOOM encoding, bit 15 = subsector
"""
import os, sys, struct, math, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ref  # noqa: E402
from fp import _SIN_QUADRANT, _SIN_UNITY, _RECIP_M8  # noqa: E402

# --- bank 0 offsets ---------------------------------------------------------
O_VERTS = 0x0000
O_SEGS = 0x0720
O_SSEC = 0x2F60
O_SECFH = 0x31B0
O_SECCH = 0x3210
O_NODES = 0x3270
O_SSSEC = 0x3EA0        # sector index per subsector
O_EYEZ = 0x3F70         # prescaled eye height per sector

SEG_STRIDE = 16
NODE_STRIDE = 16

# --- seg flags --------------------------------------------------------------
SF_SOLID = 0x80
SF_NOVT1 = 0x40
SF_NOVT2 = 0x20
SF_LDX0 = 0x10          # ldx == 0: back-face test needs no y term
SF_LDY0 = 0x08          # ldy == 0

BBOX_SHIFT = 2          # node bboxes are stored in quarter-prescale units


def s8b(v):
    assert -128 <= v <= 127, v
    return v & 0xff


def s16b(v):
    assert -32768 <= v <= 32767, v
    return [v & 0xff, (v >> 8) & 0xff]


def build(md):
    b0 = bytearray(16384)

    # --- vertices ---------------------------------------------------------
    assert len(md.vx) <= 455
    for i, (x, y) in enumerate(zip(md.vx, md.vy)):
        o = O_VERTS + i * 4
        b0[o:o + 2] = s16b(x)
        b0[o + 2:o + 4] = s16b(y)

    # --- sectors ----------------------------------------------------------
    assert len(md.sec_fh) <= 85
    for i, (f, c) in enumerate(zip(md.sec_fh, md.sec_ch)):
        b0[O_SECFH + i] = s8b(f)
        b0[O_SECCH + i] = s8b(c)

    # --- segs -------------------------------------------------------------
    assert len(md.segs) <= 644, len(md.segs)
    for i, sg in enumerate(md.segs):
        o = O_SEGS + i * SEG_STRIDE
        v1, v2 = sg["v1"], sg["v2"]
        assert v1 < 512 and v2 < 512
        b0[o] = v1 & 0xff
        b0[o + 1] = v2 & 0xff
        b0[o + 2] = ((v1 >> 8) & 1) | (((v2 >> 8) & 1) << 1)

        back = sg["back"]
        fh, ch = sg["fh"], sg["ch"]
        solid = back < 0
        bfh = bch = 0
        if not solid:
            bfh, bch = md.sec_fh[back], md.sec_ch[back]
            if bch <= fh or bfh >= ch:
                solid = True

        # Fold the seg's direction into the linedef delta so the runtime test
        # is a plain  ldy*(px-lx) - ldx*(py-ly) > 0.
        ldx, ldy = sg["ldx"], sg["ldy"]
        if sg["dir"] == 1:
            ldx, ldy = -ldx, -ldy

        flags = 0
        if solid:
            flags |= SF_SOLID
        if sg["no_vt1"]:
            flags |= SF_NOVT1
        if sg["no_vt2"]:
            flags |= SF_NOVT2
        if ldx == 0:
            flags |= SF_LDX0
        if ldy == 0:
            flags |= SF_LDY0

        b0[o + 3] = flags
        b0[o + 4] = s8b(fh)
        b0[o + 5] = s8b(ch)
        b0[o + 6] = s8b(bfh)
        b0[o + 7] = s8b(bch)
        b0[o + 8:o + 10] = s16b(sg["lx"])
        b0[o + 10:o + 12] = s16b(sg["ly"])
        b0[o + 12] = s8b(ldx)
        b0[o + 13] = s8b(ldy)

    # --- subsectors -------------------------------------------------------
    assert len(md.ssectors) <= 196
    for i, (cnt, first) in enumerate(md.ssectors):
        o = O_SSEC + i * 3
        assert cnt < 256
        b0[o] = cnt
        b0[o + 1] = first & 0xff
        b0[o + 2] = (first >> 8) & 0xff

    # --- nodes ------------------------------------------------------------
    assert len(md.nodes) <= 195
    nodebb = bytearray(195 * 8)
    for i, nd in enumerate(md.nodes):
        o = O_NODES + i * NODE_STRIDE
        b0[o:o + 2] = s16b(nd["x"])
        b0[o + 2:o + 4] = s16b(nd["y"])
        b0[o + 4] = s8b(nd["rdx"])
        b0[o + 5] = s8b(nd["rdy"])
        for k in (0, 1):
            c = nd["child"][k]
            b0[o + 6 + k * 2] = c & 0xff
            b0[o + 7 + k * 2] = (c >> 8) & 0xff
        for k in (0, 1):
            # ref.py has already rounded these outward to multiples of four.
            for j, v in enumerate(nd["bboxp"][k]):
                assert v % 4 == 0, v
                nodebb[i * 8 + k * 4 + j] = s8b(max(-128, min(127, v >> BBOX_SHIFT)))

    # --- per-subsector sector, and the eye height it implies ---------------
    dw = md._dw
    for i in range(len(md.ssectors)):
        b0[O_SSSEC + i] = md.ss_sector[i]
    for i, fh in enumerate(md.sector_floor_world):
        b0[O_EYEZ + i] = s8b(dw._prescale_height(fh + 41))

    # --- bank 2 tables ----------------------------------------------------
    recip_m8 = bytearray(256)
    recip_s = bytearray(256)
    for idx in range(2, 256):
        recip_m8[idx] = _RECIP_M8[idx]
        recip_s[idx] = (idx - 1).bit_length()
    recip_m8[0] = recip_m8[1] = recip_m8[2]
    recip_s[0] = recip_s[1] = recip_s[2]

    sin_mag = bytearray(65)
    sin_unity = bytearray(65)
    for i in range(65):
        sin_mag[i] = _SIN_QUADRANT[i]
        sin_unity[i] = 1 if _SIN_UNITY[i] else 0

    # --- angle-space bbox culling tables ---------------------------------
    # ATAN[t] = atan(t/256) as a 16-bit angle (65536 = 360 degrees), so the
    # first octant maps onto 0..8192.  ANGTOX[k] is the screen column for the
    # view-relative angle (k<<6) - 8192, i.e. sx = 128 - 128*tan(psi).
    # The angle within an octant comes from a log2 subtraction rather than a
    # divide, as the BBC port does it.  ref.py owns the derivation - one
    # source for the tables the engine and the reference both consume.
    l8 = bytearray(ref._L8)
    atan = bytearray(256 * 2)
    for k, a in enumerate(ref._ATANEXP):
        atan[k * 2] = a & 0xff
        atan[k * 2 + 1] = (a >> 8) & 0xff
    print(f"  atanexp:     EPSILON {ref.ANGEPS} angle units "
          f"({ref.ANGEPS * 360 / 65536:.2f} degrees)")

    angtox = bytearray(257)
    for k in range(257):
        psi = (k << 6) - 8192
        sx = 128.0 - 128.0 * math.tan(psi * 2 * math.pi / 65536)
        angtox[k] = max(0, min(255, int(round(sx))))

    # Packed tight after the page-aligned pair: the atan and column tables
    # are indexed with a 16-bit add, so only the reciprocal, sin and product
    # planes need their own page - and the slack that bought paid for a page
    # of code the engine had run out of.
    tables = bytearray(0x583)          # $8800..$8D82
    tables[0x000:0x100] = recip_m8     # $8800
    tables[0x100:0x200] = recip_s      # $8900
    tables[0x200:0x241] = sin_mag      # $8A00
    tables[0x241:0x282] = sin_unity    # $8A41
    tables[0x282:0x482] = atan         # $8A82  ATANEXP
    tables[0x482:0x583] = angtox       # $8C82

    return b0, bytes(tables), bytes(nodebb), bytes(l8)


def main():
    md = ref.load_from_reference()
    b0, tables, nodebb, l8 = build(md)
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build")
    os.makedirs(outdir, exist_ok=True)

    used = O_EYEZ + len(md.sec_fh)
    with open(os.path.join(outdir, "bank0.bin"), "wb") as f:
        f.write(b0)
    with open(os.path.join(outdir, "tables.bin"), "wb") as f:
        f.write(tables)
    with open(os.path.join(outdir, "nodebb.bin"), "wb") as f:
        f.write(nodebb)
    with open(os.path.join(outdir, "l8.bin"), "wb") as f:
        f.write(l8)

    sx, sy, sa, eye = md.start
    meta = {
        "n_verts": len(md.vx), "n_segs": len(md.segs), "n_ss": len(md.ssectors),
        "n_nodes": len(md.nodes), "n_sectors": len(md.sec_fh),
        "root": len(md.nodes) - 1,
        "bank0_used": used,
        "start": {"x": sx, "y": sy, "angle": sa, "eye": eye,
                  "px88": int((sx - md.map_center[0]) * 256 / md.prescale),
                  "py88": int((sy - md.map_center[1]) * 256 / md.prescale),
                  "vz": md._dw._prescale_height(eye)},
        "map_center": md.map_center, "prescale": md.prescale,
    }
    with open(os.path.join(outdir, "map.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"bank0: {used} / 16384 bytes used")
    print(f"tables: {len(tables)}  nodebb: {len(nodebb)}")
    print(f"segs={len(md.segs)} verts={len(md.vx)} nodes={len(md.nodes)} "
          f"ss={len(md.ssectors)} sectors={len(md.sec_fh)} root={meta['root']}")
    st = meta["start"]
    with open(os.path.join(outdir, "start.inc"), "w") as f:
        f.write("; generated by tools/pack.py\n")
        f.write(f"START_PX        EQU     {st['px88'] >> 8}\n")
        f.write(f"START_PXF       EQU     {st['px88'] & 0xff}\n")
        f.write(f"START_PY        EQU     {st['py88'] >> 8}\n")
        f.write(f"START_PYF       EQU     {st['py88'] & 0xff}\n")
        f.write(f"START_ANG       EQU     {st['angle']}\n")
        f.write(f"BSP_ROOT        EQU     {meta['root']}\n")
        f.write(f"MAP_CENTER_X    EQU     {md.map_center[0]}\n")
        f.write(f"MAP_CENTER_Y    EQU     {md.map_center[1]}\n")
    print(f"start x={sx} y={sy} angle={sa} px88={st['px88']} "
          f"py88={st['py88']} vz={st['vz']}")


if __name__ == "__main__":
    main()
