const { ZHarness } = require('/Users/ebenupton/doom_z80/tools/zcall.js');
const fs = require('fs');
const z = new ZHarness('/Users/ebenupton/doom_z80/test/t_raster.z80');
z.call('sq_init'); z.call('raster_init'); z.call('raster_select', { a: 0 });
const frames = JSON.parse(fs.readFileSync('/tmp/reflines.json','utf8'));
const DL = 0x5C00;
let worst = 0, worstA = 0, tot = 0, px = 0, nl = 0;
for (const f of frames) {
  // write the display list
  let p = DL;
  for (const [x1,y1,x2,y2] of f.lines) {
    z.poke(p++, x1 & 255); z.poke(p++, y1 & 255); z.poke(p++, x2 & 255); z.poke(p++, y2 & 255);
  }
  z.poke16(0xBC08, p);              // dlist_ptr
  const c = z.call('raster_clear', { a: 0 });
  const r = z.call('dl_render', {}, { maxT: 8000000 });
  const t = c.tstates + r.tstates;
  tot += t; px += f.px; nl += f.lines.length;
  if (t > worst) { worst = t; worstA = f.angle; }
}
const n = frames.length;
console.log(`raster over ${n} real frames:`);
console.log(`  avg ${(tot/n).toFixed(0)}T  = ${(70908/(tot/n)).toFixed(1)} fps if raster were the only cost`);
console.log(`  worst ${worst}T at angle ${worstA} (${(70908/worst).toFixed(1)} fps)`);
console.log(`  avg ${(nl/n).toFixed(1)} lines, ${(px/n).toFixed(0)} px; ${((tot - 43285*n)/px).toFixed(1)} T/pixel drawing`);
