const { ZHarness, s16, s24 } = require('../tools/zcall.js');
const ROOT = require('path').resolve(__dirname, '..') + '/';
const z = new ZHarness(ROOT + 'test/t_math.z80');
console.log('image', z.size, 'bytes @', z.org.toString(16));
let fail = 0, tested = 0;
function chk(name, got, want, ctx) {
  tested++;
  if (got !== want) { if (fail < 40) console.log(`FAIL ${name}: got ${got} want ${want} ${ctx||''}`); fail++; }
}

// --- quarter-square table --------------------------------------------------
z.call('sq_init');
for (let n = 0; n <= 511; n++) {
  const want = Math.floor(n * n / 4);
  const got = z.peek(0x8000 + n) | (z.peek(0x8200 + n) << 8);
  chk('sq', got, want & 0xffff, `n=${n}`);
}
console.log('qsq table:', fail ? 'FAIL' : 'ok');

// --- mul_u8 exhaustive -----------------------------------------------------
let f0 = fail, tmax = 0, tsum = 0, n = 0;
for (let a = 0; a < 256; a++) {
  for (let b = 0; b < 256; b++) {
    const r = z.call('mul_u8', { h: a, l: b });
    chk('mul_u8', r.hl, (a * b) & 0xffff, `${a}*${b}`);
    tsum += r.tstates; n++; if (r.tstates > tmax) tmax = r.tstates;
  }
}
console.log(`mul_u8 exhaustive: ${fail === f0 ? 'ok' : 'FAIL'}  avg ${(tsum/n).toFixed(1)}T max ${tmax}T`);

// --- mul_s8_u8 -------------------------------------------------------------
f0 = fail;
for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b += 7) {
  const r = z.call('mul_s8_u8', { h: a, l: b });
  const sa = a & 0x80 ? a - 256 : a;
  chk('mul_s8_u8', s16(r.hl), s16(sa * b), `${sa}*${b}`);
}
console.log('mul_s8_u8:', fail === f0 ? 'ok' : 'FAIL');

// --- mul_s16_u8 ------------------------------------------------------------
f0 = tmax = 0; f0 = fail; tsum = 0; n = 0;
const mults = [0, 1, 2, 127, 128, 200, 255];
for (const mm of mults) {
  for (let d = -600; d <= 600; d += 1) {
    const r = z.call('mul_s16_u8', { de: d & 0xffff, a: mm });
    const got = s24(((r.a & 0xff) << 16) | r.hl);
    chk('mul_s16_u8', got, d * mm, `${d}*${mm}`);
    tsum += r.tstates; n++; if (r.tstates > tmax) tmax = r.tstates;
  }
}
// and some wide values
for (const mm of [37, 255]) for (const d of [-32768, -20000, -257, -256, -255, 255, 256, 32767]) {
  const r = z.call('mul_s16_u8', { de: d & 0xffff, a: mm });
  chk('mul_s16_u8w', s24(((r.a & 0xff) << 16) | r.hl), d * mm, `${d}*${mm}`);
}
console.log(`mul_s16_u8: ${fail === f0 ? 'ok' : 'FAIL'}  avg ${(tsum/n).toFixed(1)}T max ${tmax}T`);

// --- rns -------------------------------------------------------------------
f0 = fail;
const rns = (p, s) => Math.floor((p + (1 << (s - 1))) / Math.pow(2, s));
for (const s of [1, 2, 3, 8, 10, 11, 16]) {
  for (const p of [0, 1, -1, 7, -7, 1000, -1000, 100000, -100000, 8000000, -8000000, 255, 256, -256]) {
    const r = z.call('rns_ahl', { a: (p >> 16) & 0xff, hl: p & 0xffff, b: s });
    const got = s24(((r.a & 0xff) << 16) | r.hl);
    chk('rns', got, s24(rns(p, s)), `p=${p} s=${s}`);
  }
}
console.log('rns_ahl:', fail === f0 ? 'ok' : 'FAIL');

// --- neg ------------------------------------------------------------------
f0 = fail;
for (const p of [0, 1, -1, 1000, -1000, 8388607, -8388607, 65536, -65536]) {
  const r = z.call('neg_ahl', { a: (p >> 16) & 0xff, hl: p & 0xffff });
  chk('neg', s24(((r.a & 0xff) << 16) | r.hl), s24(-p), `p=${p}`);
}
console.log('neg_ahl:', fail === f0 ? 'ok' : 'FAIL');

console.log(`\n${tested} assertions, ${fail} failures`);
process.exit(fail ? 1 : 0);
