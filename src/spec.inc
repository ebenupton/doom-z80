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
PBX             EQU     $6BA0           ; 16 x s16: the page term of L(w)x
PBY             EQU     $6BC0           ;   and of L(w)y
TS_TAB          EQU     $6C00           ; 256 x u16 (lo, hi): X * |sin|
TC_TAB          EQU     $6E00           ; 256 x u16: X * |cos|

VCACHE_BASE     EQU     $7000           ; NVERTS x 9, indexed by vertex
VCACHE_ENT      EQU     9
VC_STAMP        EQU     0               ; frame generation; 0 = empty
VC_TVY          EQU     1               ; view-space depth, s16 counts
VC_SX           EQU     3               ; projected screen column, s16
VC_M8           EQU     5               ; and its reciprocal, (M8, S)
VC_S            EQU     6
VC_TVX          EQU     7               ; view-space x, s16 (near crossings)

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
SPANS_BASE      EQU     $BB80
SPANS_MAX       EQU     32              ; the BBC port's pool: 32 slots
; Each boundary carries its extremes over the span: outer is the value further
; from the visible band, inner the value nearer it.  A line whose own extremes
; sit inside [SP_IT, SP_IB] is inside the aperture right across the span, and
; one outside [SP_OT, SP_OB] never enters it - so four byte comparisons settle
; most clips without evaluating a boundary at all.


; hot variables and stack live at the top of bank 2.  The stack's deepest
; point over the 1000 golden frames is 116 bytes (the walk's recursion is
; shallow once the box checks cull), so ~200 bytes is ample.
VARS_BASE       EQU     $BD80
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
sp_head         EQU     VARS_BASE+90    ; first live span, 0 = none
sp_count        EQU     VARS_BASE+92    ; number of live spans
sp_free         EQU     VARS_BASE+93    ; first unused slot


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
sg_sx1          EQU     VARS_BASE+132
sg_sx2          EQU     VARS_BASE+134
sg_m1           EQU     VARS_BASE+136
sg_s1           EQU     VARS_BASE+137
sg_m2           EQU     VARS_BASE+138
sg_s2           EQU     VARS_BASE+139
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
vs_h            EQU     VARS_BASE+306   ; the seg's heights for its vertex spans: fh, ch, bfh, bch
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
fwl_xl          EQU     VARS_BASE+385   ; the walker's line
fwl_yl          EQU     VARS_BASE+386
fwl_xr          EQU     VARS_BASE+387
fwl_yr          EQU     VARS_BASE+388
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
fw_slot         EQU     VARS_BASE+401   ; the span being clipped, its successor
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
sp_prev         EQU     VARS_BASE+419   ; mark_solid's predecessor (2)
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
VARS_END        EQU     VARS_BASE+444
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
VP_PG           EQU     GEO_BASE+$0400  ; 512: ((x>>8)+2)&3 | ((y>>8)+2)&3 << 2
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
SLOT_SIZE       EQU     16
SP_NEXT         EQU     0               ; the successor, 0 = none (2)
SP_XS           EQU     2               ; the active columns, [xs, xe)
SP_XE           EQU     3
SP_TXLO         EQU     4               ; the top line: y at xlo and at xlo + den
SP_TDEN         EQU     5
SP_TL           EQU     6
SP_TR           EQU     7
SP_BXLO         EQU     8               ; the bottom line
SP_BDEN         EQU     9
SP_BL           EQU     10
SP_BR           EQU     11
SP_OT           EQU     12              ; min(tl, tr), max(tl, tr)
SP_IT           EQU     13
SP_OB           EQU     14              ; max(bl, br), min(bl, br)
SP_IB           EQU     15
SPANS_TOP       EQU     SPANS_BASE + SPANS_MAX*SLOT_SIZE
VDONE           EQU     $B700           ; a frame stamp per vertex: its spans went out (455 bytes, bank 2)
; seg record
SG_V1           EQU     0
SG_V2           EQU     1
SG_VHI          EQU     2
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
OBJ_CODE        EQU     $C000           ; obj_subsector is the first byte
OBJ_DATA        EQU     $D300           ; objdata.bin (tools/pack.py)
N_OBJ           EQU     50              ; LAY_N_OBJ
OBJ_OXL         EQU     OBJ_DATA+0*N_OBJ    ; prescaled x, s16
OBJ_OXH         EQU     OBJ_DATA+1*N_OBJ
OBJ_OYL         EQU     OBJ_DATA+2*N_OBJ    ; prescaled y
OBJ_OYH         EQU     OBJ_DATA+3*N_OBJ
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
OBJ_ANYB        EQU     $B8D0           ; bank 2 copy of OBJ_BITS (25 bytes, below the second display list)
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
vs_fa           EQU     FS_WS+8         ; -2kx, -kx, 0, kx
vs_fb           EQU     FS_WS+16        ; -2ky, -ky, 0, ky
OBJ_XY          EQU     $F4A0           ; the art vertex block: 6 x s16 x then
obj_X           EQU     OBJ_XY          ;   26 x s16 y - templates index it in
obj_Y           EQU     OBJ_XY+12       ;   bytes from obj_X (x) or obj_Y (y)

; --- the walk bank (bank 4, walkdata.bin): the node records and the BBC
; port's angle-space box check (ang/bca.s) with its tables --------------------
NODES4          EQU     $D800           ; 195 x ND_SIZE
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
ND_POL          EQU     $FB00           ; per node: $40/$80 always-descend side
                                        ; 0/1, $10/$20 same-as-parent serve
BCA_WS          EQU     $FC00           ; the check's workspace
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
