// Attribute frame time to routines by tracking the innermost active CALL.
const { ZHarness } = require('./zcall.js');
const fs = require('fs');
const R = __dirname + '/../';
const F = JSON.parse(fs.readFileSync(R + 'build/frames.json', 'utf8'));
const z = new ZHarness(R + 'test/t_view.z80');
z.m.ram[0].set(fs.readFileSync(R + 'build/bank0.bin'), 0);
z.pokeBytes(0x8800, fs.readFileSync(R + 'build/tables.bin'));
z.m.ram[5].set(fs.readFileSync(R + 'build/nodebb.bin'), 0x6800 - 0x4000);
z.m.applyPaging(0);
z.call('sq_init'); z.call('raster_init');

// Symbols sorted by address, restricted to code.
const syms = [...z.sym.entries()].filter(([k, v]) => v >= 0x8f00 && v < 0xb800)
  .sort((a, b) => a[1] - b[1]);
// Only treat these as profiling buckets; everything else rolls into its caller.
const BUCKETS = new Set(['mul_u8','mul_s8_u8','mul_s16_u8','divs','fpmul8','mul_s8_s8',
  'rns_ahl','rns_hl','ev_at','linfn','pw','pw_diff','sp_alive','sp_hasgap','sp_marksolid',
  'sp_tighten','sp_draws','sp_drawv','clip_to_trap','cl_apply','cl_at','cl_clampx','cl_clampy',
  'to_view','rot_sin','rot_cos','recip','project_x','project_y','view_setup','build_prod',
  'bbox_range','bb_edge','near_cross','vertex_get','point_on_side','render_seg',
  'render_seg_body','walk','sp_emit','sp_commit','cmp_s16','sincos_lookup','div16_8']);
const bucketAddr = new Map();
for (const [k, v] of syms) if (BUCKETS.has(k)) bucketAddr.set(v, k);

const V = 0xBC00;
const totals = new Map();
let grand = 0;
const NF = Math.min(F.length, 40);
for (let i = 0; i < NF; i++) {
  const f = F[i];
  z.poke16(V+28, f.px_int & 0xffff); z.poke(V+30, f.px_f);
  z.poke16(V+31, f.py_int & 0xffff); z.poke(V+33, f.py_f);
  z.poke(V+34, f.ang); z.poke(V+26, f.vz & 0xff);
  z.poke16(V+36, f.wx & 0xffff); z.poke16(V+38, f.wy & 0xffff);
  z.poke16(V+440, 194); z.poke(V+40, 0);
  const st = z.m.cpu.getState(); st.pc = z.sym_('render_frame'); st.sp = 0xbfee; st.halted = false;
  z.m.cpu.setState(st); z.m.poke(0xbfee, 0xf8); z.m.poke(0xbfef, 0xbf);
  const stack = [];       // active buckets
  let cur = 'other';
  const t0 = z.m.tstates;
  let last = t0;
  for (;;) {
    const s = z.m.cpu.getState();
    const name = bucketAddr.get(s.pc);
    const t = z.m.tstates;
    // charge elapsed time to the current bucket
    totals.set(cur, (totals.get(cur) || 0) + (t - last));
    last = t;
    if (name) { stack.push({ name: cur, sp: s.sp }); cur = name; }
    else if (stack.length && s.sp > stack[stack.length - 1].sp) { cur = stack.pop().name; }
    z.m.step();
    if (z.m.cpu.getState().halted) break;
  }
  grand += z.m.tstates - t0;
}
const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
console.log(`profiled ${NF} frames, ${(grand / NF / 1000).toFixed(0)}k T/frame\n`);
console.log('routine            self T/frame    %');
for (const [k, v] of rows.slice(0, 22))
  console.log(`  ${k.padEnd(18)} ${(v / NF).toFixed(0).padStart(8)}  ${(100 * v / grand).toFixed(1).padStart(5)}%`);
