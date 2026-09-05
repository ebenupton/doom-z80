// The Z80 rasteriser against the 6502's own frames: plot the 6502's plotted
const ROOT = require('path').resolve(__dirname, '..') + '/';
// line list through dl_render and compare the pixels with its framebuffer.
const { ZHarness } = require('../tools/zcall.js');
const fs = require('fs');
const R = ROOT + '';
const F = JSON.parse(fs.readFileSync(R + 'build/frames.json', 'utf8'));
const z = new ZHarness(R + 'test/t_view.z80');
z.pokeBytes(0x8800, fs.readFileSync(R + 'build/tables.bin'));
z.m.applyPaging(6);              // the rasteriser lives in bank 7
z.call('raster_init');
const base = z.sym_('DLIST_BASE');
let fail = 0, total = 0, shown = 0;
const N = +(process.env.NFRAMES || F.length);
for (let i = 0; i < N; i++) {
  const f = F[i];
  let p = base;
  for (const [x0, y0, x1, y1] of f.lines) { z.poke(p, x0); z.poke(p+1, y0); z.poke(p+2, x1); z.poke(p+3, y1); p += 4; }
  z.poke16(z.sym_('dlist_ptr'), p);
  z.call('raster_clear', { a: 0 }); z.call('raster_select', { a: 0 });
  z.call('dl_render', {}, { maxT: 40000000 });
  const want = Buffer.from(f.bitmap, 'hex');
  let diff = 0;
  for (let ry = 0; ry < 160; ry++) {
    const y = ry + 16, b = ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
    for (let cx = 0; cx < 32; cx++) { let d = z.m.ram[5][b + cx] ^ want[ry * 32 + cx]; while (d) { diff += d & 1; d >>= 1; } }
  }
  total += diff;
  if (diff) { fail++; if (shown++ < 5) console.log(`frame ${i}: ${diff} px differ (${f.lines.length} lines)`); }
}
console.log(`${N - fail}/${N} frames rasterise identically to the 6502 (${(total / N).toFixed(2)} px/frame)`);
