#!/usr/bin/env node
// Compare against the BBC port's own measured baseline, viewpoint for
// viewpoint.  Its 6502 runs at 2MHz and this Z80 at 3.5469MHz, so parity in
// wall-clock terms means T-states <= cycles * 1.773.
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128, TSTATES_PER_FRAME } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const RATIO = 3546900 / 2000000;
// The BBC baseline counts its own line drawing inside render_frame (only the
// screen clear sits outside), so the rasteriser has to be in this figure too.

const base = JSON.parse(fs.readFileSync(process.env.DOOM_BBC_REF || "/tmp/doom_bbc_ref" +
                                        "/baseline.json", "utf8")).cycles;
const frames = JSON.parse(fs.readFileSync(path.join(ROOT, "build/parity.json"), "utf8"));

const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const S = readSymbols(r.sym);
const m = new Spectrum128();
m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6400 - 0x4000);
m.ram[2].set(fs.readFileSync(path.join(ROOT, "build/doom.bin")), 0x8800 - 0x8000);
const st = m.cpu.getState(); st.pc = S.get("START"); st.sp = 0xbff0; st.imode = 1;
m.cpu.setState(st);
// let init run
const rf = S.get("render_frame");
let prev = 0;
while (m.cpu.getState().pc !== rf) { m.step(); }

const V = 0xBC00;
// The vertex cache is stamped with a generation counter that view_setup
// advances; resetting it per viewpoint would make stale entries look fresh.
m.ram[2][0xBC28 - 0x8000] = 0;
const poke16 = (a, v) => { m.ram[2][a - 0x8000] = v & 255; m.ram[2][a - 0x8000 + 1] = (v >> 8) & 255; };
const poke = (a, v) => { m.ram[2][a - 0x8000] = v & 255; };

console.log("viewpoint                6502 cyc   Z80 T   parity T   ratio");
let sumC = 0, sumT = 0;
for (const f of frames) {
  poke16(V + 28, f.px_int & 0xffff); poke(V + 30, f.px_f);
  poke16(V + 31, f.py_int & 0xffff); poke(V + 33, f.py_f);
  poke(V + 34, f.ang); poke(V + 26, f.vz & 0xff);
  poke16(V + 36, f.wx & 0xffff); poke16(V + 38, f.wy & 0xffff);
  poke16(V + 440, 194); poke(V + 525, 0);
  const s2 = m.cpu.getState(); s2.pc = rf; s2.sp = 0xbfee; s2.halted = false;
  m.cpu.setState(s2);
  m.poke(0xbff8, 0x76); m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
  const t0 = m.tstates;
  for (;;) { m.step(); if (m.cpu.getState().halted) break; }
  // rasterise the display list into the spare screen bank
  m.applyPaging(0x17);
  for (const [entry, a] of [[S.get("raster_select"), 1], [S.get("dl_render"), 0]]) {
    const s3 = m.cpu.getState();
    s3.pc = entry; s3.a = a; s3.sp = 0xbfee; s3.halted = false;
    m.cpu.setState(s3);
    m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
    for (;;) { m.step(); if (m.cpu.getState().halted) break; }
  }
  m.applyPaging(0x10);
  const t = m.tstates - t0;
  const c = base[f.key];
  sumC += c; sumT += t;
  const par = c * RATIO;
  console.log(`  ${f.key.padEnd(22)} ${String(c).padStart(8)} ${String(t).padStart(8)}` +
              ` ${par.toFixed(0).padStart(9)}  ${(t / par).toFixed(2)}x`);
}
console.log(`  ${"TOTAL".padEnd(22)} ${String(sumC).padStart(8)} ${String(sumT).padStart(8)}` +
            ` ${(sumC * RATIO).toFixed(0).padStart(9)}  ${(sumT / (sumC * RATIO)).toFixed(2)}x`);
console.log(`\nBBC mean ${(2000000 / (sumC / frames.length)).toFixed(1)} fps; ` +
            `this ${(3546900 / (sumT / frames.length)).toFixed(1)} fps`);
