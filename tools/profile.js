#!/usr/bin/env node
// Attribute walkthrough frame time to subsystems, both inclusive (time spent
// anywhere inside a routine) and self (time not inside a deeper bucket).
const { run } = require("./bench.js");

const BUCKETS = new Set(["mul_u8","mul_s8_u8","mul_s16_u8","divs","fpmul8","mul_s8_s8",
  "rns_ahl","rns_hl","rns3_ahl","rns8_ahl","ev_at","linfn","pw","pw_diff","sp_alive",
  "sp_hasgap","sp_marksolid","sp_fuse","fu_ge","fu_verdict","ct_bounds","fu_lyext","fu_line","fu_out","fu_okeep","fu_orun","fu_above","sp_begin","sp_commit","pw_diff","pw_evd","sp_emit_range","sp_emit_range2","flush_edges","ct_span","ct_edge","queue_edge","sp_drawv","cross_col","cl_apply",
  "cl_at","cl_clampx","cl_clampy","to_view","rot_sin","rot_cos","recip","project_x",
  "project_y","view_setup","build_prod","bbox_range","bb_edge","near_cross","vertex_get",
  "point_on_side","render_seg","render_seg_body","walk","sp_emit","sp_commit","cmp_s16",
  "sincos_lookup","div16_8","dl_emit","dl_render","plot_line","raster_clear","sp_reset",
  "ptoa","ptoa_memo","bb_corner_angle","bb_angtox","sx4","walk_child","walk_ss","emit_edge","mul_u8","plot_vert","addr_of","find_eye_height","update_world_pos","view_setup"]);

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
mm.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6408 - 0x4000);
mm.ram[2].set(fs.readFileSync(path.join(ROOT, "build/doom.bin")), 0x8800 - 0x8000);
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
