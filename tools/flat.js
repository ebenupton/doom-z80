#!/usr/bin/env node
// Flat profile of the parity viewpoints: every instruction's T-states go to
// the nearest label at or below its address, so tail calls and fall-throughs
// can't misattribute anything.  argv[2] = rows (default 60), argv[3] = a
// viewpoint key substring.
const fs = require("fs"), path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128 } = require("./spectrum.js");
const ROOT = path.resolve(__dirname, "..");
const rows = Number(process.argv[2] || 60), only = process.argv[3] || "";
const frames = JSON.parse(fs.readFileSync(path.join(ROOT, "build/parity.json"), "utf8")).filter(f => f.key.includes(only));
const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!r.ok) { console.error(r.out); process.exit(1); }
const S = readSymbols(r.sym);
// label per address, for the code banks only
const owner = new Int32Array(65536).fill(-1), names = [];
const syms = [...S.entries()].filter(([k, v]) => v >= 0x8000 && v < 0xC000 && !/^[A-Z_0-9]+$/.test(k) && !k.startsWith('.')).sort((a, b) => a[1] - b[1]);
for (let i = 0; i < syms.length; i++) {
  const [k, v] = syms[i], end = i + 1 < syms.length ? syms[i + 1][1] : 0xC000;
  names.push(k); for (let a = v; a < end; a++) owner[a] = i;
}
const m = new Spectrum128();
m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
m.ram[2].set(fs.readFileSync(path.join(ROOT, "build/doom.bin")), 0x8400 - 0x8000);
const st = m.cpu.getState(); st.pc = S.get("START"); st.sp = 0xbff0; st.imode = 1; m.cpu.setState(st);
const rf = S.get("render_frame");
while (m.cpu.getState().pc !== rf) m.step();
const V = 0xBC00; m.ram[2][0xBC28 - 0x8000] = 0;
const poke16 = (a, v) => { m.ram[2][a - 0x8000] = v & 255; m.ram[2][a - 0x8000 + 1] = (v >> 8) & 255; };
const poke = (a, v) => { m.ram[2][a - 0x8000] = v & 255; };
const T = new Float64Array(names.length), N = new Float64Array(names.length);
let grand = 0;
function runUntilHalt() {
  for (;;) {
    const s = m.cpu.getState(); if (s.halted) break;
    const pc = s.pc, t0 = m.tstates; m.step();
    const o = owner[pc]; if (o >= 0) { T[o] += m.tstates - t0; N[o]++; }
  }
}
for (const f of frames) {
  poke16(V + 28, f.px_int & 0xffff); poke(V + 30, f.px_f); poke16(V + 31, f.py_int & 0xffff); poke(V + 33, f.py_f);
  poke(V + 34, f.ang); poke(V + 26, f.vz & 0xff); poke16(V + 36, f.wx & 0xffff); poke16(V + 38, f.wy & 0xffff);
  poke16(V + 440, 194); poke(V + 525, 0);
  const s2 = m.cpu.getState(); s2.pc = rf; s2.sp = 0xbfee; s2.halted = false; m.cpu.setState(s2);
  m.poke(0xbff8, 0x76); m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf);
  const t0 = m.tstates; runUntilHalt();
  m.applyPaging(0x17);
  for (const [entry, a] of [[S.get("raster_select"), 1], [S.get("dl_render"), 0]]) {
    const s3 = m.cpu.getState(); s3.pc = entry; s3.a = a; s3.sp = 0xbfee; s3.halted = false; m.cpu.setState(s3);
    m.poke(0xbfee, 0xf8); m.poke(0xbfef, 0xbf); runUntilHalt();
  }
  m.applyPaging(0x10); grand += m.tstates - t0;
}
const n = frames.length;
console.log(`${n} parity viewpoints, ${(grand / n / 1000).toFixed(0)}k T/frame\n`);
console.log("label                    T/frame     %   instr/f");
const idx = [...names.keys()].sort((a, b) => T[b] - T[a]);
let shown = 0;
for (const i of idx.slice(0, rows)) {
  shown += T[i];
  console.log(`  ${names[i].padEnd(22)} ${(T[i] / n).toFixed(0).padStart(8)} ${(100 * T[i] / grand).toFixed(1).padStart(5)}% ${(N[i] / n).toFixed(0).padStart(8)}`);
}
console.log(`  (shown ${(100 * shown / grand).toFixed(1)}% of the frame)`);
// --- by subsystem ---------------------------------------------------------
const GROUPS = [
  [/^(dv_|sp_drawv)/, "sp_drawv"], [/^(fu_|fo_|fl_|fv_|fa_|sp_fuse)/, "sp_fuse"],
  [/^(se_|sr_|sp_emit|sp_free|sp_relink|sp_walk|swb_)/, "sp_emit/walk"], [/^(hg_|sp_hasgap)/, "sp_hasgap"],
  [/^(ms_(?!neg)|sp_marksolid)/, "sp_marksolid"], [/^(ct_|fe_|fx_|cc_|queue_edge|emit_edge|cross_col|pw_|pwe_|al_|sp_alive)/, "extras/clip"],
  [/^(ev_|cb_|clampb)/, "ev_at"], [/^(lf_(?!log)|linfn)/, "linfn"], [/^(dv_|db_|divs)/, "divs"],
  [/^(py_|rh_|project_y|rns_hl)/, "project_y"], [/^(px_|ra_|project_x|rns_ahl|sat_)/, "project_x"], [/^(rp_|recip)/, "recip"],
  [/^(vg_|vx_|vertex_get)/, "vertex_get"], [/^(rs_|rsb_|render_seg|set_op|near_cross|nc_)/, "render_seg"],
  [/^(bb_|ba_|pa_|cpm_|lf_log|lf_big|lf_flat|lf_oct|ptoa|bbox)/, "bbox"], [/^(wk_|ss_|walk|node_|bsp_)/, "walk"], [/^(pos_|point_on_side)/, "point_on_side"],
  [/^(pv_|ps_|psd_|psu_|cp[0-7]|ys[0-7]|pt_|pl_|plot_|dl_|rsel|addr_of|ph_|PV8|raster)/, "raster"],
  [/^(rot_|rs_k|rsn|rcn|rsm|rcm|ms16|mul_|ms_neg|mu_|neg_ahl|rns3|rns8)/, "mul/rot"], [/^(vs_|fterm|ft_|np_|neg_pos|view_setup|sincos|sc_|patch_sign|ps_neg)/, "view_setup"],
  [/^(sq_|sp_reset|sr_l|cpm_init|vcache_wipe|vw_)/, "reset"], [/^render_frame/, "render_frame"],
];
const G = new Map();
for (let i = 0; i < names.length; i++) {
  let g = "other:" + names[i];
  for (const [re, name] of GROUPS) if (re.test(names[i])) { g = name; break; }
  G.set(g, (G.get(g) || 0) + T[i]);
}
console.log("\nsubsystem            T/frame     %");
for (const [k, v] of [...G.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30))
  console.log(`  ${k.padEnd(20)} ${(v / n).toFixed(0).padStart(8)} ${(100 * v / grand).toFixed(1).padStart(5)}%`);
