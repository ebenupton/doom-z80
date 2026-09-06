; ---------------------------------------------------------------------------
; ZX Spectrum 128K memory map for the DOOM wireframe engine.
;
; The engine renders in two passes so that geometry and framebuffer never
; need to be paged in at the same time:
;
;   pass 1  BSP walk + clipping, bank 0 paged at $C000 (geometry).
;           Output is a display list of clipped screen-space segments.
;   pass 2  rasterise the display list into the back buffer. For buffer B
;           that means paging bank 7 in at $C000; buffer A is bank 5, which
;           is permanently at $4000.
;
; Bank 2 ($8000) holds all code and the hot tables. It is uncontended on a
; 128K, so the inner loops never pay ULA delays; the framebuffers are
; contended either way, which is unavoidable.
; ---------------------------------------------------------------------------

                DEFINE  SCREEN_W    256
                DEFINE  SCREEN_H    192

; --- render window: 256x160, vertically centred (rows 16..175) -------------
RENDER_W        EQU     256
RENDER_H        EQU     160
RENDER_Y0       EQU     16
HALF_W          EQU     128
HALF_H          EQU     80

; --- framebuffers ----------------------------------------------------------
FB_A            EQU     $4000           ; bank 5, always mapped
FB_B            EQU     $C000           ; bank 7, paged
FB_LEN          EQU     6144
ATTR_A          EQU     $5800

; --- bank assignments ------------------------------------------------------
BANK_GEOM       EQU     0               ; segs, vertices, sectors, subsectors
BANK_SPARE1     EQU     1
BANK_CODE       EQU     2               ; permanently at $8000
BANK_SPARE3     EQU     3
BANK_VCACHE     EQU     4               ; (reserved)
BANK_SCREEN_A   EQU     5
BANK_SPARE6     EQU     6
BANK_SCREEN_B   EQU     7

; port $7FFD image: bits 0-2 bank, bit 3 screen (1 = bank 7 displayed),
; bit 4 ROM select (keep 1 = 48K ROM so the loader stays sane), bit 5 lock.
PORT_7FFD       EQU     $7FFD
; PAGE_IN bank : map a bank at $C000 inline (no call), from the per-frame
; page_base.  Eats A and BC.
                MACRO   PAGE_IN bank
                ld      a,(page_base)
                or      bank
                ld      (cur_port),a
                out     (PORT_7FFD & 255),a     ; (A15 = bit 7 of the value = 0,
                ENDM                            ;  A1 = 0: the port decodes)
; SET_PAGE_BASE : recompute page_base from back_buf (A = back_buf on entry)
                MACRO   SET_PAGE_BASE
                xor     1
                rlca
                rlca
                rlca
                or      P7_ROM48
                ld      (page_base),a
                push    af                      ; the per-frame port bytes, as
                or      BANK_GEOM               ;  immediates at their sites
                ld      (wss_pg1+1),a           ;  (PAGE_IMM: the seg loop)
                pop     af
                push    af
                or      BANK_OBJ
                ld      (wss_pg2+1),a
                pop     af
                or      BANK_PROD
                ld      (prod_port),a           ; vg_rotate's port byte
                ld      (vgr_pp+1),a
                ENDM
; PAGE_IMM site : PAGE_IN with the port byte an immediate SET_PAGE_BASE patches
                MACRO   PAGE_IMM site
site:           ld      a,0                     ; SMC: page_base | the bank
                ld      (cur_port),a
                out     (PORT_7FFD & 255),a
                ENDM
P7_ROM48        EQU     $10

; --- bank 5 ($4000-$7FFF): screen + scratch --------------------------------
; $4000-$5AFF is the bitmap, $5800-$5AFF the attributes; everything the
; engine keeps here starts above them.
; Corner-angle memo: R_PointToAngle is a pure function of the delta pair, so
; an entry never goes stale - the map is cleared once at boot and never again.
; Sibling boxes and a box and its parent share corners, so a delta pair comes
; round again about one time in six.
AE_LO           EQU     $6000           ; ATANEXP as two byte planes: the angle
AE_HI           EQU     $6100           ; for a log2 bucket, lo and hi

DLIST_BASE      EQU     $6000           ; display list: 4 bytes per segment,
DLIST_MAX       EQU     704             ; one region (358 seen in 1000 frames
DLIST_END       EQU     DLIST_BASE + DLIST_MAX*4   ; with objects; $6B00)
DLIST_END_PAGE  EQU     DLIST_END>>8

L8TAB           EQU     $6200           ; 256 x u8: round(log2(v) * 32)

; project_y is a pure function of (h, M8, S), so a memo on the whole tuple
; survives frames and positions and a hit is bit-identical to the body by
; construction.  Direct-mapped, probed on h ^ M8, five page planes so the slot
; is L and a plane is H; S is never 0 on a live reciprocal, so it doubles as
; the valid flag (cleared once by cpm_init).
VYC_H           EQU     $5B00           ; 256 slots on h ^ M8, a page a plane:
VYC_M8          EQU     $5C00           ;   h, M8, S (written last: the valid
VYC_S           EQU     $5D00           ;   flag), the row lo, hi
VYC_L           EQU     $5E00
VYC_HI          EQU     $5F00

NODEBB          EQU     $6580           ; 195 x 8 quarter-prescale bounds           ; 195 x 8 quarter-prescale bounds

NVERTS          EQU     455

; The vertex transform follows the BBC port's layout: a vertex is a low byte
; per axis and a page nibble (VP_OX/VP_OY/VP_PG in bank 0), the rotation is
; four lookups in per-angle product tables (X * |sin|, X * |cos|, built by
; vs_rebuild_b4) combined with the frame's signs and floored by 8, plus a
; per-frame page term (PBX/PBY, 16 entries by the nibble).  The page term is
; an exact multiple of 8, so the result is the old rns3 of the full product.
PB              EQU     $6F00           ; 64 x (PBX s16, PBY s16): the page terms of
                                        ; L(w)x and L(w)y by the 6-bit page pair
PROD_ZERO       EQU     $7F00           ; a zero page: the product table of magnitude 0
; The product tables X * M (128 x u16, lo/hi) for every quadrant magnitude
; (SIN_MAG index q = 1..64, M = 256 when SIN_UNITY) live in bank 3, built
; once at boot (cpm_init): table q at PROD_BASE + (q - 1) * 256.  The angle
; selects the |sin| and |cos| tables' pages into vertex_get (vgx_ts...).
BANK_PROD       EQU     3
PROD_BASE       EQU     $C000

; The vertex caches as RECORDS, not the BBC port's planes (measured 2026-09-06:
; a 512-entry plane is two pages, so a field is `inc h / inc h` from the last
; and the index carries a page bit; an 8-byte record is `inc l` a field, the
; four projected bytes copy with LDI, and the static per-vertex bytes ride the
; same record).  A vertex is addressed by its record: H = VXR>>8 + v>>5,
; L = (v*8)&255 - the form the seg record holds (SG_V1/SG_V2/SG_VHI).
VXR             EQU     $7000           ; VXCACHE: 455 x 8 (to $7E38)
VXR_M8          EQU     1               ;   +0 frame stamp (0 = empty)
VXR_S           EQU     2               ;   the reciprocal (M8, S: 0 = behind the near plane)
VXR_SXL         EQU     3               ;   the projected column, s16
VXR_SXH         EQU     4
VXR_DONE        EQU     5               ;   the vertex-span stamp (was VDONE)
VXR_DESC        EQU     6               ;   the vertex-span descriptor (static, from VSDESC)
VRR             EQU     $6000           ; VRCACHE: the rotated coordinates (before the
VRR_RXL         EQU     1               ;   viewer's term) per vertex, valid while the view
VRR_RXH         EQU     2               ;   ANGLE stands: +0 the angle stamp, rx, ry
VRR_RYL         EQU     3
VRR_RYH         EQU     4
VRR_OX          EQU     5               ;   the static offsets and page pair (from VP_OX/OY/PG)
VRR_OY          EQU     6
VRR_PG          EQU     7
VRR_TO_VXR      EQU     (VXR-VRR)>>8    ; the page distance between a vertex's two records

; --- bank 2 ($8000-$BFFF): code and hot tables -----------------------------
SQ_LO           EQU     $8000           ; quarter-square f(n)=n*n/4, low bytes
SQ_HI           EQU     $8200           ; 512 entries each, page aligned
ROWLO_A         EQU     $8400           ; screen row address planes, 160 entries
ROWHI_A         EQU     $8500
ROWLO_B         EQU     $8600
ROWHI_B         EQU     $8700
RECIP_M8        EQU     $8800           ; normalised reciprocal mantissa - 256
RECIP_S         EQU     $8900           ; its binade, (idx-1).bit_length()
SIN_MAG         EQU     $8A00           ; 65 entries, one quadrant, 0.8 unsigned
SIN_UNITY       EQU     $8A41           ; 65 flags: |sin| rounds up to 1.0
ATANEXP         EQU     $8A82           ; 256 x u16: the angle for a log2 bucket
ANGTOX          EQU     $5B00           ; 256 x u8: screen column for a view angle (index 256 = 0, by the carry)
; per-frame products i*sin_mag and i*cos_mag, as byte planes
CODE_BASE       EQU     $8E00

; Screen-space y inside the clipper is carried as a byte biased by Y_BIAS,
; so the visible rows [0, 159] land at [48, 207].  Anything a boundary line
; reaches outside the visible band clamps to 0 or 255, which is on the correct
; side of every boundary - and that makes every y comparison in the clipper a
; single CP instead of a signed 16-bit subtract.
Y_BIAS          EQU     48

CLIPANGLE       EQU     8192            ; 45 degrees in 16-bit angle units

; Worst-case error of the log2/atanexp angle, in the same units.  Every
; bounding box is widened by it, which makes each visibility verdict a
; superset of the exact one - so the approximation costs culling, never
; geometry.
ANGEPS          EQU     195
ORG_ADDR        EQU     CODE_BASE
IMAGE_BASE      EQU     ROWLO_A         ; the assembled image starts here

; The span pool lives in bank 2 rather than with the other scratch: it is the
; hottest data in the clipper and bank 2 is uncontended.  The live spans are a
; sorted singly-linked list and the unused slots a free chain, so an occlusion
; update edits the spans it touches and leaves the rest where they are - there
; is no second pool and nothing to swap.
SPL             EQU     $BB00           ; the span pool's LINE page (8 bytes a slot)
SPH             EQU     $BC00           ; and its HOT page: link, columns, extremes
SPANS_BASE      EQU     SPL
SPANS_MAX       EQU     32              ; the BBC port's pool: 32 slots
; Each boundary carries its extremes over the span: outer is the value further
; from the visible band, inner the value nearer it.  A line whose own extremes
; sit inside [SP_IT, SP_IB] is inside the aperture right across the span, and
; one outside [SP_OT, SP_OB] never enters it - so four byte comparisons settle
; most clips without evaluating a boundary at all.


; hot variables and stack live at the top of bank 2.  The stack's deepest
; point over the 1000 golden frames is 116 bytes (the walk's recursion is
; shallow once the box checks cull), so ~200 bytes is ample.
VARS_BASE       EQU     $BD00
STACK_TOP       EQU     $BFF0
; --- banks 6 and 7 ($C000-$FFFF): the rasteriser, above screen B in 7 and
; mirrored into the uncontended 6 for the frames drawn into buffer A --------
BANK_RASTER_A   EQU     6
RASTER_BASE     EQU     $DB00           ; above screen B's bitmap and attributes

; --- engine variables ------------------------------------------------------
m16_mult        EQU     VARS_BASE+0     ; math scratch
ln_dx           EQU     VARS_BASE+1     ; rasteriser line state
ln_dy           EQU     VARS_BASE+2
ln_left         EQU     VARS_BASE+3     ; 1 when the line runs leftward
pv_count        EQU     VARS_BASE+4
ph_x1           EQU     VARS_BASE+5
ph_x2           EQU     VARS_BASE+6
ln_err          EQU     VARS_BASE+7
ln_errs         EQU     VARS_BASE+64
ln_ls           EQU     VARS_BASE+65
dlist_ptr       EQU     VARS_BASE+8     ; next free display-list slot (2)
back_buf        EQU     VARS_BASE+10    ; 0 = A is the back buffer, 1 = B
dcls_first      EQU     VARS_BASE+13    ; dcl_solid_pair: the first span pass 1 touched (id), 0 = none
sp_live         EQU     VARS_BASE+14    ; 0 until the pool's first build (sp_reset)
dcls_prev       EQU     VARS_BASE+42    ;   and the slot before it (id), 0 = it is the head (sp_marksolid_memo)
vx_stamp        EQU     VARS_BASE+43    ; the rotated-vertex cache's generation (per view angle)
adyn_ctr        EQU     VARS_BASE+44    ; emitted-segment counter: the walk's dynamic always-descend judge
ch_v2           EQU     VARS_BASE+45    ; the vertex whose (M8, S, sx) stand in sg_m2/sg_sx2 (2), $FFFF = none
ch_hit          EQU     VARS_BASE+47    ; 1 = this seg's v1 chained from the previous seg's v2 (rows and stamp reused)
page_base       EQU     VARS_BASE+12    ; $7FFD bits for the displayed screen | P7_ROM48 (set_page ORs the bank in); kept by cpm_init and the flip

; --- view state ------------------------------------------------------------
vs_smag         EQU     VARS_BASE+16    ; sin magnitude (0.8 unsigned)
vs_sneg         EQU     VARS_BASE+17
vs_sunity       EQU     VARS_BASE+18
vs_cmag         EQU     VARS_BASE+19
vs_cneg         EQU     VARS_BASE+20
vs_cunity       EQU     VARS_BASE+21
vs_rx           EQU     VARS_BASE+22    ; per-frame view origin, s16 counts (2)
vs_ry           EQU     VARS_BASE+24
vs_vz           EQU     VARS_BASE+26    ; eye height, prescaled s8
pl_x            EQU     VARS_BASE+28    ; player position: s16 prescaled + 0.8
pl_xf           EQU     VARS_BASE+30
pl_y            EQU     VARS_BASE+31
pl_yf           EQU     VARS_BASE+33
pl_ang          EQU     VARS_BASE+34
pl_wx           EQU     VARS_BASE+36    ; raw world position for the side test
pl_wy           EQU     VARS_BASE+38
vc_stamp        EQU     VARS_BASE+40    ; vertex-cache generation

; --- transform scratch -----------------------------------------------------
tv_wx           EQU     VARS_BASE+48
tv_wy           EQU     VARS_BASE+50
tv_tvx          EQU     VARS_BASE+52
tv_tvy          EQU     VARS_BASE+54
walk_sp         EQU     VARS_BASE+56    ; SP at the walk's root: a full screen unwinds straight to it (bsp_done_full)
acc32           EQU     VARS_BASE+58    ; 4-byte little-endian accumulator
vs_nx           EQU     VARS_BASE+66
vs_ny           EQU     VARS_BASE+68
vs_dxlo         EQU     VARS_BASE+70
vs_dylo         EQU     VARS_BASE+71
vs_t1           EQU     VARS_BASE+72
vs_t2           EQU     VARS_BASE+74
vs_acc          EQU     VARS_BASE+76    ; 3 bytes
py_h            EQU     VARS_BASE+80
py_idx          EQU     VARS_BASE+85
py_res          EQU     VARS_BASE+86
vs_acc2         EQU     VARS_BASE+81    ; 3 bytes

; --- clipper state ---------------------------------------------------------
sp_head         EQU     VARS_BASE+90    ; first live span's id, 0 = none
prod_port       EQU     VARS_BASE+91    ; page_base | BANK_PROD (SET_PAGE_BASE)
sp_count        EQU     VARS_BASE+92    ; number of live spans
sp_free         EQU     VARS_BASE+93    ; first unused slot's id


; --- BSP walk --------------------------------------------------------------
bsp_node        EQU     VARS_BASE+100
bsp_side        EQU     VARS_BASE+102
bb_lo           EQU     VARS_BASE+104
bb_hi           EQU     VARS_BASE+106
bb_pts          EQU     VARS_BASE+108   ; 4 corners x (tvx, tvy)
bb_n            EQU     VARS_BASE+124
bb_any          EQU     VARS_BASE+125
sg_ptr          EQU     VARS_BASE+126
sg_v1           EQU     VARS_BASE+128
sg_v2           EQU     VARS_BASE+130
sg_m1           EQU     VARS_BASE+132   ; (M8, S, sx) of v1: the vertex
sg_s1           EQU     VARS_BASE+133   ;  record's own order, one LDI run
sg_sx1          EQU     VARS_BASE+134
sg_m2           EQU     VARS_BASE+136
sg_s2           EQU     VARS_BASE+137
sg_sx2          EQU     VARS_BASE+138
sg_ft1          EQU     VARS_BASE+140
sg_fb1          EQU     VARS_BASE+142
sg_ft2          EQU     VARS_BASE+144
sg_fb2          EQU     VARS_BASE+146
sg_bt1          EQU     VARS_BASE+148
sg_bb1          EQU     VARS_BASE+150
sg_bt2          EQU     VARS_BASE+152
sg_bb2          EQU     VARS_BASE+154
sg_flags        EQU     VARS_BASE+156
sg_fh           EQU     VARS_BASE+157
sg_ch           EQU     VARS_BASE+158
sg_bfh          EQU     VARS_BASE+159
sg_bch          EQU     VARS_BASE+160
sg_solid        EQU     VARS_BASE+161
sg_needbt       EQU     VARS_BASE+162
sg_needbb       EQU     VARS_BASE+163
sg_xlo          EQU     VARS_BASE+164
sg_xhi          EQU     VARS_BASE+166
vc_ptr          EQU     VARS_BASE+168
ss_cnt          EQU     VARS_BASE+170
ss_seg          EQU     VARS_BASE+172
frame_nodes     EQU     VARS_BASE+174
frame_ss        EQU     VARS_BASE+176
frame_segs      EQU     VARS_BASE+178
bsp_root        EQU     VARS_BASE+180
pos_dx          EQU     VARS_BASE+182
pos_dy          EQU     VARS_BASE+184
pos_ndx         EQU     VARS_BASE+186
pos_ndy         EQU     VARS_BASE+187
pos_l           EQU     VARS_BASE+188   ; 3 bytes
bb_top          EQU     VARS_BASE+192
bb_bot          EQU     VARS_BASE+194
bb_left         EQU     VARS_BASE+196
bb_right        EQU     VARS_BASE+198
bb_u1           EQU     VARS_BASE+200   ; bbox_range: the first corner, shifted (2)
bb_hi16         EQU     VARS_BASE+202
bb_pa           EQU     VARS_BASE+204
bb_pb           EQU     VARS_BASE+206
bb_ay           EQU     VARS_BASE+208
bb_byv          EQU     VARS_BASE+210
bb_ac           EQU     VARS_BASE+212
bb_bc           EQU     VARS_BASE+213
bb_cx           EQU     VARS_BASE+214
cr_p1           EQU     VARS_BASE+216
cr_p2           EQU     VARS_BASE+218
cr_vx1          EQU     VARS_BASE+220
cr_vy1          EQU     VARS_BASE+222
cr_vx2          EQU     VARS_BASE+224
cr_vy2          EQU     VARS_BASE+226
nc_d            EQU     VARS_BASE+228
nc_n            EQU     VARS_BASE+230
nc_t            EQU     VARS_BASE+232
vg_wy           EQU     VARS_BASE+234   ; the cold transform's wy (2)
sg_c1           EQU     VARS_BASE+236
sg_c2           EQU     VARS_BASE+238
sg_n1           EQU     VARS_BASE+240
sg_n2           EQU     VARS_BASE+241
ca_t            EQU     VARS_BASE+252

; --- movement --------------------------------------------------------------
mv_step         EQU     VARS_BASE+254   ; 8.8 prescaled distance per frame
mv_turn         EQU     VARS_BASE+256   ; angle units per frame
mv_dir          EQU     VARS_BASE+257
mv_smag         EQU     VARS_BASE+258
mv_sneg         EQU     VARS_BASE+259
mv_sunity       EQU     VARS_BASE+260
mv_cmag         EQU     VARS_BASE+261
mv_cneg         EQU     VARS_BASE+262
mv_cunity       EQU     VARS_BASE+263
vs_lastang      EQU     VARS_BASE+264   ; angle the product tables were built for
vs_haveang      EQU     VARS_BASE+265

; --- line clipper ----------------------------------------------------------
cl_lfn          EQU     VARS_BASE+266   ; the line as (slope 8.8, intercept)
cy_col          EQU     VARS_BASE+282
cy_val          EQU     VARS_BASE+284
bb_bx           EQU     VARS_BASE+286
bb_boxy         EQU     VARS_BASE+287
bb_cc           EQU     VARS_BASE+288
ch_vtx          EQU     VARS_BASE+300   ; the vertex whose projection the next seg inherits
ch_ft           EQU     VARS_BASE+302
ch_fb           EQU     VARS_BASE+304
vs_h            EQU     sg_fh           ; the seg's heights for its vertex spans: fh, ch, bfh, bch (aliased: rs_visible copies them there)
vs_sx           EQU     VARS_BASE+310   ; the endpoint's column (s16)
vs_ms           EQU     VARS_BASE+312   ; and its reciprocal (M8, S)
vs_i            EQU     VARS_BASE+314   ; explicit entry cursor
vs_lo           EQU     VARS_BASE+315
vs_hi           EQU     VARS_BASE+316
sg_eskip        EQU     VARS_BASE+317   ; the eyeline rule: $80 no top edges, $40 no bottom
bf_d            EQU     VARS_BASE+319   ; back-face: the integer-part dot (3)
bf_t            EQU     VARS_BASE+322   ; and one fractional term (3)
; --- the clipper (clip.z80) ---
hg_cache        EQU     VARS_BASE+325   ; has_gap's remembered span (2)
cl_ilo          EQU     VARS_BASE+327   ; the op's columns, [ilo, ihi)
cl_ihi          EQU     VARS_BASE+328
lc_x1           EQU     VARS_BASE+329   ; the line, s16, rows biased; the low
lc_y1           EQU     VARS_BASE+331   ; bytes are the u8 line once clipped
lc_x2           EQU     VARS_BASE+333
lc_y2           EQU     VARS_BASE+335
lc_ox1          EQU     VARS_BASE+337   ; the x's before the y clip
lc_ox2          EQU     VARS_BASE+338
cd_dx           EQU     VARS_BASE+339   ; the u8 line's dx, dy, min y, max y
cd_dy           EQU     VARS_BASE+340
cd_ylo          EQU     VARS_BASE+341
cd_yhi          EQU     VARS_BASE+342
ss_x            EQU     VARS_BASE+343   ; the open run: start ($FF = none), end
ss_y            EQU     VARS_BASE+344
se_x            EQU     VARS_BASE+345
ox0             EQU     VARS_BASE+346   ; the line's overlap with the span
ox1             EQU     VARS_BASE+347
cb_cx1          EQU     VARS_BASE+348   ; the clip's ends and the boundaries there
cb_cx2          EQU     VARS_BASE+349
cb_cy1          EQU     VARS_BASE+350
cb_cy2          EQU     VARS_BASE+351
cb_top1         EQU     VARS_BASE+352
cb_top2         EQU     VARS_BASE+353
cb_bot1         EQU     VARS_BASE+354
cb_bot2         EQU     VARS_BASE+355
tmp0            EQU     VARS_BASE+356   ; |d1|, |d2| for the crossing; the run's end y
tmp1            EQU     VARS_BASE+357
bix_ceil        EQU     VARS_BASE+358
iw_x0           EQU     VARS_BASE+359   ; the interp workspace: x0, den, y0, y1
iw_den          EQU     VARS_BASE+360
iw_y0           EQU     VARS_BASE+361
iw_y1           EQU     VARS_BASE+362
lci             EQU     VARS_BASE+363   ; the s16 interp block (x0, y0, x1, y1)
i_off           EQU     VARS_BASE+371   ; interp_s16 scratch
i_den           EQU     VARS_BASE+373
i_dy            EQU     VARS_BASE+375
i_neg           EQU     VARS_BASE+377
dclv_s16vy      EQU     VARS_BASE+378   ; the pending right verdict ($80 = none)
dclv_x0         EQU     VARS_BASE+379
dclv_x1         EQU     VARS_BASE+380
dclv_yv         EQU     VARS_BASE+381
fw_mode         EQU     VARS_BASE+382   ; $80 while a fused line is being clipped
fw_side         EQU     VARS_BASE+383   ; 0 the top boundary, $80 the bottom
fw_touch        EQU     VARS_BASE+384   ; any flat or run this seg
fwl_xl          EQU     lc_x1           ; the walker's line: the u8 line's low
fwl_yl          EQU     lc_y1           ;  bytes themselves (every entry to the
fwl_xr          EQU     lc_x2           ;  walker used to copy them here)
fwl_yr          EQU     lc_y2
fwl_dx          EQU     VARS_BASE+389
fwl_dy          EQU     VARS_BASE+390
fwl_lo          EQU     VARS_BASE+391
fwl_hi          EQU     VARS_BASE+392
fwl_run         EQU     VARS_BASE+393   ; the open run ($FF = none), its end, end value, start y
fwl_rend        EQU     VARS_BASE+394
fwl_rendv       EQU     VARS_BASE+395
fwl_ry0         EQU     VARS_BASE+396
fwl_zx0         EQU     VARS_BASE+397   ; the overlap with the span
fwl_zx1         EQU     VARS_BASE+398
fwl_leftf       EQU     VARS_BASE+399   ; where a left flat would start
fwl_pend        EQU     VARS_BASE+400   ; the pending right flat ($80 = none)
fw_slot         EQU     VARS_BASE+401   ; the span being clipped (IX: id, SPH>>8), its successor's id
fw_next         EQU     VARS_BASE+403
fw_rslot        EQU     VARS_BASE+405   ; the span the open run started on
fw_ax0          EQU     VARS_BASE+407   ; the apply's range
fw_ax1          EQU     VARS_BASE+408
fw_top1         EQU     VARS_BASE+409   ; the boundary at the clip's ends
fw_top2         EQU     VARS_BASE+410
cp_vx0          EQU     VARS_BASE+411   ; a visible piece
cp_vy0          EQU     VARS_BASE+412
cp_vx1          EQU     VARS_BASE+413
cp_vev          EQU     VARS_BASE+414
fw_pol          EQU     VARS_BASE+415   ; a flat's verdict
fw_split_at     EQU     VARS_BASE+416
fk_save         EQU     VARS_BASE+417   ; the seg's range across a kill (2)
sp_prev         EQU     VARS_BASE+419   ; mark_solid's predecessor (id)
vd_stamp        EQU     VARS_BASE+421   ; the frame stamp the VDONE bytes carry
pq_x            EQU     VARS_BASE+422   ; the viewer in quarter units, biased 128:
pq_y            EQU     VARS_BASE+424   ; ceil then floor, per axis
pxo             EQU     VARS_BASE+426   ; the viewer + 512: the biased bounds' zero
pyo             EQU     VARS_BASE+428
vs_spsave       EQU     VARS_BASE+430   ; the stack across the table fill (2)
px_lop          EQU     VARS_BASE+432   ; project_x: the low partial
um_bc           EQU     VARS_BASE+433   ; umul16: the operands (2 each) and
um_de           EQU     VARS_BASE+435   ;   the product r0..r3
um_r0           EQU     VARS_BASE+437
um_r2           EQU     VARS_BASE+439
cur_port        EQU     VARS_BASE+441   ; the $7FFD byte set_page last wrote
rast_port       EQU     VARS_BASE+442   ; ... and the one that pages the rasteriser
vs_tab_valid    EQU     VARS_BASE+443   ; 0 = the product tables need the lazy build
mv_dx           EQU     VARS_BASE+444   ; the frame's desired move, s16 8.8 (2 each)
mv_dy           EQU     VARS_BASE+446
cand_x          EQU     VARS_BASE+448   ; a candidate position, 8.8 prescaled (2 + frac)
cand_xf         EQU     VARS_BASE+450
cand_y          EQU     VARS_BASE+451
cand_yf         EQU     VARS_BASE+453
cm_bx0          EQU     VARS_BASE+454   ; the collision box, s16 centre-relative raw
cm_bx1          EQU     VARS_BASE+456   ; (bx0,bx1 contiguous for mk_axis; then by0,by1)
cm_by0          EQU     VARS_BASE+458
cm_by1          EQU     VARS_BASE+460
cm_c1           EQU     VARS_BASE+462   ; c0 stash across the two-column scan
cm_qx           EQU     VARS_BASE+463   ; box_clear's query point, prescaled int + frac
cm_qxf          EQU     VARS_BASE+465
cm_qy           EQU     VARS_BASE+466
cm_qyf          EQU     VARS_BASE+468
cm_lx0          EQU     VARS_BASE+469   ; a seg's x/y extents (s16)
cm_lx1          EQU     VARS_BASE+471
cm_ly0          EQU     VARS_BASE+473
cm_ly1          EQU     VARS_BASE+475
cm_cx           EQU     VARS_BASE+477   ; the corner under test (s16)
cm_cy           EQU     VARS_BASE+479
cm_c1x          EQU     VARS_BASE+481
cm_c1y          EQU     VARS_BASE+483
cm_c2x          EQU     VARS_BASE+485
cm_c2y          EQU     VARS_BASE+487
cm_s            EQU     VARS_BASE+489   ; the cross product accumulator (s32)
cm_prod         EQU     VARS_BASE+493   ; a 16x16 product (s32)
cm_acc          EQU     VARS_BASE+497   ; the shift-add multiplicand (u32)
cm_sign         EQU     VARS_BASE+501   ; product sign
pm_count        EQU     VARS_BASE+502   ; move chunks remaining
cm_vz           EQU     VARS_BASE+503   ; candidate floor vz from dest_check
cm_tmob         EQU     VARS_BASE+504   ; box_scan crossed-port floor aggregate (s8)
VARS_END        EQU     VARS_BASE+505
; --- batched sloped-edge drawing ------------------------------------------
; --- fused draw + tighten ---------------------------------------------------
; the seg chain: a subsector's segs share endpoints, so the pair projected for
; one seg's v2 is the pair its neighbour needs for v1
lf_absx         EQU     VARS_BASE+290
lf_wtmp         EQU     VARS_BASE+88
ds_cx1          EQU     VARS_BASE+291
ds_cx2          EQU     VARS_BASE+292

STEP_WALK       EQU     $0500           ; 5 prescaled units = 40 world units
STEP_RUN        EQU     $0A00
TURN_WALK       EQU     3
TURN_RUN        EQU     5

; (no IM 2 vector table: the engine runs in IM 1 - see setup_int)

; --- bank 0 ($C000-$FFFF): geometry ----------------------------------------
GEO_BASE        EQU     $C000
VP_OX           EQU     GEO_BASE+$0000  ; 512: x low byte per vertex
VP_OY           EQU     GEO_BASE+$0200  ; 512: y low byte
VP_PG           EQU     GEO_BASE+$0400  ; 512: ((x>>7)+4)&7 | ((y>>7)+4)&7 << 3 (128-unit pages)
SEGS            EQU     GEO_BASE+$0720  ; 644 x 16
SEG_SIZE        EQU     16
SSEC            EQU     GEO_BASE+$2F60  ; 196 x (count, first_lo, first_hi)
SECFH           EQU     GEO_BASE+$31B0  ; 85 x s8
SECCH           EQU     GEO_BASE+$3210
SSSEC           EQU     GEO_BASE+$3BA0  ; sector index per subsector
EYEZ            EQU     GEO_BASE+$3C70  ; prescaled eye height per sector
VSDESC          EQU     GEO_BASE+$3CD0  ; vertex-span descriptors, one a vertex
VSEXPL          EQU     GEO_BASE+$3EA0  ; their explicit entries, (lo, hi, cont)


; --- the clipper (clip.z80): an exact port of the BBC port's EndpointClipSpans
; The BBC port's pool: a slot is an id (its record's low byte, a multiple of
; 8, 0 = none / the end of a list), its hot fields on the SPH page and its
; two lines on the SPL page below it (dec h), so a walk holds one byte and
; the page never changes.
SLOT_SIZE       EQU     8
SP_NEXT         EQU     0               ; the successor's id, 0 = none
SP_XS           EQU     1               ; the active columns, [xs, xe)
SP_XE           EQU     2
SP_OT           EQU     3               ; min(tl, tr), max(tl, tr)
SP_IT           EQU     4
SP_OB           EQU     5               ; max(bl, br), min(bl, br)
SP_IB           EQU     6
SL_TXLO         EQU     0               ; the top line: y at xlo and at xlo + den
SL_TDEN         EQU     1
SL_TL           EQU     2
SL_TR           EQU     3
SL_BXLO         EQU     4               ; the bottom line
SL_BDEN         EQU     5
SL_BL           EQU     6
SL_BR           EQU     7
; (VDONE folded into the VXR record, +VXR_DONE)
; seg record
SG_V1           EQU     0               ; (v1 * 8) & 255: the record's low byte
SG_V2           EQU     1               ; (v2 * 8) & 255
SG_VHI          EQU     2               ; v1 >> 5 | (v2 >> 5) << 4: the records' page offsets
SG_FLAGS        EQU     3
SG_FH           EQU     4
SG_CH           EQU     5
SG_BFH          EQU     6
SG_BCH          EQU     7
SG_LX           EQU     8
SG_LY           EQU     10
SG_LDX          EQU     12
SG_LDY          EQU     13
SG_LXF          EQU     14              ; the reference point's 0.8 fractions
SG_LYF          EQU     15

SF_SOLID        EQU     $80
SF_STEPUP_T     EQU     $40             ; portal: back ceiling above the front's
SF_STEPUP_B     EQU     $20             ; portal: back floor below the front's
SF_LDX0         EQU     $10             ; linedef runs north-south
SF_LDY0         EQU     $08             ; linedef runs east-west
SF_NEEDBT       EQU     $04             ; portal: back ceiling below the front's
SF_NEEDBB       EQU     $02             ; portal: back floor above the front's

; node record
ND_PX           EQU     0               ; the node records (NODES4, bank 4): partition
ND_PY           EQU     2               ;   point (s16 world) and gcd-reduced direction
ND_RDX          EQU     4
ND_RDY          EQU     5
ND_CHILD0       EQU     6               ; DOOM encoding, bit 15 = subsector
ND_CHILD1       EQU     8
ND_SIZE         EQU     10

NEAR_VERDICT    EQU     16              ; 0.5 prescaled units, in TRUE16 counts
NEAR_CROSS      EQU     32

; --- static objects (bank 4 at $C000: bsp/objects.s) -----------------------
; The bank holds the object code, the packer's planes, the art templates and
; the workspace; obj_subsector_stub pages it in for the duration of a
; subsector's objects and restores the geometry bank.  Only the any-objects
; probe bitmap lives in bank 2, read before the page flip.
BANK_OBJ        EQU     4
; The collision tables (coldata.bin) and the collision code sit above the
; rasteriser in banks 6/7 (the image carries them; read_input pages bank 6,
; the uncontended copy, in), which keeps bank 2 for the render path.
BANK_COL        EQU     6               ; = BANK_RASTER_A
COL_SEG         EQU     $EE00           ; N x 8: blocking lines (x1,y1,dx,dy s16, centre-rel)
COL_PORT        EQU     $F500           ; ports: x1,y1,dx,dy s16 + ob,ot,mv (11 bytes)
COL_IDX         EQU     $F800           ; 36 x 3: per X column (list ptr lo, hi, count)
COL_LIST        EQU     $F880           ; u8 unified indices (idx < COL_N_SOLID = solid)
COL_CODE        EQU     $FA40           ; collide.z80
COL_N_SOLID     EQU     204             ; colmap len(colsegs); idx >= this is a port
DOOR_MIN_OPEN   EQU     7               ; colmap DOOR_MIN_OPEN_PS (56 world)
EYE_PS          EQU     5               ; colmap EYE_PS (+41 world eye offset)
PL_RADIUS       EQU     16              ; the player's collision box half-width (world)
PM_STEP_PS      EQU     4               ; max step up (prescaled); DOOM's 24 world units
MM_HALF         EQU     724             ; max move chunk (8.8 prescaled); a chunk's
                                        ; diagonal stays under 2*RADIUS so a move
                                        ; cannot tunnel a thin wall (BBC colmap)
COL_RAWX_MIN    EQU     -1936           ; column 0's left edge, centre-relative (colmap)
OBJ_CODE        EQU     $C000           ; obj_subsector is the first byte
OBJ_T47         EQU     $D200           ; 256 x u8: (m * 47 * 4 + 128) >> 8, obj_s7's
                                        ; rounding product, built by cpm_init
OBJ_DATA        EQU     $D300           ; objdata.bin (tools/pack.py)
N_OBJ           EQU     50              ; LAY_N_OBJ
OBJ_OX7         EQU     OBJ_DATA+0*N_OBJ    ; x: the 7-bit offset (as VP_OX)
OBJ_PG          EQU     OBJ_DATA+1*N_OBJ    ; the 6-bit page pair (as VP_PG)
OBJ_OY7         EQU     OBJ_DATA+2*N_OBJ    ; y: the 7-bit offset
OBJ_SPARE       EQU     OBJ_DATA+3*N_OBJ
OBJ_SS          EQU     OBJ_DATA+4*N_OBJ    ; home subsector (the planes are
OBJ_ASP         EQU     OBJ_DATA+5*N_OBJ    ;   sorted by it); kind index
OBJ_ZT          EQU     OBJ_DATA+6*N_OBJ    ; prescaled top, s8
OBJ_ZB          EQU     OBJ_DATA+7*N_OBJ    ; prescaled floor, s8
OBJ_BITS_LEN    EQU     25              ; (n_ss + 7) / 8
OBJ_BITS        EQU     OBJ_DATA+8*N_OBJ    ; per-subsector has-objects bitmap
OBJ_RUN8        EQU     OBJ_BITS+OBJ_BITS_LEN ; per octet: its first object
OBJ_ART         EQU     OBJ_DATA+$200   ; three 256-byte template windows
OBJ_ART_ARM     EQU     $FE             ; template entry: arm the FUSED run
OBJ_ART_END     EQU     $FF             ; template entry: finished
OBJ_MAXSLOT     EQU     6               ; objects staged per subsector
VIS_YMAX        EQU     Y_BIAS+159      ; the last visible biased row
OBJ_K_LAMP      EQU     1
OBJ_K_HELMET    EQU     3
OBJ_K_BOXS      EQU     4
OBJ_K_VEST      EQU     6
OBJ_ANYB        EQU     $BAD0           ; bank 2 copy of OBJ_BITS (25 bytes, just under the span pool)
; the workspace, bank 4 (objects.s SEG_WORK)
OBJ_WS          EQU     $F420           ; (past VATOX's 1025th entry)
obj_i           EQU     OBJ_WS+0        ; the object being projected
obj_cx          EQU     OBJ_WS+1        ; centre column, s16
obj_yt          EQU     OBJ_WS+3        ; top and floor rows, s16 biased
obj_yb          EQU     OBJ_WS+5
obj_h           EQU     OBJ_WS+7        ; height in rows (255 clamp)
obj_t           EQU     OBJ_WS+8        ; scratch; the probe's cursor
obj_cur         EQU     obj_t
obj_a           EQU     OBJ_WS+9        ; half width; a2 = 47a/64, a3 = a - a2
obj_a2          EQU     OBJ_WS+10
obj_a3          EQU     OBJ_WS+11
obj_b           EQU     OBJ_WS+12       ; the lid's half height and its pair
obj_b2          EQU     OBJ_WS+13
obj_b3          EQU     OBJ_WS+14
obj_dy          EQU     OBJ_WS+15       ; h - 2b: lid to base
obj_pu          EQU     OBJ_WS+16       ; ladder scratch: a rounded product
obj_pb          EQU     OBJ_WS+17       ; 5 bytes: magnitudes / a y base
obj_px          EQU     OBJ_WS+22       ; obj_mirror's +side offset
obj_pn          EQU     OBJ_WS+23
obj_lod         EQU     OBJ_WS+24       ; 0 far tier, 1 near tier
obj_n           EQU     OBJ_WS+25       ; objects staged
obj_left        EQU     OBJ_WS+26
obj_best        EQU     OBJ_WS+27
obj_fast        EQU     OBJ_WS+28       ; 1: every art line inside the aperture
obj_asp         EQU     OBJ_WS+29       ; the live object's kind
obj_fused       EQU     OBJ_WS+30       ; inside the template's FUSED run
obj_ss          EQU     OBJ_WS+31
obj_ctr         EQU     OBJ_WS+32       ; obj_hex's centre, s16
obj_e           EQU     OBJ_WS+34       ; the template entry pointer
obj_mulb        EQU     OBJ_WS+36       ; umul8's fixed multiplier
obj_vy          EQU     OBJ_WS+37       ; view depth, s16
obj_tgx         EQU     OBJ_WS+39       ; ladder table pointers (2 each)
obj_tnx         EQU     OBJ_WS+41
obj_tpx         EQU     OBJ_WS+43
obj_sd          EQU     OBJ_WS+46       ; staging: 6 x s16 depth, centre,
obj_scx         EQU     OBJ_WS+58       ;   top, floor; 6 kinds
obj_syt         EQU     OBJ_WS+70
obj_syb         EQU     OBJ_WS+82
obj_sasp        EQU     OBJ_WS+94       ; ..OBJ_WS+99
FS_WS           EQU     $F4E0           ; frame-setup workspace (bank 4)
vs_m16s         EQU     FS_WS+0         ; |sin| as 1..256 (2)
vs_m16c         EQU     FS_WS+2
vs_kx           EQU     FS_WS+4         ; sS * 32 * |sin| (2)
vs_ky           EQU     FS_WS+6
vs_fixx         EQU     FS_WS+8         ; the PB build's row fixups: 8kx + ky, 8ky - kx (2 each)
vs_fixy         EQU     FS_WS+10
vs_rows         EQU     FS_WS+12        ;   and its row count
OBJ_XY          EQU     $F4A0           ; the art vertex block: 6 x s16 x then
obj_X           EQU     OBJ_XY          ;   26 x s16 y - templates index it in
obj_Y           EQU     OBJ_XY+12       ;   bytes from obj_X (x) or obj_Y (y)

; --- the walk bank (bank 4, walkdata.bin): the node records and the BBC
; port's angle-space box check (ang/bca.s) with its tables --------------------
NODES4          EQU     $D800           ; the node planes (walkdata.bin starts here)
; the node fields as node-id-indexed planes (the BBC port's NODE_* layout):
; a field is `ld h,NP_x / ld a,(hl)` with L = the node id
NP_NXL          EQU     $D8             ; the partition point, s16 world
NP_NXH          EQU     $D9
NP_NYL          EQU     $DA
NP_NYH          EQU     $DB
NP_C0L          EQU     $DC             ; the children, DOOM encoding (bit 15 = subsector)
NP_C0H          EQU     $DD
NP_C1L          EQU     $DE
NP_C1H          EQU     $DF
NP_RDX          EQU     $FB             ; the gcd-reduced direction, s8
NP_RDY          EQU     $FC
BBP_BASE        EQU     $E000           ; the BBC's bounding-box planes: 4 fields
                                        ; (top, bottom, left, right) x (lo, hi)
                                        ; x (right box, left box), node-indexed;
                                        ; hi bytes offset-binned (^$80)
BBP_T_LO        EQU     $E0             ; the pages: + 2 for the hi byte, + 1
BBP_B_LO        EQU     $E4             ;   for the left child's box
BBP_L_LO        EQU     $E8
BBP_R_LO        EQU     $EC
VATOX_PG        EQU     $F0             ; 1025 x u8: the column for a view-relative
                                        ; fine angle r in [0, 1024]
L8_PG           EQU     $F5             ; 256 x u8: round(log2(v) * 32)
AE_LO_PG        EQU     $F6             ; 256 x u16 (lo, hi planes): ATANEXP in
                                        ; fine angles (4096 = a turn), 0..512
CPM_PG          EQU     $F8             ; the corner-phi memo, 128 slots, 6 planes:
                                        ; KDXL $F800, KDXH $F880, KDYL $F900,
                                        ; KDYH $F980, PSIL $FA00, PSIH $FA80
CPM_PSI_PG      EQU     $FA
ND_POL          EQU     $F800           ; per node: the dynamic always-descend bits, $80 = side 0, $40 = side 1 (BBC 4cab6b5); the retired corner-phi memo's first page ($FB00 is NP_RDX)
                                        ; 0/1, $10/$20 same-as-parent serve
BCA_WS          EQU     $FD00           ; the check's workspace
bca_pxs         EQU     BCA_WS+0        ; the viewer, s16 with the hi byte ^$80 (2 each)
bca_pys         EQU     BCA_WS+2
bca_afn         EQU     BCA_WS+4        ; ab*16 + 512 + EPSILON, 12-bit (hi nibble)
pa_dx           EQU     BCA_WS+6        ; the corner's delta, s16
pa_dy           EQU     BCA_WS+8
bca_p1          EQU     BCA_WS+10       ; the first corner's r
cpm_slot        EQU     BCA_WS+12       ; the memo slot (with bit 7 set)
bca_nid         EQU     BCA_WS+13       ; the node under check
PA_OCT          EQU     BCA_WS+$10      ; 8 x (octant base hi | sign << 7)
bd_l            EQU     BCA_WS+$18      ; the bound deltas from the viewer, s16
bd_r            EQU     BCA_WS+$1A
bd_t            EQU     BCA_WS+$1C
bd_b            EQU     BCA_WS+$1E
EPSILON_F       EQU     12              ; the atanexp bucket error, fine angles
