const { ZHarness } = require('/Users/ebenupton/doom_z80/tools/zcall.js');
const z = new ZHarness('/Users/ebenupton/doom_z80/test/t_raster.z80');
const RW = 256, RH = 160, Y0 = 16;

// Reference model, matching the Z80 loops exactly.
function refLine(set, x1, y1, x2, y2) {
  const P = (x, y) => set.add(y * 256 + x);
  if (x1 === x2) { const a = Math.min(y1,y2), b = Math.max(y1,y2); for (let y=a;y<=b;y++) P(x1,y); return; }
  if (x1 > x2) { [x1,x2]=[x2,x1]; [y1,y2]=[y2,y1]; }
  const dx = x2 - x1, dyr = y2 - y1;
  if (dyr === 0) { for (let x=x1;x<=x2;x++) P(x,y1); return; }
  const dy = Math.abs(dyr), sy = dyr < 0 ? -1 : 1;
  let x = x1, y = y1;
  if (dy < dx) {
    let err = dx >> 1;
    for (let i = 0; i <= dx; i++) { P(x,y); if (i===dx) break; x++; err -= dy; if (err < 0) { err += dx; y += sy; } }
  } else {
    let err = dy >> 1;
    for (let i = 0; i <= dy; i++) { P(x,y); if (i===dy) break; err -= dx; if (err < 0) { err += dy; x++; } y += sy; }
  }
}

function screenSet(m, bank) {
  const s = new Set();
  for (let ry = 0; ry < RH; ry++) {
    const y = ry + Y0;
    const base = ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
    for (let cx = 0; cx < 32; cx++) {
      const b = m.ram[bank][base + cx];
      if (!b) continue;
      for (let k = 0; k < 8; k++) if ((b >> (7-k)) & 1) s.add(ry * 256 + cx*8 + k);
    }
  }
  return s;
}

z.call('sq_init');
z.call('raster_init');
z.call('raster_select', { a: 0 });

// spot check the row planes
let bad = 0;
for (let ry = 0; ry < RH; ry++) {
  const y = ry + Y0;
  const want = 0x4000 | ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
  const got = z.peek(0x8400 + ry) | (z.peek(0x8500 + ry) << 8);
  const gotB = z.peek(0x8600 + ry) | (z.peek(0x8700 + ry) << 8);
  if (got !== want) { if (bad++ < 4) console.log(`rowA[${ry}] got ${got.toString(16)} want ${want.toString(16)}`); }
  if (gotB !== (want | 0x8000)) { if (bad++ < 4) console.log(`rowB[${ry}] bad`); }
}
console.log('row planes:', bad ? 'FAIL' : 'ok');

// clear timing
let r = z.call('raster_clear', { a: 0 });
console.log(`raster_clear: ${r.tstates} T (${(r.tstates/70908*100).toFixed(1)}% of a frame)`);

// deterministic pseudo-random line battery
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
const cases = [];
for (let i = 0; i < 700; i++) cases.push([rnd(256), rnd(RH), rnd(256), rnd(RH)]);
// plus targeted shapes
for (const c of [[0,0,0,159],[255,0,255,159],[0,0,255,0],[0,159,255,159],[0,0,255,159],
                 [255,159,0,0],[10,5,10,5],[7,3,8,3],[0,80,255,80],[128,0,128,159],
                 [3,10,250,12],[3,12,250,10],[100,0,101,159],[100,159,101,0]]) cases.push(c);

let fails = 0, tsum = 0, px = 0;
for (const [x1,y1,x2,y2] of cases) {
  z.call('raster_clear', { a: 0 });
  const rr = z.call('plot_line', { c: x1, b: y1, e: x2, d: y2 });
  tsum += rr.tstates;
  const got = screenSet(z.m, 5);
  const want = new Set(); refLine(want, x1, y1, x2, y2);
  px += want.size;
  let ok = got.size === want.size;
  if (ok) for (const v of want) if (!got.has(v)) { ok = false; break; }
  if (!ok) {
    if (fails < 5) {
      const missing = [...want].filter(v=>!got.has(v)).slice(0,6).map(v=>`(${v%256},${v>>8})`);
      const extra = [...got].filter(v=>!want.has(v)).slice(0,6).map(v=>`(${v%256},${v>>8})`);
      console.log(`FAIL (${x1},${y1})-(${x2},${y2}) got ${got.size} want ${want.size} missing ${missing} extra ${extra}`);
    }
    fails++;
  }
}
console.log(`plot_line: ${fails} / ${cases.length} failed; avg ${(tsum/cases.length).toFixed(0)}T/line, ${(tsum/px).toFixed(1)}T/pixel`);
process.exit(fails ? 1 : 0);
