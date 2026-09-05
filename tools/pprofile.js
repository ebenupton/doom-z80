#!/usr/bin/env node
// Profile the parity viewpoints themselves (tools/parity.js's measure), with
// tools/profile.js's bucket attribution.  Optional argv[2] = a viewpoint key
// substring to profile alone.
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128 } = require("./spectrum.js");
const { BUCKETS } = require("./profile_buckets.js");
const ROOT = path.resolve(__dirname, "..");
const only = process.argv[2] || "";
const frames = JSON.parse(fs.readFileSync(path.join(ROOT, "build/parity.json"), "utf8"))
  .filter(f => f.key.includes(only));
const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const S = readSymbols(r.sym);
const bucketAddr = new Map();
for (const [k, v] of S.entries()) if (BUCKETS.has(k)) bucketAddr.set(v, k);
const m = new Spectrum128({ contention: process.env.NOCONT ? false : true });
m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/atan.bin")), 0x5B00 - 0x4000);
{ const b4 = fs.readFileSync(path.join(ROOT, "build/bank4.bin")); m.ram[4].set(b4, 0);
  const img = fs.readFileSync(path.join(ROOT, "build/doom.bin")).subarray(0, -b4.length);   // the raw image carries a copy of bank 4 on its tail
  m.ram[2].set(img.subarray(0, Math.min(img.length, 0xc000 - 0x8400)), 0x8400 - 0x8000);
  if (img.length > 0xc000 - 0x8400) { m.ram[6].set(img.subarray(0xc000 - 0x8400), 0); m.ram[7].set(img.subarray(0xc000 - 0x8400), 0); } }
const st = m.cpu.getState(); st.pc = S.get("START"); st.sp = 0xbff0; st.imode = 1;
m.cpu.setState(st);
const rf = S.get("render_frame");
while (m.cpu.getState().pc !== rf) m.step();
const V = S.get("VARS_BASE");
m.ram[2][V + 40 - 0x8000] = 0;
const poke16 = (a, v) => { m.ram[2][a - 0x8000] = v & 255; m.ram[2][a - 0x8000 + 1] = (v >> 8) & 255; };
const poke = (a, v) => { m.ram[2][a - 0x8000] = v & 255; };
const self = new Map(), incl = new Map(), calls = new Map();
let stack = [], cur = "other", last = 0, grand = 0;
function runUntilHalt() {
  last = m.tstates; stack = []; cur = "other";
  for (;;) {
    const s = m.cpu.getState(); const pc = s.pc, t = m.tstates;
    self.set(cur, (self.get(cur) || 0) + (t - last)); last = t;
    const name = bucketAddr.get(pc);
    if (name) { stack.push({ name: cur, sp: s.sp, t, entry: name }); calls.set(name, (calls.get(name) || 0) + 1); cur = name; }
    else while (stack.length && s.sp > stack[stack.length - 1].sp) { const f = stack.pop(); incl.set(f.entry, (incl.get(f.entry) || 0) + (t - f.t)); cur = f.name; }
    if (s.halted) break;
    m.step();
  }
}
for (const f of frames) {
  poke16(V + 28, f.px_int & 0xffff); poke(V + 30, f.px_f);
  poke16(V + 31, f.py_int & 0xffff); poke(V + 33, f.py_f);
  poke(V + 34, f.ang); poke(V + 26, f.vz & 0xff);
  poke16(V + 36, f.wx & 0xffff); poke16(V + 38, f.wy & 0xffff);
  poke16(S.get("bsp_root"), 194); poke(S.get("vs_haveang"), 0);
  // screen A (bank 5, always mapped) is the back buffer: cleared here, outside
  // the measure, and drawn into by the frame itself
  m.ram[2][V + 10 - 0x8000] = 0;
  m.applyPaging(0x16);
  m.poke(0xbff8, 0x76);
  for (const [entry, a] of [[S.get("raster_select"), 0], [S.get("raster_clear"), 0]]) {
    const s3 = m.cpu.getState(); s3.pc = entry; s3.a = a; s3.sp = 0xbfee; s3.halted = false; m.cpu.setState(s3);
    m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
    for (;;) { m.step(); if (m.cpu.getState().halted) break; }
  }
  m.applyPaging(0x10);
  const s2 = m.cpu.getState(); s2.pc = rf; s2.sp = 0xbfee; s2.halted = false; m.cpu.setState(s2);
  m.poke(0xbff8, 0x76); m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
  const t0 = m.tstates;
  runUntilHalt();
  grand += m.tstates - t0;
}
const n = frames.length;
console.log(`profiled ${n} parity viewpoints, ${(grand / n / 1000).toFixed(0)}k T/frame (${grand} total)\n`);
console.log("routine            incl T/f   %      self T/f    calls/f   T/call");
const rows = [...incl.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows.slice(0, Number(process.argv[3] || 40))) {
  const c = (calls.get(k) || 0) / n;
  console.log(`  ${k.padEnd(16)} ${(v / n).toFixed(0).padStart(8)} ${(100 * v / grand).toFixed(1).padStart(5)}%` +
              ` ${((self.get(k) || 0) / n).toFixed(0).padStart(9)}  ${c.toFixed(1).padStart(8)} ${(v / n / (c || 1)).toFixed(0).padStart(8)}`);
}
console.log(`  other self: ${((self.get("other") || 0) / n).toFixed(0)}`);
