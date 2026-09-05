const { ZHarness, s8, s16 } = require('../tools/zcall.js');
const ROOT = require('path').resolve(__dirname, '..') + '/';
const fs = require('fs');
const V = JSON.parse(fs.readFileSync(ROOT + 'build/vec.json','utf8'));
const z = new ZHarness(ROOT + 'test/t_view.z80');
// load the packed tables at $8800
z.pokeBytes(0x8800, fs.readFileSync(ROOT + 'build/tables.bin'));
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
const VB = z.sym_('VARS_BASE');
const A = {
  pl_x: VB+28, pl_xf: VB+30, pl_y: VB+31, pl_yf: VB+33,
  pl_ang: VB+34, vs_rx: VB+22, vs_ry: VB+24,
  tv_wx: VB+48, tv_wy: VB+50, tv_tvx: VB+52, tv_tvy: VB+54,
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
  const r = z.call('recip', { hl: tvy });
  chk('recip.m8', r.e, m, `tvy=${tvy}`);
  chk('recip.s', r.d, s, `tvy=${tvy}`);
}
console.log('recip:', fail===f0 ? 'ok' : 'FAIL');

// --- project_y ------------------------------------------------------------
f0 = fail; let tp = 0;
for (const [h, m, s, want] of V.projy) {
  const r = z.call('project_y', { a: h & 0xff, e: m, d: s });
  tp += r.tstates;
  chk('projy', s16(r.hl), want, `h=${h} m=${m} s=${s}`);
}
console.log(`project_y: ${fail===f0?'ok':'FAIL'}  ${(tp/V.projy.length).toFixed(0)}T`);

// --- project_x ------------------------------------------------------------
f0 = fail; tp = 0;
for (const [tvx, m, s, want] of V.projx) {
  const r = z.call('project_x', { hl: tvx & 0xffff, e: m, d: s }, { maxT: 200000 });
  tp += r.tstates;
  chk('projx', s16(r.hl), want & 0xffff ? s16(want & 0xffff) : want, `tvx=${tvx} m=${m} s=${s}`);
}
console.log(`project_x: ${fail===f0?'ok':'FAIL'}  ${(tp/V.projx.length).toFixed(0)}T`);
console.log(`\n${tested} assertions, ${fail} failures`);
process.exit(fail?1:0);
