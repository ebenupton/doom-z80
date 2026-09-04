#!/usr/bin/env node
// Boot the built engine in the headless Spectrum and capture frames.
//   run.js [--frames N] [--png out.png] [--keys "q:20,p:40"] [--scale 2]
const fs = require("fs");
const path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128, TSTATES_PER_FRAME } = require("./spectrum.js");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const sym = readSymbols(r.sym);

const m = new Spectrum128({ contention: flag("--contention", "1") !== "0" });
m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
const img = fs.readFileSync(path.join(ROOT, "build/doom.bin"));
m.ram[2].set(img, 0x8400 - 0x8000);

const st = m.cpu.getState();
st.pc = sym.get("START");
st.sp = 0xbff0;
st.iff1 = 0; st.iff2 = 0; st.imode = 1;
m.cpu.setState(st);

// key schedule: "name:startFrame-endFrame,..."
const keys = [];
for (const spec of (flag("--keys", "") || "").split(",").filter(Boolean)) {
  const [name, range] = spec.split(":");
  const [a, b] = range.split("-").map(Number);
  keys.push({ name: name.toUpperCase(), from: a, to: b === undefined ? a : b });
}

const nFrames = Number(flag("--frames", 12));
const renderStart = sym.get("render_frame");
let rendered = 0, lastT = 0;
const times = [];
const limit = m.tstates + TSTATES_PER_FRAME * 4000;
let prevPC = 0;
while (rendered < nFrames && m.tstates < limit) {
  m.maybeInterrupt();
  m.step();
  const pc = m.cpu.getState().pc;
  if (pc === renderStart && prevPC !== renderStart) {
    if (rendered > 0) times.push(m.tstates - lastT);
    lastT = m.tstates;
    rendered++;
    for (const k of keys) {
      if (rendered >= k.from && rendered <= k.to) m.keyDown(k.name);
      else m.keyUp(k.name);
    }
  }
  prevPC = pc;
}
const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
console.log(`rendered ${rendered} frames; ${(avg / 1000).toFixed(0)}k T/frame ` +
            `= ${(3546900 / avg).toFixed(2)} fps  (${(avg / TSTATES_PER_FRAME).toFixed(1)} PAL fields)`);
const png = flag("--png", null);
if (png) { m.savePNG(png, { border: 24, scale: Number(flag("--scale", 2)) }); console.log("png -> " + png); }
const V = 0xBC00;
const s16 = (v) => (v & 0x8000 ? v - 65536 : v);
console.log(`player prescaled (${s16(m.ram[2][0xBC1C - 0x8000] | (m.ram[2][0xBC1D - 0x8000] << 8))}.` +
            `${m.ram[2][0xBC1E - 0x8000]}, ` +
            `${s16(m.ram[2][0xBC1F - 0x8000] | (m.ram[2][0xBC20 - 0x8000] << 8))}.` +
            `${m.ram[2][0xBC21 - 0x8000]})  angle ${m.ram[2][0xBC22 - 0x8000]}`);
