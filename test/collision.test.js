// Player wall-collision test: the Z80 box_clear (collide.z80) must agree with
// the BBC port's colmap.box_blocked at every grid point (bit-identical box
// test), and player_move must never leave the player inside a wall.
const { ZHarness } = require('../tools/zcall.js');
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..') + '/';
const gold = JSON.parse(fs.readFileSync(ROOT + 'test/collision_gold.json', 'utf8'));
const z = new ZHarness(ROOT + 'test/t_view.z80');
z.m.ram[0].set(fs.readFileSync(ROOT + 'build/bank0.bin'), 0);
z.m.ram[1].set(fs.readFileSync(ROOT + 'build/coldata.bin'), 0);   // collision tables at $C000
z.pokeBytes(0x8800, fs.readFileSync(ROOT + 'build/tables.bin'));
z.m.applyPaging(1);
const S = n => z.sym_(n), s16 = v => v >= 32768 ? v - 65536 : v;
const clearAt = (qx, qy) => { z.poke16(S('cm_qx'), qx & 0xffff); z.poke(S('cm_qxf'), 0); z.poke16(S('cm_qy'), qy & 0xffff); z.poke(S('cm_qyf'), 0); return !!z.call('box_clear').cf; };

let mism = 0;
for (const [qx, qy, blk] of gold) {
  const zblk = clearAt(qx, qy) ? 0 : 1;
  if (zblk !== blk) { if (mism < 6) console.log(`FAIL box (${qx},${qy}): colmap ${blk}, z80 ${zblk}`); mism++; }
}

// player_move invariant: from clear starts, no move ends inside a wall.
let bad = 0, moved = 0;
const deltas = [[0x100, 0], [0, -0x100], [0x300, 0x100], [-0x200, 0x200], [0, 0x400], [-0x400, 0]];
const clears = gold.filter(p => p[2] === 0);
for (let i = 0; i < clears.length; i += 3) {
  const [qx, qy] = clears[i];
  for (const [dx, dy] of deltas) {
    z.poke16(S('pl_x'), qx & 0xffff); z.poke(S('pl_xf'), 0);
    z.poke16(S('pl_y'), qy & 0xffff); z.poke(S('pl_yf'), 0);
    z.poke16(S('mv_dx'), dx & 0xffff); z.poke16(S('mv_dy'), dy & 0xffff);
    z.call('player_move');
    const rx = s16(z.peek16(S('pl_x'))), ry = s16(z.peek16(S('pl_y')));
    if (!clearAt(rx, ry)) { if (bad < 6) console.log(`IN-WALL (${qx},${qy})+(${dx},${dy}) -> (${rx},${ry})`); bad++; }
    if (rx !== qx || ry !== qy) moved++;
  }
}
console.log(`box_clear: ${gold.length - mism}/${gold.length} agree with colmap; player_move: ${bad} wall penetrations, ${moved} moved`);
process.exit(mism || bad ? 1 : 0);
