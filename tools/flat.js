#!/usr/bin/env node
// Flat profile of the parity viewpoints: every instruction's T-states go to
// the nearest label at or below its address, so tail calls and fall-throughs
// can't misattribute anything.  argv[2] = rows (default 60), argv[3] = a
// viewpoint key substring.
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128 } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const rows = Number(process.argv[2] || 60), only = process.argv[3] || "";
const frames = JSON.parse(fs.readFileSync(path.join(ROOT, "build/parity.json"), "utf8")).filter(f => f.key.includes(only));
const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const S = readSymbols(r.sym);
// label per address, for the code banks only
const owner = new Int32Array(65536).fill(-1), names = [];
const syms = [...S.entries()].filter(([k, v]) => v >= 0x8000 && v < 0xC000 && !/^[A-Z_0-9]+$/.test(k) && !k.startsWith('.')).sort((a, b) => a[1] - b[1]);
for (let i = 0; i < syms.length; i++) {
  const [k, v] = syms[i], end = i + 1 < syms.length ? syms[i + 1][1] : 0xC000;
  names.push(k); for (let a = v; a < end; a++) owner[a] = i;
}
const m = new Spectrum128();
m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
m.ram[2].set(fs.readFileSync(path.join(ROOT, "build/doom.bin")), 0x8400 - 0x8000);
const st = m.cpu.getState(); st.pc = S.get("START"); st.sp = 0xbff0; st.imode = 1; m.cpu.setState(st);
const rf = S.get("render_frame");
while (m.cpu.getState().pc !== rf) m.step();
const V = 0xBC00; m.ram[2][0xBC28 - 0x8000] = 0;
const poke16 = (a, v) => { m.ram[2][a - 0x8000] = v & 255; m.ram[2][a - 0x8000 + 1] = (v >> 8) & 255; };
const poke = (a, v) => { m.ram[2][a - 0x8000] = v & 255; };
const T = new Float64Array(names.length), N = new Float64Array(names.length);
let grand = 0;
function runUntilHalt() {
  for (;;) {
    const s = m.cpu.getState(); if (s.halted) break;
    const pc = s.pc, t0 = m.tstates; m.step();
    const o = owner[pc]; if (o >= 0) { T[o] += m.tstates - t0; N[o]++; }
  }
}
for (const f of frames) {
  poke16(V + 28, f.px_int & 0xffff); poke(V + 30, f.px_f); poke16(V + 31, f.py_int & 0xffff); poke(V + 33, f.py_f);
  poke(V + 34, f.ang); poke(V + 26, f.vz & 0xff); poke16(V + 36, f.wx & 0xffff); poke16(V + 38, f.wy & 0xffff);
  poke16(V + 440, 194); poke(V + 525, 0);
  const s2 = m.cpu.getState(); s2.pc = rf; s2.sp = 0xbfee; s2.halted = false; m.cpu.setState(s2);
  m.poke(0xbff8, 0x76); m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
  const t0 = m.tstates; runUntilHalt();
  m.applyPaging(0x17);
  for (const [entry, a] of [[S.get("raster_select"), 1], [S.get("dl_render"), 0]]) {
    const s3 = m.cpu.getState(); s3.pc = entry; s3.a = a; s3.sp = 0xbfee; s3.halted = false; m.cpu.setState(s3);
    m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf); runUntilHalt();
  }
  m.applyPaging(0x10); grand += m.tstates - t0;
}
const n = frames.length;
console.log(`${n} parity viewpoints, ${(grand / n / 1000).toFixed(0)}k T/frame\n`);
console.log("label                    T/frame     %   instr/f");
const idx = [...names.keys()].sort((a, b) => T[b] - T[a]);
let shown = 0;
for (const i of idx.slice(0, rows)) {
  shown += T[i];
  console.log(`  ${names[i].padEnd(22)} ${(T[i] / n).toFixed(0).padStart(8)} ${(100 * T[i] / grand).toFixed(1).padStart(5)}% ${(N[i] / n).toFixed(0).padStart(8)}`);
}
console.log(`  (shown ${(100 * shown / grand).toFixed(1)}% of the frame)`);
