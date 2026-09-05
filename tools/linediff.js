#!/usr/bin/env node
// Line-order diff: the Z80 display list for golden frame N against the
// 6502's plotted lines (build/frames.json from tools/gen6502.py).
const { ZHarness } = require('./zcall.js');
const fs = require('fs');
const R = require('path').resolve(__dirname, '..') + '/';
const F = JSON.parse(fs.readFileSync(R + (process.env.FRAMES || 'build/frames.json'), 'utf8'));
const z = new ZHarness(R + 'test/t_view.z80');
z.m.ram[0].set(fs.readFileSync(R + 'build/bank0.bin'), 0);
z.pokeBytes(0x8800, fs.readFileSync(R + 'build/tables.bin'));
z.m.ram[5].set(fs.readFileSync(R + 'build/nodebb.bin'), 0x6580 - 0x4000);
z.m.ram[5].set(fs.readFileSync(R + 'build/l8.bin'), 0x6200 - 0x4000);
z.m.ram[5].set(fs.readFileSync(R + 'build/atan.bin'), 0x5B00 - 0x4000);
z.m.applyPaging(0);
z.call('sq_init'); z.call('cpm_init'); z.m.applyPaging(6); z.call('raster_init'); z.m.applyPaging(0);
const S = n => z.sym_(n);
z.poke16(S('bsp_root'), 194); z.poke(S('vc_stamp'), 0);
const i = +(process.argv[2] || 0), f = F[i];
z.poke16(S('pl_x'), f.px_int & 0xffff); z.poke(S('pl_xf'), f.px_f);
z.poke16(S('pl_y'), f.py_int & 0xffff); z.poke(S('pl_yf'), f.py_f);
z.poke(S('pl_ang'), f.ang); z.poke(S('vs_vz'), f.vz & 0xff);
z.poke16(S('pl_wx'), f.wx & 0xffff); z.poke16(S('pl_wy'), f.wy & 0xffff);
// lines are plotted as they are emitted: catch them at plot_line's entry
const zl = [], PL = S('plot_line');
z.poke(S('VARS_BASE') + 10, 0);
z.m.applyPaging(6); z.call('raster_clear', { a: 0 }); z.call('raster_select', { a: 0 }); z.m.applyPaging(0);
const r = z.call('render_frame', {}, { maxT: 40000000, hook: st => { if (st.pc === PL) zl.push([st.c, st.b, st.e, st.d]); } });
const pl = f.lines;
console.log(`frame ${i} (${f.wx},${f.wy},${f.ang}): z80 ${zl.length} lines, 6502 ${pl.length} lines, ${r.tstates} T vs ${f.cycles} cyc`);
const eq = (a, b) => a && b && a.every((v, k) => v === b[k]);
let n = 0; while (n < zl.length && n < pl.length && eq(zl[n], pl[n])) n++;
if (n === zl.length && n === pl.length) console.log('identical');
else {
  console.log(`first divergence at line ${n}:`);
  for (let k = Math.max(0, n - 3); k < Math.min(n + 8, Math.max(zl.length, pl.length)); k++)
    console.log(`  ${k === n ? '>' : ' '} ${String(k).padStart(3)}  z80 ${zl[k] ? zl[k].join(',').padEnd(16) : '-'.padEnd(16)}  6502 ${pl[k] ? pl[k].join(',') : '-'}`);
}
