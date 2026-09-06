// Player collision test.  The Z80 box_clear (collide.z80: walls + door/step
// ports) must match the BBC's colmap.box_scan verdict bit-for-bit, and
// player_move must never leave the player inside a wall.
// Golden: test/collision_gold.json (colmap.box_scan; tools/gencollision.py).
// NOTE: floor step-up (dest_check) is implemented but GATED pending an exact
// find_ss port, so this tests the box test only — the part that is live.
const { ZHarness } = require('../tools/zcall.js');
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..') + '/';
const gold = JSON.parse(fs.readFileSync(ROOT + 'test/collision_gold.json', 'utf8'));
const z = new ZHarness(ROOT + 'test/t_view.z80');
z.m.ram[0].set(fs.readFileSync(ROOT + 'build/bank0.bin'), 0);
z.m.ram[1].set(fs.readFileSync(ROOT + 'build/coldata.bin'), 0);
z.pokeBytes(0x8800, fs.readFileSync(ROOT + 'build/tables.bin'));
z.m.applyPaging(1);
const S = n => z.sym_(n), s16 = v => v >= 32768 ? v - 65536 : v;
const boxBlocked = (nx, ny, zf) => {
  z.poke16(S('cm_qx'), (nx >> 3) & 0xffff); z.poke(S('cm_qxf'), (nx & 7) << 5);
  z.poke16(S('cm_qy'), (ny >> 3) & 0xffff); z.poke(S('cm_qyf'), (ny & 7) << 5);
  z.poke(S('vs_vz'), zf & 0xff);
  z.m.applyPaging(1);
  return z.call('box_clear').cf ? 0 : 1;
};

let mism = 0;
for (const [rx, ry, ddx, ddy, zf, blk] of gold) {
  const zb = boxBlocked(rx + ddx, ry + ddy, zf);
  if (zb !== blk) { if (mism < 6) console.log(`FAIL (${rx},${ry})+(${ddx},${ddy}) z=${zf}: colmap ${blk}, z80 ${zb}`); mism++; }
}

// player_move invariant: from clear starts, no committed move ends in a wall.
let bad = 0, moved = 0;
const deltas = [[0x100, 0], [0, -0x100], [0x300, 0x100], [-0x400, 0], [0, 0x900]];
const clears = [...new Set(gold.filter(c => !c[5]).map(c => c[0] + ',' + c[1]))].map(s => s.split(',').map(Number));
for (let i = 0; i < clears.length; i += 2) {
  const [rx, ry] = clears[i];
  if (boxBlocked(rx, ry, 0)) continue;   // only genuinely clear starts
  for (const [dx, dy] of deltas) {
    z.poke16(S('pl_x'), (rx >> 3) & 0xffff); z.poke(S('pl_xf'), 0);
    z.poke16(S('pl_y'), (ry >> 3) & 0xffff); z.poke(S('pl_yf'), 0);
    z.poke(S('vs_vz'), 0); z.poke16(S('mv_dx'), dx & 0xffff); z.poke16(S('mv_dy'), dy & 0xffff);
    z.m.applyPaging(1); z.call('player_move');
    const nx = s16(z.peek16(S('pl_x'))) * 8 + (z.peek(S('pl_xf')) >> 5), ny = s16(z.peek16(S('pl_y'))) * 8 + (z.peek(S('pl_yf')) >> 5);
    if (boxBlocked(nx, ny, 0)) { if (bad < 6) console.log(`IN-WALL (${rx},${ry})+(${dx},${dy})`); bad++; }
    if (s16(z.peek16(S('pl_x'))) * 8 !== rx || s16(z.peek16(S('pl_y'))) * 8 !== ry) moved++;
  }
}
console.log(`box_clear vs colmap.box_scan: ${gold.length - mism}/${gold.length} agree; player_move: ${bad} wall penetrations, ${moved} moved`);
process.exit(mism || bad ? 1 : 0);
