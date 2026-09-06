#!/usr/bin/env node
// Movement direction after turning: boot the engine, turn by N frames, walk
// forward, and check the world-space step against the heading's cos/sin.
// (A sign regression guard, not an oracle test: the BBC's pmove is the oracle
// for collision, tested in collision.test.js.)
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("../tools/zbuild.js");
const { Spectrum128 } = require("../tools/spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const sym = readSymbols(r.sym);
function boot() {
  const m = new Spectrum128({ contention: true });
  m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
  const b4 = fs.readFileSync(path.join(ROOT, "build/bank4.bin")); m.ram[4].set(b4, 0);
  const img = fs.readFileSync(path.join(ROOT, "build/doom.bin")).subarray(0, -b4.length);
  m.ram[2].set(img.subarray(0, Math.min(img.length, 0xc000 - 0x8400)), 0x8400 - 0x8000);
  if (img.length > 0xc000 - 0x8400) { m.ram[6].set(img.subarray(0xc000 - 0x8400), 0); m.ram[7].set(img.subarray(0xc000 - 0x8400), 0); }
  const st = m.cpu.getState(); st.pc = sym.get("START"); st.sp = 0xbff0; st.iff1 = 0; st.iff2 = 0; st.imode = 1; m.cpu.setState(st);
  return m;
}
const V = sym.get("VARS_BASE"), rf = sym.get("render_frame");
const s16 = (v) => (v & 0x8000 ? v - 65536 : v);
let fails = 0;
for (const [turnKey, turnFrames] of [["O", 0], ["O", 6], ["O", 14], ["O", 22], ["P", 6], ["P", 14], ["P", 22], ["O", 30]]) {
  const m = boot(); const rd = (a) => m.ram[2][a - 0x8000], rd16 = (a) => s16(rd(a) | (rd(a + 1) << 8));
  let n = 0, prev = 0, before = null, ang = 0;
  while (n < 8 + turnFrames + 8) {
    m.maybeInterrupt(); m.step(); const pc = m.cpu.getState().pc;
    if (pc === rf && prev !== rf) {
      n++;
      const turning = n >= 2 && n < 2 + turnFrames, walking = n >= 4 + turnFrames;
      if (turning) m.keyDown(turnKey); else m.keyUp(turnKey);
      if (walking) m.keyDown("Q"); else m.keyUp("Q");
      if (n === 4 + turnFrames) { before = [rd16(V + 36), rd16(V + 38)]; ang = rd(V + 34); }
    }
    prev = pc;
  }
  const dx = rd16(V + 36) - before[0], dy = rd16(V + 38) - before[1];
  const th = ang * Math.PI / 128, c = Math.cos(th), s = Math.sin(th);
  const ok = (Math.abs(c) < 0.05 || Math.sign(dx) === Math.sign(c)) && (Math.abs(s) < 0.05 || Math.sign(dy) === Math.sign(s)) && (dx !== 0 || dy !== 0);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${turnKey}x${turnFrames}: heading ${ang} (cos ${c.toFixed(2)} sin ${s.toFixed(2)}) moved (${dx}, ${dy})`);
}
console.log(fails ? `${fails} headings move the wrong way` : "movement follows the heading at every tested angle");
process.exit(fails ? 1 : 0);
