#!/usr/bin/env python3
"""Pack E1M1 into the Spectrum's banks.

Layout (see src/spec.inc for the matching EQUs):

  bank 0 ($C000, uncontended) - geometry, paged in for the whole of pass 1
    $C000  VP_OX/VP_OY/VP_PG  3 x 512  x lo, y lo, page nibble
    $C720  SEGS    644 x 16
    $EF60  SSEC    196 x 3   count, first_lo, first_hi
    $F1B0  SECFH   85 x s8
    $F210  SECCH   85 x s8
    $F270  NODES   195 x 12  (+10: nid*8, the NODEBB index)
    $FBA0  SSSEC   196 x u8
    $FC70  EYEZ    85 x s8
    $FCD0  VSDESC  455 x u8
    $FEA0  VSEXPL  95 x 3

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
    +8  lx (s16)   +10 ly (s16)   back-face reference point, prescaled 8.8:
    +14 lxf (u8)   +15 lyf (u8)   the integer parts, then the fractions
    +12 ldx (s8)   +13 ldy (s8)   direction, already signed for the seg's side

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
O_SSSEC = 0x3BA0        # sector index per subsector
O_EYEZ = 0x3C70         # prescaled eye height per sector
O_VSDESC = 0x3CD0       # vertex-span descriptors, one per vertex
O_VSEXPL = 0x3EA0       # their explicit entries, (lo, hi, cont)

SEG_STRIDE = 16
NODE_STRIDE = 12

# --- seg flags --------------------------------------------------------------
SF_SOLID = 0x80
SF_STEPUP_T = 0x40      # portal: bch > ch (the front ceiling edge is an aperture edge)
SF_STEPUP_B = 0x20      # portal: bfh < fh
SF_LDX0 = 0x10          # ldx == 0: back-face test needs no y term
SF_LDY0 = 0x08          # ldy == 0
SF_NEEDBT = 0x04        # portal: bch < ch (the back ceiling is the aperture's top)
SF_NEEDBB = 0x02        # portal: bfh > fh

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
    # the BBC port's page-split planes: a low byte per axis and a nibble
    # holding each axis's page (+2, so the map's -512..511 fits two bits)
    for i, (x, y) in enumerate(zip(md.vx, md.vy)):
        assert -512 <= x < 512 and -512 <= y < 512, (i, x, y)
        b0[O_VERTS + i] = x & 0xff
        b0[O_VERTS + 0x200 + i] = y & 0xff
        b0[O_VERTS + 0x400 + i] = (((x >> 8) + 2) & 3) | ((((y >> 8) + 2) & 3) << 2)

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
        bfh, bch = fh, ch           # a solid seg's back pair aliases its front
        if not solid:
            bfh, bch = md.sec_fh[back], md.sec_ch[back]
            if bch <= fh or bfh >= ch:
                solid = True
                bfh, bch = fh, ch

        # Fold the seg's direction into the linedef delta so the runtime test
        # is a plain  ldy*(px-lx) - ldx*(py-ly) > 0.
        ldx, ldy = sg["ldx"], sg["ldy"]
        if sg["dir"] == 1:
            ldx, ldy = -ldx, -ldy

        flags = 0
        if solid:
            flags |= SF_SOLID
        else:
            if bch < ch: flags |= SF_NEEDBT
            if bfh > fh: flags |= SF_NEEDBB
            if bch > ch: flags |= SF_STEPUP_T
            if bfh < fh: flags |= SF_STEPUP_B
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
        b0[o + 14] = sg["lxf"]
        b0[o + 15] = sg["lyf"]

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
    own_box = {}                        # node -> the box it occupies in its parent
    for nd in md.nodes:
        for k in (0, 1):
            c = nd["child"][k]
            if not (c & 0x8000):
                own_box[c] = nd["bboxp"][k]
    # The node records and the walk's tables live in bank 4 (walkdata.bin,
    # see build_walkdata): only the policy bits are derived here
    node_pol = bytearray(256)
    for i, nd in enumerate(md.nodes):
        # the BBC port's always-descend policy (adesc_policy.json: (node,
        # side) pairs whose box check is skipped): $40 = side 0, $80 = side 1
        # ...and its SAME-AS-PARENT serve in bits 4/5: a near child whose box
        # is its parent's own box inherits the parent's verdict (the check
        # that admitted the parent was on that very box)
        bb = 0
        if (i, 0) in md._dw.ADESC: bb |= 0x40
        if (i, 1) in md._dw.ADESC: bb |= 0x80
        for k in (0, 1):
            if i in own_box and nd["bboxp"][k] == own_box[i]:
                bb |= 0x10 << k
        node_pol[i] = bb
        for k in (0, 1):
            for j, v in enumerate(nd["bboxp"][k]):
                assert v % 4 == 0, v
                nodebb[i * 8 + k * 4 + j] = max(0, min(255, (v >> BBOX_SHIFT) + 128))   # (unused now)
    global _NODE_POL
    _NODE_POL = bytes(node_pol)

    # --- the vertex-span descriptors, straight from the BBC port's build ----
    dw = md._dw
    desc = list(dw.vspan_desc)
    assert max((i for i, d in enumerate(desc) if d), default=0) < len(md.vx) + 1
    for i in range(len(md.vx)):
        b0[O_VSDESC + i] = desc[i] & 0xff
    assert len(dw.vspan_expl) * 3 <= 0x4000 - O_VSEXPL
    for i, (lo, hi, cont) in enumerate(dw.vspan_expl):
        b0[O_VSEXPL + i * 3] = lo & 0xff
        b0[O_VSEXPL + i * 3 + 1] = hi & 0xff
        b0[O_VSEXPL + i * 3 + 2] = 1 if cont else 0

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

    # the bank-5 angle tables, one image from $5B00: ANGTOX (256), the display
    # list's pages (zero), then the atan planes at $6000/$6100
    b5 = bytes(angtox[:256]) + bytes(0x400) + bytes(atan[0::2]) + bytes(atan[1::2])
    return b0, bytes(tables), bytes(nodebb), bytes(l8), b5


def build_objects(md):
    """Bank 4 data at OBJ_DATA: the static objects' planes (x lo/hi, y lo/hi,
    home subsector, kind, top, floor - the BBC's OBJ_OX/OY/PG unfolded to
    s16 since the Z80 rotates s16 coordinates), the per-subsector bitmap
    and per-octet first-index run table, then at +$200 the 768-byte art
    template blob exactly as the BBC packer builds it."""
    dw = md._dw
    objs = dw.fp_objects
    n = len(objs)
    N_OBJ = 50
    assert n == N_OBJ, f"{n} objects; spec.inc says N_OBJ = {N_OBJ}"
    bits_len = (len(md.ssectors) + 7) // 8
    assert bits_len == 25
    od = bytearray(0x200 + 768)
    bits = 8 * n
    run8 = bits + bits_len
    od[run8:run8 + bits_len] = b"\xff" * bits_len
    for i, o in enumerate(objs):
        x, y = o["x"], o["y"]
        assert i == 0 or objs[i - 1]["ss"] <= o["ss"], "planes must be ss-sorted"
        for pl, v in enumerate((x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff,
                                o["ss"], o["asp"], o["zt"] & 0xff, o["zb"] & 0xff)):
            od[pl * n + i] = v
        od[bits + (o["ss"] >> 3)] |= 1 << (o["ss"] & 7)
        if od[run8 + (o["ss"] >> 3)] == 0xff:
            od[run8 + (o["ss"] >> 3)] = i
    L = dw.packed_layout
    assert L["art_len"] == 768
    od[0x200:0x200 + 768] = bytes(dw.packed_rom_main[L["off_obj_art"]:L["off_obj_art"] + 768])
    print(f"  objects:     {n} billboards, {bits_len} B bitmap, 768 B art")
    return bytes(od)


def build_walkdata(md):
    """Bank 4 from NODES4 ($D800) up: the node records (stride 10: px, py
    s16 world; rdx, rdy s8; child0, child1 u16), the BBC port's bounding-box
    planes verbatim (its packed_bbox_table: field*$400 + hi*$200 + side*$100
    + node, hi bytes offset-binned), its 1025-entry VATOX, L8, the 12-bit
    ATANEXP planes, the corner-phi memo seed (KDXH plane $80 = never
    written) and the node policy plane."""
    import json as _json
    dw = md._dw
    NODES4, BBP, VATOX, L8, AE_LO, AE_HI, CPM, ND_POL, BCA_WS, END = (
        0xD800, 0xE000, 0xF000, 0xF500, 0xF600, 0xF700, 0xF800, 0xFB00, 0xFC00, 0xFC40)
    w = bytearray(END - NODES4)
    def at(a): return a - NODES4
    for i, nd in enumerate(md.nodes):
        o = at(NODES4) + i * 10
        w[o:o + 2] = s16b(nd["x"])
        w[o + 2:o + 4] = s16b(nd["y"])
        w[o + 4] = s8b(nd["rdx"])
        w[o + 5] = s8b(nd["rdy"])
        for k in (0, 1):
            c = nd["child"][k]
            w[o + 6 + k * 2] = c & 0xff
            w[o + 7 + k * 2] = (c >> 8) & 0xff
    assert len(md.nodes) * 10 <= BBP - NODES4
    bt = bytes(dw.packed_bbox_table)
    assert len(bt) == 4096
    w[at(BBP):at(BBP) + 4096] = bt
    import angle_bbox as A                      # the BBC's own module (ref.py put its dir on the path)
    ft = _json.load(open(os.path.join(ref.REF_DIR, "tools", "atanexp_tables.json")))
    assert ft["EPSILON"] == 12 and ft["TA0"] == 0 and ft["ATANEXP"][0] == 512 and max(ft["ATANEXP"]) <= 512
    for k in range(1025):
        c = (A._vatox_lo[k + 512] + A._vatox_hi[k + 512]) // 2
        w[at(VATOX) + k] = max(0, min(255, c))
    assert w[at(VATOX)] == 0 and w[at(VATOX) + 1024] == 255
    for i in range(256):
        w[at(L8) + i] = ft["L8"][i] & 0xff
        w[at(AE_LO) + i] = ft["ATANEXP"][i] & 0xff
        w[at(AE_HI) + i] = (ft["ATANEXP"][i] >> 8) & 0xff
    assert list(ft["L8"]) == list(ref._L8[:256])
    w[at(CPM) + 0x80:at(CPM) + 0x100] = b"\x80" * 128
    w[at(ND_POL):at(ND_POL) + 256] = _NODE_POL
    # the octant compose (view.s pa_base_hi / pa_sign): base hi | sign << 7
    w[at(BCA_WS) + 0x10:at(BCA_WS) + 0x18] = bytes([0x84, 0x00, 0x0C, 0x80, 0x04, 0x88, 0x8C, 0x08])
    print(f"  walkdata:    {len(md.nodes)} nodes, 4 KB bbox planes, VATOX, L8/AE, memo, policy ({len(w)} B)")
    return bytes(w)


def build_collision(md):
    """Bank 1: the BBC port's player-collision tables (colmap.py), for a
    faithful P_CheckPosition box-vs-solid-line test in read_input.  All in
    one bank paged in during movement (read_input runs outside the walk).
      COL_SEG  $C000  N x 8   blocking lines (x1,y1,dx,dy s16 LE, CENTRE-
                             relative) - one-sided + ML_BLOCKING, pruned,
                             colinear-merged (colmap 'colsegs').
      COL_IDX  $C700  36 x 3  per 128-unit X column: (list ptr lo, hi, count)
      COL_LIST $C780  u8      solid seg indices, per-column runs.
    (Two-sided 'ports' - doors/lifts, height-dependent - are NOT emitted
    here; they need the vz/opening test, a further pmove.s feature.)"""
    import colmap
    m = colmap.build()
    segs = m["colsegs"]
    n = len(segs)
    COL_SEG, COL_IDX, COL_LIST = 0xC000, 0xC700, 0xC780
    assert n * 8 <= COL_IDX - COL_SEG, "COL_SEG overran COL_IDX"
    buf = bytearray(0x2000)
    for i, (x1, y1, dx, dy) in enumerate(segs):
        struct.pack_into("<hhhh", buf, (COL_SEG - 0xC000) + i * 8, x1, y1, dx, dy)
    lst = []
    cur = COL_LIST
    for c in range(colmap.COLS):
        off, cnt = m["colidx"][c]
        idxs = [m["collist"][off + k] for k in range(cnt) if m["collist"][off + k] < n]
        o = (COL_IDX - 0xC000) + c * 3
        buf[o], buf[o + 1], buf[o + 2] = cur & 0xff, (cur >> 8) & 0xff, len(idxs)
        for idx in idxs:
            lst.append(idx)
        cur += len(idxs)
    assert cur <= 0x10000, "COL_LIST overran the bank"
    for k, idx in enumerate(lst):
        buf[(COL_LIST - 0xC000) + k] = idx
    end = (COL_LIST - 0xC000) + len(lst)
    print(f"  collision:   {n} solid lines, {len(lst)} column entries ({end} B)")
    return bytes(buf[:end])


def main():
    md = ref.load_from_reference()
    b0, tables, nodebb, l8, atan = build(md)
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build")
    os.makedirs(outdir, exist_ok=True)

    used = O_VSEXPL + 3 * len(md._dw.vspan_expl)
    with open(os.path.join(outdir, "bank0.bin"), "wb") as f:
        f.write(b0)
    with open(os.path.join(outdir, "tables.bin"), "wb") as f:
        f.write(tables)
    with open(os.path.join(outdir, "nodebb.bin"), "wb") as f:
        f.write(nodebb)
    with open(os.path.join(outdir, "atan.bin"), "wb") as f:   # $5B00 ANGTOX .. $6100 AE_HI
        f.write(atan)
    with open(os.path.join(outdir, "l8.bin"), "wb") as f:
        f.write(l8)
    with open(os.path.join(outdir, "objdata.bin"), "wb") as f:
        f.write(build_objects(md))
    with open(os.path.join(outdir, "walkdata.bin"), "wb") as f:
        f.write(build_walkdata(md))
    with open(os.path.join(outdir, "coldata.bin"), "wb") as f:
        f.write(build_collision(md))

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
    print(f"vspan: {sum(1 for d in md._dw.vspan_desc[:len(md.vx)] if d)} vertices, "
          f"{len(md._dw.vspan_expl)} explicit")


if __name__ == "__main__":
    main()
