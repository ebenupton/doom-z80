#!/usr/bin/env node
// Instruction-level heat map over the parity viewpoints: T-states per PC
// (banked addresses keyed by the bank paged at $C000), mapped back to the
// listing.  Usage: heat.js [--top N] [--class] [--range lo-hi] [--file name]
//   --class   totals by instruction class (absolute loads/stores = staging)
//   --file    only lines from that source file (e.g. clip.z80)
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128 } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const BSP_ROOT = JSON.parse(fs.readFileSync(path.join(ROOT, "build/map.json"), "utf8")).root;   // the tree's root node, from the pack
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const top = Number(flag("--top", 60));
const onlyFile = flag("--file", null);
const doClass = argv.includes("--class");
const frames = JSON.parse(fs.readFileSync(path.join(ROOT, "build/parity.json"), "utf8"));
const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const S = readSymbols(r.sym);

// --- listing: addr -> {file, line, text}; banked ($C000+) blocks are told
// apart by the including file: raster.z80 -> banks 6/7, bank4.inc -> 4,
// collide.z80 -> 1 (whatever sits at $C000 in the main image otherwise).
const lst = fs.readFileSync(r.lst, "utf8").split("\n");
const byAddr = new Map();
let curFile = "main.z80", bankOf = 2;
const fileStack = [];
for (const raw of lst) {
  const m = /^\s*(\d+)([+ ]*)([0-9A-F]{4})\s((?:[0-9A-F]{2}\s)+)\s*(.*)$/.exec(raw);
  const opened = /^# file opened: (.*)$/.exec(raw), closed = /^# file closed: (.*)$/.exec(raw);
  if (opened) { fileStack.push(curFile); curFile = opened[1].trim(); if (curFile === "raster.z80") bankOf = 6; else if (curFile === "bank4.inc") bankOf = 4; continue; }
  if (closed) { curFile = fileStack.pop() || curFile; continue; }
  if (!m) continue;
  const addr = parseInt(m[3], 16);
  const text = m[5].replace(/\s+/g, " ").trim();
  if (!text || text.startsWith(";")) continue;
  const key = addr >= 0xc000 ? addr + (bankOf << 16) : addr;
  if (!byAddr.has(key)) byAddr.set(key, { file: curFile, line: Number(m[1]), text });
}

const m = new Spectrum128({ contention: process.env.NOCONT ? false : true });
m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/atan.bin")), 0x5B00 - 0x4000);
{ const b4 = fs.readFileSync(path.join(ROOT, "build/bank4.bin")); m.ram[4].set(b4, 0);
  const img = fs.readFileSync(path.join(ROOT, "build/doom.bin")).subarray(0, -b4.length);
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
const heat = new Map(), hits = new Map();
let grand = 0;
function runUntilHalt() {
  for (;;) {
    const s = m.cpu.getState();
    if (s.halted) break;
    const pc = s.pc, t = m.tstates;
    let b = m.pagedBank; if (b === 7) b = 6;
    const key = pc >= 0xc000 ? pc + (b << 16) : pc;
    m.step();
    heat.set(key, (heat.get(key) || 0) + (m.tstates - t));
    hits.set(key, (hits.get(key) || 0) + 1);
  }
}
let adynPose = null;
for (const f of frames) {
  poke16(V + 28, f.px_int & 0xffff); poke(V + 30, f.px_f);
  poke16(V + 31, f.py_int & 0xffff); poke(V + 33, f.py_f);
  poke(V + 34, f.ang); poke(V + 26, f.vz & 0xff);
  poke16(V + 36, f.wx & 0xffff); poke16(V + 38, f.wy & 0xffff);
  poke16(S.get("bsp_root"), BSP_ROOT);
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
  const s2 = m.cpu.getState(); s2.pc = rf; s2.sp = 0xbfee; s2.halted = false; m.cpu.setState(s2);
  m.poke(0xbff8, 0x76); m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
  const t0 = m.tstates;
  runUntilHalt();
  grand += m.tstates - t0;
}
const n = frames.length;
console.log(`heat over ${n} parity viewpoints, ${(grand / n / 1000).toFixed(0)}k T/frame (${grand} total)\n`);
const rows = [...heat.entries()].map(([k, t]) => ({ k, t, c: hits.get(k), l: byAddr.get(k) }));
if (doClass) {
  const cls = new Map();
  const classify = (txt) => {
    const s = txt.toLowerCase().replace(/\s+/g, " ");
    if (/^ld \(\w+\),(a|hl|de|bc|ix|iy)$/.test(s) || /^ld \([a-z_0-9+]+\),(a|hl|de|bc)$/.test(s)) return "store abs";
    if (/^ld (a|hl|de|bc|ix|iy),\([a-z_][a-z_0-9+]*\)$/.test(s)) return "load abs";
    if (/^ld \(i[xy][+-]/.test(s)) return "store (ix+d)";
    if (/^ld \w+,\(i[xy][+-]/.test(s) || /\(i[xy][+-]/.test(s)) return "(ix+d) other";
    if (/^(push|pop)/.test(s)) return "push/pop";
    if (/^(call|ret|rst)/.test(s)) return "call/ret";
    if (/^(jp|jr|djnz)/.test(s)) return "jump";
    if (/^ld \(hl\)|^ld \w,\(hl\)|\(hl\)/.test(s)) return "(hl)";
    if (/\((de|bc)\)/.test(s)) return "(de)/(bc)";
    if (/^(exx|ex af)/.test(s)) return "exx";
    return "alu/reg";
  };
  for (const r of rows) { const c = r.l ? classify(r.l.text) : "?"; const e = cls.get(c) || { t: 0, n: 0 }; e.t += r.t; e.n += r.c; cls.set(c, e); }
  for (const [c, e] of [...cls.entries()].sort((a, b) => b[1].t - a[1].t)) console.log(`${c.padEnd(14)} ${(e.t / n).toFixed(0).padStart(8)} T/f  ${(e.n / n).toFixed(0).padStart(7)} instr/f  (${(100 * e.t / grand).toFixed(1)}%)`);
  console.log();
}
const range = flag("--range", null);
let sel = rows;
if (onlyFile) sel = sel.filter(r => r.l && r.l.file === onlyFile);
if (range) { const [lo, hi] = range.split("-").map(Number); sel = sel.filter(r => r.l && r.l.line >= lo && r.l.line <= hi); }
if (flag("--by", "") === "line") {
  // aggregate a source range by listing line order, printed in address order
  sel.sort((a, b) => a.k - b.k);
  for (const r of sel) console.log(`${(r.t / n).toFixed(0).padStart(7)} ${(r.c / n).toFixed(1).padStart(7)}  ${r.l ? r.l.file + ":" + r.l.line : "?"}  ${r.l ? r.l.text : ""}`);
} else {
  sel.sort((a, b) => b.t - a.t);
  for (const r of sel.slice(0, top)) console.log(`${(r.t / n).toFixed(0).padStart(7)} T/f ${(r.c / n).toFixed(1).padStart(7)} x  ${(r.k & 0xffff).toString(16)}  ${r.l ? r.l.file + ":" + r.l.line : "?"}  ${r.l ? r.l.text : ""}`);
}
