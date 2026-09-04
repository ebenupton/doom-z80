const { ZHarness, s16 } = require('/Users/ebenupton/doom_z80/tools/zcall.js');
const fs = require('fs');
const R = '/Users/ebenupton/doom_z80/';
const F = JSON.parse(fs.readFileSync(R + 'build/frames.json', 'utf8'));
const z = new ZHarness(R + 'test/t_view.z80');

// geometry into bank 0, tables into bank 2, node bboxes into bank 5
z.m.ram[0].set(fs.readFileSync(R + 'build/bank0.bin'), 0);
z.pokeBytes(0x8800, fs.readFileSync(R + 'build/tables.bin'));
z.m.ram[5].set(fs.readFileSync(R + 'build/nodebb.bin'), 0x6580 - 0x4000);
z.m.ram[5].set(fs.readFileSync(R + 'build/l8.bin'), 0x6200 - 0x4000);
z.m.applyPaging(0);              // bank 0 at $C000

z.call('sq_init');
z.call('cpm_init');
z.call('raster_init');

const V = 0xBC00;
const A = { pl_x: V+28, pl_xf: V+30, pl_y: V+31, pl_yf: V+33, pl_ang: V+34,
            vs_vz: V+26, pl_wx: V+36, pl_wy: V+38, vc_stamp: V+40,
            dlist_ptr: V+8, bsp_root: V+440,
            frame_nodes: V+434, frame_ss: V+436, frame_segs: V+438,
            sp_count: V+92 };
z.poke16(A.bsp_root, 194);
z.poke(A.vc_stamp, 0);

let fail = 0, shown = 0, tsum = 0, worst = 0, worstI = -1, pixelSame = 0;
F.forEach((f, i) => {
  z.poke16(A.pl_x, f.px_int & 0xffff); z.poke(A.pl_xf, f.px_f);
  z.poke16(A.pl_y, f.py_int & 0xffff); z.poke(A.pl_yf, f.py_f);
  z.poke(A.pl_ang, f.ang);
  z.poke(A.vs_vz, f.vz & 0xff);
  z.poke16(A.pl_wx, f.wx & 0xffff); z.poke16(A.pl_wy, f.wy & 0xffff);
  const r = z.call('render_frame', {}, { maxT: 40000000 });
  tsum += r.tstates;
  if (r.tstates > worst) { worst = r.tstates; worstI = i; }
  const end = z.peek16(A.dlist_ptr);
  const got = [];
  for (let p = z.sym_("DLIST_BASE"); p < end; p += 4)
    got.push([z.peek(p), z.peek(p+1), z.peek(p+2), z.peek(p+3)]);
  const want = f.lines.map(l => l.map(v => v & 0xff));
  let ok = got.length === want.length;
  if (ok) for (let k = 0; k < got.length; k++)
    for (let j = 0; j < 4; j++) if (got[k][j] !== want[k][j]) { ok = false; break; }
  if (!ok) {
    // The display lists differ; check whether the rendered pixels do.
    const bmp = (lines) => {
      const s = new Set();
      for (const [x1, y1, x2, y2] of lines) {
        const dx = Math.abs(x2-x1), dy = Math.abs(y2-y1);
        const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
        let x = x1, y = y1, e = (dx > dy ? dx : dy) >> 1;
        const n = Math.max(dx, dy);
        for (let i = 0; i <= n; i++) {
          s.add(y * 256 + x);
          if (dx >= dy) { e -= dy; if (e < 0) { y += sy; e += dx; } x += sx; }
          else { e -= dx; if (e < 0) { x += sx; e += dy; } y += sy; }
        }
      }
      return s;
    };
    const a = bmp(got), b = bmp(want);
    let same = a.size === b.size;
    if (same) for (const v of a) if (!b.has(v)) { same = false; break; }
    if (same) { pixelSame++; return; }
  }
  if (!ok) {
    fail++;
    if (shown++ < 4) {
      console.log(`FAIL frame ${i} ang=${f.ang}: got ${got.length} lines, want ${want.length}`);
      console.log(`  nodes z=${z.peek(A.frame_nodes)} py=${f.nodes}  ss z=${z.peek(A.frame_ss)} py=${f.ss}  segs z=${z.peek(A.frame_segs)} py=${f.segs}`);
      for (let k = 0; k < Math.min(6, Math.max(got.length, want.length)); k++)
        console.log(`   [${k}] z=${JSON.stringify(got[k])} py=${JSON.stringify(want[k])}`);
    }
  }
});
console.log(`\n${F.length - fail}/${F.length} frames match` + (pixelSame ? ` (${pixelSame} of them by rendered pixels, not display-list order)` : ''));
console.log(`render_frame: avg ${(tsum/F.length/1000).toFixed(0)}k T (${(3546900/(tsum/F.length)).toFixed(1)} fps), worst ${(worst/1000).toFixed(0)}k T at frame ${worstI}`);
process.exit(fail ? 1 : 0);
