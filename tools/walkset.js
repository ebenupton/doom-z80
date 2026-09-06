#!/usr/bin/env node
// Record a viewpoint set from the game loop itself: boot the engine, hold a
// key, and at each render_frame entry write the frame's viewpoint in
// parity.json's form.  Usage: walkset.js [--frames N] [--key q] [--out build/walk.json]
const fs = require("fs");
const path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128 } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const nFrames = Number(flag("--frames", 40));
const key = flag("--key", "q");
const out = flag("--out", path.join(ROOT, "build/walk.json"));

const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const sym = readSymbols(r.sym);
const m = new Spectrum128({ contention: true });
m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/atan.bin")), 0x5B00 - 0x4000);
const b4 = fs.readFileSync(path.join(ROOT, "build/bank4.bin")); m.ram[4].set(b4, 0);
const img = fs.readFileSync(path.join(ROOT, "build/doom.bin")).subarray(0, -b4.length);
m.ram[2].set(img.subarray(0, Math.min(img.length, 0xc000 - 0x8400)), 0x8400 - 0x8000);
if (img.length > 0xc000 - 0x8400) { m.ram[6].set(img.subarray(0xc000 - 0x8400), 0); m.ram[7].set(img.subarray(0xc000 - 0x8400), 0); }
const st = m.cpu.getState(); st.pc = sym.get("START"); st.sp = 0xbff0; st.iff1 = 0; st.iff2 = 0; st.imode = 1;
m.cpu.setState(st);

const V = sym.get("VARS_BASE");
const rd = (a) => m.ram[2][a - 0x8000];
const s16 = (v) => (v & 0x8000 ? v - 65536 : v);
const rd16 = (a) => s16(rd(a) | (rd(a + 1) << 8));
const renderStart = sym.get("render_frame");
const frames = [];
let rendered = 0, prevPC = 0;
while (rendered < nFrames) {
  m.maybeInterrupt();
  m.step();
  const pc = m.cpu.getState().pc;
  if (pc === renderStart && prevPC !== renderStart) {
    const px = rd16(V + 28), pxf = rd(V + 30), py = rd16(V + 31), pyf = rd(V + 33);
    const wx = rd16(V + 36), wy = rd16(V + 38), ang = rd(V + 34), vz = rd(V + 26);
    frames.push({ key: `${wx},${wy},${ang}`, px88: px * 256 + pxf, py88: py * 256 + pyf, ang, vz: s16(vz << 8) >> 8,
                  wx, wy, px_int: px, px_f: pxf, py_int: py, py_f: pyf });
    rendered++;
    if (rendered >= 1) m.keyDown(key);
  }
  prevPC = pc;
}
fs.writeFileSync(out, JSON.stringify(frames));
console.log(`${frames.length} frames -> ${out}; first ${frames[0].key}, last ${frames[frames.length - 1].key}`);
