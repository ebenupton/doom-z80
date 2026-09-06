#!/usr/bin/env node
// Cache probe/miss counts over a viewpoint set (parity.json's form), in one
// machine so the persistent caches carry across frames as they do in play.
//   cachestats.js [frames.json]
// Counts: the vertex cache (VGET probes / vg_miss), the project_y cache
// (project_y / py_miss), the corner-phi memo (corner_phi_* / their misses),
// and the per-frame vertex-span stamp (vspan_emit / fresh).
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128 } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const BSP_ROOT = JSON.parse(fs.readFileSync(path.join(ROOT, "build/map.json"), "utf8")).root;   // the tree's root node, from the pack
const framesPath = process.argv[2] || path.join(ROOT, "build/parity.json");
const frames = JSON.parse(fs.readFileSync(framesPath, "utf8"));
const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const S = readSymbols(r.sym);

// listing: the addresses of inlined probe sites
const lst = fs.readFileSync(r.lst, "utf8").split("\n");
const sites = { vget: [], cpm_miss: [], vspan_fresh: [] };
for (const raw of lst) {
  const m = /^\s*(\d+)([+ ]*)([0-9A-F]{4})\s((?:[0-9A-F]{2}\s)+)\s*(.*)$/.exec(raw);
  if (!m) continue;
  const addr = parseInt(m[3], 16), text = m[5].replace(/\s+/g, " ").replace(/^>\s*/, "").trim();
  if (/^call nz,vg_miss/.test(text)) sites.vget.push(addr);
  if (/^ld ixh,(6|2|4|0)\b/.test(text) && addr >= 0xc000) sites.cpm_miss.push(addr);
}
const counters = new Map();
const name = new Map();
const add = (n, a) => { name.set(a, n); counters.set(a, 0); };
for (const n of ["vg_miss", "project_y", "py_miss", "corner_phi_pp", "corner_phi_pn", "corner_phi_np", "corner_phi_nn",
                 "vspan_emit", "sp_hasgap", "render_seg", "render_seg_body", "walk", "point_on_side", "bbox_visible", "lf_ns", "obj_project", "obj_draw_slot"])
  add(n, S.get(n) >= 0xc000 ? S.get(n) + 0x40000 : S.get(n));   // (the walk's routines live in bank 4)
sites.vget.forEach((a, i) => add("vget_probe" + i, a));
sites.cpm_miss.forEach((a, i) => add("cpm_miss" + i, a + 0x40000));   // bank 4 code
const vspanFresh = (() => { // the `ld (hl),a` after vspan_emit's stamp test
  const base = S.get("vspan_emit");
  for (const raw of lst) {
    const m = /^\s*(\d+)([+ ]*)([0-9A-F]{4})\s((?:[0-9A-F]{2}\s)+)\s*(.*)$/.exec(raw);
    if (!m) continue;
    const addr = parseInt(m[3], 16);
    if (addr > base && addr < base + 40 && /^ld \(hl\),a/.test(m[5].replace(/\s+/g, " ").replace(/^>\s*/, "").trim())) return addr;
  }
})();
add("vspan_fresh", vspanFresh);

const m = new Spectrum128({ contention: true });
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
const perFrame = [], vlog = [];
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
  const before = new Map(counters); let minSp = 0xffff;
  vlog.push([]);
  for (;;) {
    const s = m.cpu.getState();
    if (s.halted) break;
    let b = m.pagedBank;
    const key = s.pc >= 0xc000 ? s.pc + (b << 16) : s.pc;
    if (counters.has(key)) counters.set(key, counters.get(key) + 1);
    if (s.sp < minSp) minSp = s.sp;
    if (process.env.GATELOG && key === S.get("bbox_visible") + 0x40000) (vlog[vlog.length - 1]).push(["box", s.b, s.a]);
    if (process.env.GATELOG && key === S.get("wc_spec") + 0x40000) (vlog[vlog.length - 1]).push(["far", s.b, s.c]);
    if (process.env.ADYNLOG) { const L = vlog[vlog.length - 1];
      if (s.pc === S.get("render_subsector") + 0x40000 || s.pc === S.get("render_subsector")) L.push(["leaf", s.l]);
      if (s.pc === S.get("des_go")) L.push(["des", s.iy >> 8, s.iy & 255, s.c, s.d]);
      if (s.pc === S.get("adyn_f3")) L.push(["f3", s.a, s.b, s.c, s.d]);
      if (s.pc === S.get("adyn_fw")) L.push(["fw", s.a, s.b, s.c, s.d]);
      if (s.pc === S.get("obj_sd_go")) L.push(["obj", s.a, s.b, s.c, s.d]); }
    if (process.env.VLOG && s.pc === S.get("vg_miss")) (vlog[vlog.length - 1]).push((((s.h << 8) | s.l) - 0x7000) >> 3);
    if (process.env.PYLOG && s.pc === S.get("project_y")) (vlog[vlog.length - 1]).push([s.a, s.e, s.d]);
    if (process.env.PXLOG && s.pc === S.get("project_x")) (vlog[vlog.length - 1]).push(["px", (s.h << 8) | s.l, s.e, s.d]);
    if (process.env.PXLOG && s.pc === S.get("recip")) (vlog[vlog.length - 1]).push(["recip", (s.h << 8) | s.l]);
    m.step();
  }
  const d = {};
  for (const [a, n] of name) d[n] = counters.get(a) - before.get(a);
  if (process.env.ADYNDUMP) { let n = 0; for (let i = 0x3800; i < 0x3900; i++) if (m.ram[4][i]) n++; console.log("ADYN", f.key, "bits set in", n, "nodes; adyn_ctr", m.ram[2][V + 44 - 0x8000], "bbox calls", d.bbox_visible, "walk nodes", d.walk, "min SP", minSp.toString(16), "(VARS_END", (V + 505).toString(16) + ")"); }
  if (process.env.NODEDUMP) { const bits = {}; for (let i = 0x3800; i < 0x3900; i++) if (m.ram[4][i]) bits[i - 0x3800] = m.ram[4][i]; console.log("NODEDUMP", f.key, JSON.stringify(bits)); }
  if (process.env.VSDUMP) { const rd = (n) => m.ram[2][S.get(n) - 0x8000], rd16 = (n) => { const v = rd(n) | (m.ram[2][S.get(n) - 0x8000 + 1] << 8); return v & 0x8000 ? v - 65536 : v; };
    console.log("VSDUMP", f.key, JSON.stringify({ rx: rd16("vs_rx"), ry: rd16("vs_ry"), nx: rd16("vs_nx"), ny: rd16("vs_ny"), dxlo: rd("vs_dxlo"), dylo: rd("vs_dylo"), t1: rd16("vs_t1"), t2: rd16("vs_t2"), smag: rd("vs_smag"), cmag: rd("vs_cmag"), sneg: rd("vs_sneg"), cneg: rd("vs_cneg"), sunity: rd("vs_sunity"), cunity: rd("vs_cunity") })); }
  perFrame.push(d);
}
const n = frames.length;
const tot = (k) => perFrame.reduce((s, d) => s + (d[k] || 0), 0);
const vprobe = sites.vget.reduce((s, _, i) => s + tot("vget_probe" + i), 0);
const cpmProbe = ["pp", "pn", "np", "nn"].reduce((s, k) => s + tot("corner_phi_" + k), 0);
const cpmMiss = sites.cpm_miss.reduce((s, _, i) => s + tot("cpm_miss" + i), 0);
const line = (label, probes, misses) =>
  console.log(`  ${label.padEnd(22)} probes ${(probes / n).toFixed(2).padStart(8)}/frame  misses ${(misses / n).toFixed(2).padStart(8)}  hit ${(100 * (probes - misses) / Math.max(1, probes)).toFixed(1).padStart(5)}%`);
console.log(`Z80 ${path.basename(framesPath)}: ${n} frames`);
line("vertex cache", vprobe, tot("vg_miss"));
line("project_y cache", tot("project_y"), tot("py_miss"));
line("corner-phi memo", cpmProbe, cpmMiss);
line("vertex-span stamp", tot("vspan_emit"), tot("vspan_fresh"));
console.log(`  render_seg ${(tot("render_seg") / n).toFixed(2)}/f  bodies ${(tot("render_seg_body") / n).toFixed(2)}  sp_hasgap ${(tot("sp_hasgap") / n).toFixed(2)}  walk nodes ${(tot("walk") / n).toFixed(2)}  point_on_side ${(tot("point_on_side") / n).toFixed(2)}  bbox ${(tot("bbox_visible") / n).toFixed(2)}  lf_ns ${(tot("lf_ns") / n).toFixed(2)}`);
if (process.env.ADYNLOG) vlog.forEach((v, i) => console.log("ADYNLOG", frames[i].key, JSON.stringify(v)));
if (process.env.GATELOG) vlog.forEach((v, i) => console.log("GATELOG", frames[i].key, JSON.stringify(v)));
if (process.env.VLOG) vlog.forEach((v, i) => console.log("VLOG", frames[i].key, JSON.stringify(v.sort((a, b) => a - b))));
if (process.env.PXLOG) vlog.forEach((v, i) => console.log("PXLOG", frames[i].key, JSON.stringify(v)));
if (process.env.PYLOG) vlog.forEach((v, i) => console.log("PYLOG", frames[i].key, JSON.stringify(v)));
if (process.argv.includes("--per-frame")) perFrame.forEach((d, i) => console.log(frames[i].key, JSON.stringify(d)));
