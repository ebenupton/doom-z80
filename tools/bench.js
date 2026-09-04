#!/usr/bin/env node
// The benchmark everything is tracked against: a scripted walkthrough of
// E1M1, reporting the average cost of a rendered frame.  This is the number
// that has to come down.
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128, TSTATES_PER_FRAME } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");

const SCRIPT = [["", 3], ["P", 12], ["Q", 10], ["O", 10], ["Q", 14], ["X", 6],
                ["A", 8], ["Z", 6], ["P", 20], ["Q", 18], ["", 2]];

function run(nFrames = 109) {
  const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
  if (!r.ok) { console.error(r.out); process.exit(1); }
  const sym = readSymbols(r.sym);
  const m = new Spectrum128();
  m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
  m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
  m.ram[2].set(fs.readFileSync(path.join(ROOT, "build/doom.bin")), 0x8800 - 0x8000);
  const st = m.cpu.getState();
  st.pc = sym.get("START"); st.sp = 0xbff0; st.imode = 1;
  m.cpu.setState(st);
  const rf = sym.get("render_frame");
  let si = 0, left = SCRIPT[0][1], frames = 0, prev = 0, last = m.tstates;
  const times = [];
  const limit = m.tstates + TSTATES_PER_FRAME * 60000;
  while (frames < nFrames && m.tstates < limit) {
    m.maybeInterrupt(); m.step();
    const pc = m.cpu.getState().pc;
    if (pc === rf && prev !== rf) {
      if (frames > 0) times.push(m.tstates - last);
      last = m.tstates; frames++;
      if (--left <= 0) {
        if (SCRIPT[si][0]) m.keyUp(SCRIPT[si][0]);
        si = (si + 1) % SCRIPT.length;
        left = SCRIPT[si][1];
        if (SCRIPT[si][0]) m.keyDown(SCRIPT[si][0]);
      }
    }
    prev = pc;
  }
  return { times, sym, m };
}

if (require.main === module) {
  const { times } = run(Number(process.argv[2] || 109));
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  console.log(`walkthrough: ${times.length} frames`);
  console.log(`  mean   ${(avg / 1000).toFixed(0)}k T = ${(3546900 / avg).toFixed(2)} fps`);
  console.log(`  median ${(med / 1000).toFixed(0)}k T = ${(3546900 / med).toFixed(2)} fps`);
  console.log(`  best   ${(sorted[0] / 1000).toFixed(0)}k = ${(3546900 / sorted[0]).toFixed(1)} fps` +
              `   worst ${(sorted[sorted.length - 1] / 1000).toFixed(0)}k = ${(3546900 / sorted[sorted.length - 1]).toFixed(2)} fps`);
}
module.exports = { run, SCRIPT };
