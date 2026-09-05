#!/usr/bin/env node
// Attribute walkthrough frame time to subsystems, both inclusive (time spent
// anywhere inside a routine) and self (time not inside a deeper bucket).
const { run } = require("./bench.js");

const { BUCKETS } = require("./profile_buckets.js");

const { sym, m } = run(1);   // build + boot once
const bucketAddr = new Map();
for (const [k, v] of sym.entries()) if (BUCKETS.has(k)) bucketAddr.set(v, k);

// Re-run from scratch, tracking the call stack.
const { run: rerun } = require("./bench.js");
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128, TSTATES_PER_FRAME } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const SCRIPT = require("./bench.js").SCRIPT;

const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
const S = readSymbols(r.sym);
const mm = new Spectrum128();
mm.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
mm.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
mm.ram[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
mm.ram[5].set(fs.readFileSync(path.join(ROOT, "build/atan.bin")), 0x5B00 - 0x4000);
{ const b4 = fs.readFileSync(path.join(ROOT, "build/bank4.bin")); mm.ram[4].set(b4, 0);
  const img = fs.readFileSync(path.join(ROOT, "build/doom.bin")).subarray(0, -b4.length);   // the raw image carries a copy of bank 4 on its tail
  mm.ram[2].set(img.subarray(0, Math.min(img.length, 0xc000 - 0x8400)), 0x8400 - 0x8000);
  if (img.length > 0xc000 - 0x8400) { mm.ram[6].set(img.subarray(0xc000 - 0x8400), 0); mm.ram[7].set(img.subarray(0xc000 - 0x8400), 0); } }
const st = mm.cpu.getState(); st.pc = S.get("START"); st.sp = 0xbff0; st.imode = 1;
mm.cpu.setState(st);

const NF = Number(process.argv[2] || 60);
const rf = S.get("render_frame");
const self = new Map(), incl = new Map(), calls = new Map();
let stack = [], cur = "other", last = mm.tstates;
let si = 0, left = SCRIPT[0][1], frames = 0, prev = 0, grand = 0, frameStart = 0;
const limit = mm.tstates + TSTATES_PER_FRAME * 60000;
while (frames <= NF && mm.tstates < limit) {
  const s = mm.cpu.getState();
  const pc = s.pc;
  const t = mm.tstates;
  self.set(cur, (self.get(cur) || 0) + (t - last));
  last = t;
  const name = bucketAddr.get(pc);
  if (name) {
    stack.push({ name: cur, sp: s.sp, t, entry: name });
    calls.set(name, (calls.get(name) || 0) + 1);
    cur = name;
  } else while (stack.length && s.sp > stack[stack.length - 1].sp) {
    const f = stack.pop();
    incl.set(f.entry, (incl.get(f.entry) || 0) + (t - f.t));
    cur = f.name;
  }
  if (pc === rf && prev !== rf) {
    if (frames > 0) grand += t - frameStart;
    frameStart = t; frames++;
    if (--left <= 0) {
      if (SCRIPT[si][0]) mm.keyUp(SCRIPT[si][0]);
      si = (si + 1) % SCRIPT.length; left = SCRIPT[si][1];
      if (SCRIPT[si][0]) mm.keyDown(SCRIPT[si][0]);
    }
  }
  prev = pc;
  mm.maybeInterrupt(); mm.step();
}
const n = frames - 1;
console.log(`profiled ${n} walkthrough frames, ${(grand / n / 1000).toFixed(0)}k T/frame\n`);
console.log("routine            incl T/f   %      self T/f    calls/f   T/call");
const rows = [...incl.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows.slice(0, 34)) {
  const c = (calls.get(k) || 0) / n;
  console.log(`  ${k.padEnd(16)} ${(v / n).toFixed(0).padStart(8)} ${(100 * v / grand).toFixed(1).padStart(5)}%` +
              ` ${((self.get(k) || 0) / n).toFixed(0).padStart(9)}  ${c.toFixed(1).padStart(8)} ${(v / n / (c || 1)).toFixed(0).padStart(8)}`);
}
