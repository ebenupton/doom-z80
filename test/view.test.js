const { ZHarness, s8, s16 } = require('/Users/ebenupton/doom_z80/tools/zcall.js');
const fs = require('fs');
const V = JSON.parse(fs.readFileSync('/Users/ebenupton/doom_z80/build/vec.json','utf8'));
const z = new ZHarness('/Users/ebenupton/doom_z80/test/t_view.z80');
// load the packed tables at $8800
z.pokeBytes(0x8800, fs.readFileSync('/Users/ebenupton/doom_z80/build/tables.bin'));
z.call('sq_init');

let fail = 0, shown = 0, tested = 0;
const chk = (n,g,w,c) => { tested++; if (g!==w) { if (shown++<10) console.log(`FAIL ${n}: got ${g} want ${w} ${c||''}`); fail++; } };

// --- sincos ---------------------------------------------------------------
let f0 = fail;
for (let a = 0; a < 256; a++) {
  const r = z.call('sincos_lookup', { a });
  const [m, neg, u] = V.sincos[a];
  chk('sc.mag', r.c, m, `a=${a}`); chk('sc.neg', r.b, neg, `a=${a}`); chk('sc.unity', r.e, u, `a=${a}`);
}
console.log('sincos_lookup:', fail===f0 ? 'ok' : 'FAIL');

// --- view_setup + to_view -------------------------------------------------
const A = {
  pl_x: 0xBC00+28, pl_xf: 0xBC00+30, pl_y: 0xBC00+31, pl_yf: 0xBC00+33,
  pl_ang: 0xBC00+34, vs_rx: 0xBC00+22, vs_ry: 0xBC00+24,
  tv_wx: 0xBC00+48, tv_wy: 0xBC00+50, tv_tvx: 0xBC00+52, tv_tvy: 0xBC00+54,
  rc_m8: 0xBC00+56, rc_s: 0xBC00+57,
};
f0 = fail;
let tsetup = 0, tview = 0, nview = 0;
for (const c of V.ctx) {
  z.poke16(A.pl_x, c.px_int & 0xffff); z.poke(A.pl_xf, c.px_f);
  z.poke16(A.pl_y, c.py_int & 0xffff); z.poke(A.pl_yf, c.py_f);
  z.poke(A.pl_ang, c.ang);
  const rs = z.call('view_setup', {}, { maxT: 2000000 });
  tsetup += rs.tstates;
  chk('rx', s16(z.peek16(A.vs_rx)), c.rx, `ang=${c.ang}`);
  chk('ry', s16(z.peek16(A.vs_ry)), c.ry, `ang=${c.ang}`);
  for (const [wx, wy, tvx, tvy] of c.pts) {
    z.poke16(A.tv_wx, wx & 0xffff); z.poke16(A.tv_wy, wy & 0xffff);
    const r = z.call('to_view');
    tview += r.tstates; nview++;
    chk('tvx', s16(z.peek16(A.tv_tvx)), tvx, `ang=${c.ang} w=${wx},${wy}`);
    chk('tvy', s16(z.peek16(A.tv_tvy)), tvy, `ang=${c.ang} w=${wx},${wy}`);
  }
}
console.log(`view_setup/to_view: ${fail===f0?'ok':'FAIL'}  setup ${(tsetup/V.ctx.length).toFixed(0)}T, to_view ${(tview/nview).toFixed(0)}T`);

// --- recip ----------------------------------------------------------------
f0 = fail;
for (const [tvy, m, s] of V.recip) {
  z.call('recip', { hl: tvy });
  chk('recip.m8', z.peek(A.rc_m8), m, `tvy=${tvy}`);
  chk('recip.s', z.peek(A.rc_s), s, `tvy=${tvy}`);
}
console.log('recip:', fail===f0 ? 'ok' : 'FAIL');

// --- project_y ------------------------------------------------------------
f0 = fail; let tp = 0;
for (const [h, m, s, want] of V.projy) {
  z.poke(A.rc_m8, m); z.poke(A.rc_s, s);
  const r = z.call('project_y', { a: h & 0xff });
  tp += r.tstates;
  chk('projy', s16(r.hl), want, `h=${h} m=${m} s=${s}`);
}
console.log(`project_y: ${fail===f0?'ok':'FAIL'}  ${(tp/V.projy.length).toFixed(0)}T`);

// --- project_x ------------------------------------------------------------
f0 = fail; tp = 0;
for (const [tvx, m, s, want] of V.projx) {
  z.poke(A.rc_m8, m); z.poke(A.rc_s, s);
  const r = z.call('project_x', { hl: tvx & 0xffff }, { maxT: 200000 });
  tp += r.tstates;
  chk('projx', s16(r.hl), want & 0xffff ? s16(want & 0xffff) : want, `tvx=${tvx} m=${m} s=${s}`);
}
console.log(`project_x: ${fail===f0?'ok':'FAIL'}  ${(tp/V.projx.length).toFixed(0)}T`);
console.log(`\n${tested} assertions, ${fail} failures`);
process.exit(fail?1:0);
