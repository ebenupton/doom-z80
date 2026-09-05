const { ZHarness, s16 } = require('../tools/zcall.js');
const ROOT = require('path').resolve(__dirname, '..') + '/';
const fs = require('fs');
const R = ROOT + '';
const F = JSON.parse(fs.readFileSync(R + (process.env.FRAMES || 'build/frames.json'), 'utf8'));
const z = new ZHarness(R + 'test/t_view.z80');

// geometry into bank 0, tables into bank 2, node bboxes into bank 5
z.m.ram[0].set(fs.readFileSync(R + 'build/bank0.bin'), 0);
z.pokeBytes(0x8800, fs.readFileSync(R + 'build/tables.bin'));
z.m.ram[5].set(fs.readFileSync(R + 'build/nodebb.bin'), 0x6580 - 0x4000);
z.m.ram[5].set(fs.readFileSync(R + 'build/l8.bin'), 0x6200 - 0x4000);
z.m.ram[5].set(fs.readFileSync(R + 'build/atan.bin'), 0x5B00 - 0x4000);
z.call('sq_init');
z.call('cpm_init');              // pages the objects' bank and leaves the geometry's
z.m.applyPaging(6);              // the rasteriser's bank for its init
z.call('raster_init');
z.m.applyPaging(0);              // bank 0 (the geometry) at $C000

const V = z.sym_('VARS_BASE');
const A = { pl_x: V+28, pl_xf: V+30, pl_y: V+31, pl_yf: V+33, pl_ang: V+34,
            vs_vz: V+26, pl_wx: V+36, pl_wy: V+38, vc_stamp: V+40,
            dlist_ptr: V+8, bsp_root: z.sym_('bsp_root'),
            frame_nodes: z.sym_('frame_nodes'), frame_ss: z.sym_('frame_ss'), frame_segs: z.sym_('frame_segs'),
            sp_count: z.sym_('sp_count') };
z.poke16(A.bsp_root, 194);
z.poke(A.vc_stamp, 0);

let fail = 0, shown = 0, tsum = 0, worst = 0, worstI = -1, totalDiff = 0;
F.forEach((f, i) => {
  z.poke16(A.pl_x, f.px_int & 0xffff); z.poke(A.pl_xf, f.px_f);
  z.poke16(A.pl_y, f.py_int & 0xffff); z.poke(A.pl_yf, f.py_f);
  z.poke(A.pl_ang, f.ang);
  z.poke(A.vs_vz, f.vz & 0xff);
  z.poke16(A.pl_wx, f.wx & 0xffff); z.poke16(A.pl_wy, f.wy & 0xffff);
  // screen A is the back buffer: cleared first, then the frame plots its
  // lines into it as they are emitted; compare the pixels with the BBC
  // port's NJ rasterisation of its own draw calls
  z.poke(V + 10, 0);
  z.m.applyPaging(6);
  z.call('raster_clear', { a: 0 });
  z.call('raster_select', { a: 0 });
  z.m.applyPaging(0);
  const r = z.call('render_frame', {}, { maxT: 40000000 });
  tsum += r.tstates;
  if (r.tstates > worst) { worst = r.tstates; worstI = i; }
  const want = Buffer.from(f.bitmap, 'hex');
  let diff = 0;
  for (let ry = 0; ry < 160; ry++) {
    const y = ry + 16;
    const base = ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
    for (let cx = 0; cx < 32; cx++) {
      const d = z.m.ram[5][base + cx] ^ want[ry * 32 + cx];
      if (d) { let b = d; while (b) { diff += b & 1; b >>= 1; } }
    }
  }
  totalDiff += diff;
  if (diff) {
    fail++;
    if (shown++ < 6)
      console.log(`FAIL frame ${i} (${f.wx},${f.wy},${f.ang}): ${diff} pixels differ; beeb ${f.lines.length} lines;` +
                  ` nodes z=${z.peek(A.frame_nodes)} py=${f.nodes} ss z=${z.peek(A.frame_ss)} py=${f.ss} segs z=${z.peek(A.frame_segs)} py=${f.segs_processed}`);
  }
});
console.log(`\n${F.length - fail}/${F.length} frames pixel-identical to the BBC port's model (${(totalDiff / F.length).toFixed(1)} pixels/frame differ)`);
console.log(`render_frame: avg ${(tsum/F.length/1000).toFixed(0)}k T (${(3546900/(tsum/F.length)).toFixed(1)} fps), worst ${(worst/1000).toFixed(0)}k T at frame ${worstI}`);
process.exit(fail ? 1 : 0);
