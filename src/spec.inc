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
DLIST_BASE      EQU     $5C00           ; display list: 4 bytes per segment
DLIST_MAX       EQU     704
DLIST_END       EQU     DLIST_BASE + DLIST_MAX*4             ; $6800

DLIST_END_PAGE  EQU     DLIST_END>>8

NODEBB          EQU     $6800           ; 195 x 8 quarter-prescale bounds

VCACHE_BASE     EQU     $7000           ; 512 x 8, indexed by vertex
VCACHE_ENT      EQU     8
VC_STAMP        EQU     0               ; frame generation; 0 = empty
VC_TVX          EQU     2               ; view-space counts, s16
VC_TVY          EQU     4
VC_SX           EQU     6               ; projected screen column, s16

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
; per-frame products i*sin_mag and i*cos_mag, as byte planes
TSLO            EQU     $8B00
TSHI            EQU     $8C00
TCLO            EQU     $8D00
TCHI            EQU     $8E00
CODE_BASE       EQU     $8F00
ORG_ADDR        EQU     CODE_BASE

; The span pool lives in bank 2 rather than with the other scratch: it is the
; hottest data in the clipper and bank 2 is uncontended.
SPANS_BASE      EQU     $B800        ; two pools of 480 bytes, both below VARS_BASE
SPANS_MAX       EQU     40              ; measured peak is 31
SPAN_SIZE       EQU     12              ; xlo,xlast,tslope(2),tint(2),bslope(2),bint(2),pad(2)
SP_XLO          EQU     0
SP_XLAST        EQU     1               ; inclusive, so a span is [xlo, xlast]
SP_TA           EQU     2               ; top slope, 8.8 signed
SP_TB           EQU     4               ; top intercept, s16
SP_BA           EQU     6
SP_BB           EQU     8
SPANS_TOP       EQU     SPANS_BASE + SPANS_MAX*SPAN_SIZE
; scratch pool that tighten and mark_solid build into before swapping
SPANS_ALT       EQU     SPANS_TOP

; hot variables and stack live at the top of bank 2
VARS_BASE       EQU     $BC00
STACK_TOP       EQU     $BFF0

; --- engine variables ------------------------------------------------------
m16_mult        EQU     VARS_BASE+0     ; math scratch
ln_dx           EQU     VARS_BASE+1     ; rasteriser line state
ln_dy           EQU     VARS_BASE+2
ln_sy           EQU     VARS_BASE+3
pv_count        EQU     VARS_BASE+4
ph_x1           EQU     VARS_BASE+5
ph_x2           EQU     VARS_BASE+6
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
rc_m8           EQU     VARS_BASE+56
rc_s            EQU     VARS_BASE+57
acc32           EQU     VARS_BASE+58    ; 4-byte little-endian accumulator
px_def          EQU     VARS_BASE+62
px_s            EQU     VARS_BASE+63
px_tmp          EQU     VARS_BASE+64
vs_nx           EQU     VARS_BASE+66
vs_ny           EQU     VARS_BASE+68
vs_dxlo         EQU     VARS_BASE+70
vs_dylo         EQU     VARS_BASE+71
vs_t1           EQU     VARS_BASE+72
vs_t2           EQU     VARS_BASE+74
vs_acc          EQU     VARS_BASE+76    ; 3 bytes
py_h            EQU     VARS_BASE+80
px_frac         EQU     VARS_BASE+81
px_vx           EQU     VARS_BASE+82
px_m8           EQU     VARS_BASE+83
px_p2           EQU     VARS_BASE+84

; --- clipper state ---------------------------------------------------------
sp_head         EQU     VARS_BASE+90    ; base of the live span array
sp_count        EQU     VARS_BASE+92    ; number of live spans
sp_wr           EQU     VARS_BASE+93    ; write cursor while rebuilding
sp_wcount       EQU     VARS_BASE+95
cl_lo           EQU     VARS_BASE+96    ; operation x range, [lo, hi)
cl_hi           EQU     VARS_BASE+98
cl_sx1          EQU     VARS_BASE+100   ; tighten inputs, all s16
cl_sx2          EQU     VARS_BASE+102
cl_yt1          EQU     VARS_BASE+104
cl_yt2          EQU     VARS_BASE+106
cl_yb1          EQU     VARS_BASE+108
cl_yb2          EQU     VARS_BASE+110
cl_ntf          EQU     VARS_BASE+112   ; new top fn (slope, intercept)
cl_nbf          EQU     VARS_BASE+116
ln_x1           EQU     VARS_BASE+120   ; line being clipped, s16
ln_y1           EQU     VARS_BASE+122
ln_x2           EQU     VARS_BASE+124
ln_y2           EQU     VARS_BASE+126
cl_t0           EQU     VARS_BASE+128
cl_t1           EQU     VARS_BASE+130
cl_dx           EQU     VARS_BASE+132
cl_dy           EQU     VARS_BASE+134
cl_span         EQU     VARS_BASE+136   ; current span pointer
dv_num          EQU     VARS_BASE+138
dv_den          EQU     VARS_BASE+140
dv_sign         EQU     VARS_BASE+142
pw_f            EQU     VARS_BASE+144   ; piecewise inputs
pw_g            EQU     VARS_BASE+148
pw_x0           EQU     VARS_BASE+152
pw_x1           EQU     VARS_BASE+154
pw_out          EQU     VARS_BASE+156   ; up to 2 pieces: x0,x1,fn(4)
ev_tmp          EQU     VARS_BASE+176
seg_ptr         EQU     VARS_BASE+178
bsp_tmp         EQU     VARS_BASE+180
dv_q            EQU     VARS_BASE+182
fm_a            EQU     VARS_BASE+184
fm_b            EQU     VARS_BASE+186
fm_acc          EQU     VARS_BASE+188
fm_t            EQU     VARS_BASE+190
lf_out          EQU     VARS_BASE+192
lf_slope_v      EQU     VARS_BASE+194
lf_y            EQU     VARS_BASE+196
cl_lx1          EQU     VARS_BASE+198
cl_lx2          EQU     VARS_BASE+200
cl_ly1          EQU     VARS_BASE+202
cl_ly2          EQU     VARS_BASE+204
ev_col_x        EQU     VARS_BASE+206
sp_src          EQU     VARS_BASE+208
sp_n            EQU     VARS_BASE+210
pw_n            EQU     VARS_BASE+211
tg_tf           EQU     VARS_BASE+212   ; winning top fn for the current piece
tg_bf           EQU     VARS_BASE+216
tg_ox0          EQU     VARS_BASE+220
tg_ox1          EQU     VARS_BASE+222
tg_right        EQU     VARS_BASE+224
cl_ta           EQU     VARS_BASE+226
cl_tb           EQU     VARS_BASE+228
cl_ba           EQU     VARS_BASE+230
cl_bb           EQU     VARS_BASE+232
cl_xlo          EQU     VARS_BASE+234
cl_xhi          EQU     VARS_BASE+236
cl_p            EQU     VARS_BASE+238
cl_q            EQU     VARS_BASE+240
pw2_x0          EQU     VARS_BASE+242
pw2_x1          EQU     VARS_BASE+244
pw2_f           EQU     VARS_BASE+246
tg_iter         EQU     VARS_BASE+250
dl_x1           EQU     VARS_BASE+252
dl_y1           EQU     VARS_BASE+254
dl_x2           EQU     VARS_BASE+256
dl_y2           EQU     VARS_BASE+258
sp_tmp8         EQU     VARS_BASE+260   ; 2
sp_scratch      EQU     VARS_BASE+264   ; one span record
pw_mode         EQU     VARS_BASE+280
pw_da           EQU     VARS_BASE+282
pw_db           EQU     VARS_BASE+284
pw_d0           EQU     VARS_BASE+286
pw_d1           EQU     VARS_BASE+288
pw_cx           EQU     VARS_BASE+290
tg_piece        EQU     VARS_BASE+292   ; 4 x (x0, x1, fnptr) staging
tg_tp           EQU     VARS_BASE+308
tg_bp           EQU     VARS_BASE+312
tg_xlo          EQU     VARS_BASE+316
tg_xlast        EQU     VARS_BASE+317
tg_ilo          EQU     VARS_BASE+318
tg_ihi          EQU     VARS_BASE+320
tg_ntop         EQU     VARS_BASE+322
tg_nbot         EQU     VARS_BASE+324
tg_ox0v         EQU     VARS_BASE+326
tg_ox1v         EQU     VARS_BASE+327
tg_tp2          EQU     VARS_BASE+328
tg_bp2          EQU     VARS_BASE+330
tg_tx0          EQU     VARS_BASE+332
tg_tx1          EQU     VARS_BASE+333
tg_bx0          EQU     VARS_BASE+334
tg_bx1          EQU     VARS_BASE+335
tg_biter        EQU     VARS_BASE+336
dv_top          EQU     VARS_BASE+338
dv_bot          EQU     VARS_BASE+340
dv_a            EQU     VARS_BASE+342
dv_b            EQU     VARS_BASE+344
cl_ax           EQU     VARS_BASE+346   ; endpoint pairs: x then y
cl_ay           EQU     VARS_BASE+348
cl_bx           EQU     VARS_BASE+350
cl_by           EQU     VARS_BASE+352
ct_t            EQU     VARS_BASE+354
ct_x            EQU     VARS_BASE+356
cy_p            EQU     VARS_BASE+358

; --- BSP walk --------------------------------------------------------------
bsp_node        EQU     VARS_BASE+360
bsp_side        EQU     VARS_BASE+362
bb_lo           EQU     VARS_BASE+364
bb_hi           EQU     VARS_BASE+366
bb_pts          EQU     VARS_BASE+368   ; 4 corners x (tvx, tvy)
bb_n            EQU     VARS_BASE+384
bb_any          EQU     VARS_BASE+385
sg_ptr          EQU     VARS_BASE+386
sg_v1           EQU     VARS_BASE+388
sg_v2           EQU     VARS_BASE+390
sg_sx1          EQU     VARS_BASE+392
sg_sx2          EQU     VARS_BASE+394
sg_m1           EQU     VARS_BASE+396
sg_s1           EQU     VARS_BASE+397
sg_m2           EQU     VARS_BASE+398
sg_s2           EQU     VARS_BASE+399
sg_ft1          EQU     VARS_BASE+400
sg_fb1          EQU     VARS_BASE+402
sg_ft2          EQU     VARS_BASE+404
sg_fb2          EQU     VARS_BASE+406
sg_bt1          EQU     VARS_BASE+408
sg_bb1          EQU     VARS_BASE+410
sg_bt2          EQU     VARS_BASE+412
sg_bb2          EQU     VARS_BASE+414
sg_flags        EQU     VARS_BASE+416
sg_fh           EQU     VARS_BASE+417
sg_ch           EQU     VARS_BASE+418
sg_bfh          EQU     VARS_BASE+419
sg_bch          EQU     VARS_BASE+420
sg_solid        EQU     VARS_BASE+421
sg_needbt       EQU     VARS_BASE+422
sg_needbb       EQU     VARS_BASE+423
sg_xlo          EQU     VARS_BASE+424
sg_xhi          EQU     VARS_BASE+426
vc_ptr          EQU     VARS_BASE+428
ss_cnt          EQU     VARS_BASE+430
ss_seg          EQU     VARS_BASE+432
frame_nodes     EQU     VARS_BASE+434
frame_ss        EQU     VARS_BASE+436
frame_segs      EQU     VARS_BASE+438
bsp_root        EQU     VARS_BASE+440
pos_dx          EQU     VARS_BASE+442
pos_dy          EQU     VARS_BASE+444
pos_ndx         EQU     VARS_BASE+446
pos_ndy         EQU     VARS_BASE+447
pos_l           EQU     VARS_BASE+448   ; 3 bytes
bb_top          EQU     VARS_BASE+452
bb_bot          EQU     VARS_BASE+454
bb_left         EQU     VARS_BASE+456
bb_right        EQU     VARS_BASE+458
bb_lo16         EQU     VARS_BASE+460
bb_hi16         EQU     VARS_BASE+462
bb_pa           EQU     VARS_BASE+464
bb_pb           EQU     VARS_BASE+466
bb_ay           EQU     VARS_BASE+468
bb_by           EQU     VARS_BASE+470
bb_ac           EQU     VARS_BASE+472
bb_bc           EQU     VARS_BASE+473
bb_cx           EQU     VARS_BASE+474
cr_p1           EQU     VARS_BASE+476
cr_p2           EQU     VARS_BASE+478
cr_vx1          EQU     VARS_BASE+480
cr_vy1          EQU     VARS_BASE+482
cr_vx2          EQU     VARS_BASE+484
cr_vy2          EQU     VARS_BASE+486
nc_d            EQU     VARS_BASE+488
nc_n            EQU     VARS_BASE+490
nc_t            EQU     VARS_BASE+492
vg_idx          EQU     VARS_BASE+494
sg_c1           EQU     VARS_BASE+496
sg_c2           EQU     VARS_BASE+498
sg_n1           EQU     VARS_BASE+500
sg_n2           EQU     VARS_BASE+501
hg_lo           EQU     VARS_BASE+502
hg_hi           EQU     VARS_BASE+503
hg_clo          EQU     VARS_BASE+504
hg_chi          EQU     VARS_BASE+505
al_lo           EQU     VARS_BASE+506
al_hi           EQU     VARS_BASE+507
hg_col          EQU     VARS_BASE+508
hg_top          EQU     VARS_BASE+510
ca_t            EQU     VARS_BASE+512

; --- movement --------------------------------------------------------------
mv_step         EQU     VARS_BASE+514   ; 8.8 prescaled distance per frame
mv_turn         EQU     VARS_BASE+516   ; angle units per frame
mv_dir          EQU     VARS_BASE+517
mv_smag         EQU     VARS_BASE+518
mv_sneg         EQU     VARS_BASE+519
mv_sunity       EQU     VARS_BASE+520
mv_cmag         EQU     VARS_BASE+521
mv_cneg         EQU     VARS_BASE+522
mv_cunity       EQU     VARS_BASE+523
vs_lastang      EQU     VARS_BASE+524   ; angle the product tables were built for
vs_haveang      EQU     VARS_BASE+525

STEP_WALK       EQU     $0500           ; 5 prescaled units = 40 world units
STEP_RUN        EQU     $0A00
TURN_WALK       EQU     3
TURN_RUN        EQU     5

; --- IM2 vector table and handler ------------------------------------------
IM2_TABLE       EQU     $B600           ; 257 bytes of $B5
IM2_HANDLER     EQU     $B5B5

; --- bank 0 ($C000-$FFFF): geometry ----------------------------------------
GEO_BASE        EQU     $C000
VERTS           EQU     GEO_BASE+$0000  ; 455 x (s16 x, s16 y), prescaled
SEGS            EQU     GEO_BASE+$0720  ; 644 x 16
SSEC            EQU     GEO_BASE+$2F60  ; 196 x (count, first_lo, first_hi)
SECFH           EQU     GEO_BASE+$31B0  ; 85 x s8
SECCH           EQU     GEO_BASE+$3210
NODES           EQU     GEO_BASE+$3270  ; 195 x 16
SSSEC           EQU     GEO_BASE+$3EA0  ; sector index per subsector
EYEZ            EQU     GEO_BASE+$3F70  ; prescaled eye height per sector

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

SF_SOLID        EQU     $80
SF_NOVT1        EQU     $40
SF_NOVT2        EQU     $20
SF_LDX0         EQU     $10             ; linedef runs north-south
SF_LDY0         EQU     $08             ; linedef runs east-west

; node record
ND_PX           EQU     0
ND_PY           EQU     2
ND_RDX          EQU     4
ND_RDY          EQU     5
ND_CHILD0       EQU     6
ND_CHILD1       EQU     8

NEAR_VERDICT    EQU     16              ; 0.5 prescaled units, in TRUE16 counts
NEAR_CROSS      EQU     32
