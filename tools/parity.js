#!/usr/bin/env node
// Compare against the BBC port's own measured baseline, viewpoint for
// viewpoint.  Its 6502 runs at 2MHz and this Z80 at 3.5469MHz, so parity in
// wall-clock terms means T-states <= cycles * 1.773.
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128, TSTATES_PER_FRAME } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const BSP_ROOT = JSON.parse(fs.readFileSync(path.join(ROOT, "build/map.json"), "utf8")).root;   // the tree's root node, from the pack
const RATIO = 3546900 / 2000000;
// The BBC baseline counts its own line drawing inside render_frame (only the
// screen clear sits outside), so the rasteriser has to be in this figure too.

const base = JSON.parse(fs.readFileSync((process.env.DOOM_BBC_REF || "/tmp/doom_bbc_ref") +
                                        "/baseline.json", "utf8")).cycles;
const frames = JSON.parse(fs.readFileSync(process.env.FRAMES || path.join(ROOT, "build/parity.json"), "utf8"));

const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const S = readSymbols(r.sym);
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
// let init run
const rf = S.get("render_frame");
let prev = 0;
while (m.cpu.getState().pc !== rf) { m.step(); }

const V = S.get("VARS_BASE");
// The vertex cache is stamped with a generation counter that view_setup
// advances; resetting it per viewpoint would make stale entries look fresh.
m.ram[2][V + 40 - 0x8000] = 0;
const poke16 = (a, v) => { m.ram[2][a - 0x8000] = v & 255; m.ram[2][a - 0x8000 + 1] = (v >> 8) & 255; };
const poke = (a, v) => { m.ram[2][a - 0x8000] = v & 255; };

console.log("viewpoint                6502 cyc   Z80 T   parity T   ratio");
let sumC = 0, sumT = 0;
let adynPose = null;
for (const f of frames) {
  poke16(V + 28, f.px_int & 0xffff); poke(V + 30, f.px_f);
  poke16(V + 31, f.py_int & 0xffff); poke(V + 33, f.py_f);
  poke(V + 34, f.ang); poke(V + 26, f.vz & 0xff);
  poke16(V + 36, f.wx & 0xffff); poke16(V + 38, f.wy & 0xffff);
  poke16(S.get("bsp_root"), BSP_ROOT);
  // screen A (bank 5, always mapped) is the back buffer: cleared here, outside
  // the measure, and drawn into by the frame itself
  m.ram[2][V + 10 - 0x8000] = 0;
  // the walk's always-descend bits carry between frames, as in play; a bench that
  // jumps between unrelated poses clears them, with the BBC harness's windows
  // (128 world units or 24 angle bytes - a motion the walk's kinematics can never make)
  if (!adynPose || Math.abs(f.wx - adynPose[0]) > 128 || Math.abs(f.wy - adynPose[1]) > 128 ||
      Math.min((f.ang - adynPose[2]) & 255, (adynPose[2] - f.ang) & 255) > 24) m.ram[4].fill(0, 0x3800, 0x3900);
  adynPose = [f.wx, f.wy, f.ang];
  m.applyPaging(0x16);
  m.poke(0xbff8, 0x76);
  for (const [entry, a] of [[S.get("raster_select"), 0], [S.get("raster_clear"), 0]]) {
    const s3 = m.cpu.getState(); s3.pc = entry; s3.a = a; s3.sp = 0xbfee; s3.halted = false; m.cpu.setState(s3);
    m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
    for (;;) { m.step(); if (m.cpu.getState().halted) break; }
  }
  m.applyPaging(0x10);
  const s2 = m.cpu.getState(); s2.pc = rf; s2.sp = 0xbfee; s2.halted = false;
  m.cpu.setState(s2);
  m.poke(0xbff8, 0x76); m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
  const t0 = m.tstates;
  for (;;) { m.step(); if (m.cpu.getState().halted) break; }
  // rasterise the display list into the spare screen bank
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
