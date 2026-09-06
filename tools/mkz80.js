#!/usr/bin/env node
// Write a 128K .z80 v3 snapshot of the built engine, ready to start.
//
// The engine needs three things in RAM before it runs: the geometry in bank 0,
// the node bounding boxes in bank 5, and the code image in bank 2. A snapshot
// carries all of that with no loader, which makes it the artefact to test with.

const fs = require("fs");
const path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");

const ROOT = path.resolve(__dirname, "..");

function build() {
  const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
  if (!r.ok) { console.error(r.out); process.exit(1); }
  const sym = readSymbols(r.sym);

  const banks = [];
  for (let i = 0; i < 8; i++) banks.push(Buffer.alloc(16384));
  banks[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
  banks[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
  banks[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
  banks[5].set(fs.readFileSync(path.join(ROOT, "build/atan.bin")), 0x5B00 - 0x4000);
  { const b4 = fs.readFileSync(path.join(ROOT, "build/bank4.bin")); banks[4].set(b4, 0);
    const img = fs.readFileSync(path.join(ROOT, "build/doom.bin")).subarray(0, -b4.length);   // the raw image carries a copy of bank 4 on its tail
    banks[2].set(img.subarray(0, Math.min(img.length, 0xc000 - 0x8400)), 0x8400 - 0x8000);
    if (img.length > 0xc000 - 0x8400) { banks[6].set(img.subarray(0xc000 - 0x8400), 0); banks[7].set(img.subarray(0xc000 - 0x8400), 0); } }

  const start = sym.get("START");
  // A v2 extended header (bonus length 23) with hardware byte 3 = 128K: this
  // is the universally-recognised 128K .z80 encoding.  (A v3 header, length
  // 54, would use hardware byte 4 for 128K, but some loaders - Tom Harte's
  // CLK among them - follow the v2 numbering and reject byte 4, so v2 is the
  // portable choice.)
  const hdr = Buffer.alloc(30 + 2 + 23);
  // --- v1 header ---
  hdr[0] = 0;                        // A
  hdr[1] = 0;                        // F
  hdr.writeUInt16LE(0, 2);           // BC
  hdr.writeUInt16LE(0, 4);           // HL
  hdr.writeUInt16LE(0, 6);           // PC = 0 marks a v2/v3 snapshot
  hdr.writeUInt16LE(0xbff0, 8);      // SP
  hdr[10] = 0x3f;                    // I
  hdr[11] = 0;                       // R
  hdr[12] = 0x00;                    // border black, uncompressed pages
  hdr.writeUInt16LE(0, 13);          // DE
  hdr.writeUInt16LE(0, 15);          // BC'
  hdr.writeUInt16LE(0, 17);          // DE'
  hdr.writeUInt16LE(0, 19);          // HL'
  hdr[21] = 0; hdr[22] = 0;          // AF'
  hdr.writeUInt16LE(0x5c3a, 23);     // IY (ROM expects this)
  hdr.writeUInt16LE(0, 25);          // IX
  hdr[27] = 0; hdr[28] = 0;          // IFF1 / IFF2 off; the engine sets IM2
  hdr[29] = 1;                       // IM 1 until setup_im2 runs
  // --- v2 extension ---
  hdr.writeUInt16LE(23, 30);         // bonus header length (v2)
  hdr.writeUInt16LE(start, 32);      // PC
  hdr[34] = 3;                       // hardware: 128K (v2 numbering)
  hdr[35] = 0x10;                    // $7FFD: bank 0 at $C000, 48K ROM
  hdr[36] = 0;                       // (unused)
  hdr[37] = 0;                       // no 'hardware modify' bit
  hdr[38] = 0;                       // $FFFD (AY latch)

  // Pages are RLE-COMPRESSED, not stored raw.  The .z80 v2 format marks an
  // uncompressed page with a length of 0xFFFF, but that is a sentinel, not a
  // real byte count - and at least one emulator (Tom Harte's CLK) advances
  // the file position by that 0xFFFF after an uncompressed page instead of by
  // 16384, which mislays every following page and leaves the code bank zero.
  // Compressed pages carry their true length, so every loader (CLK, Fuse,
  // ZEsarUX, ...) reads them correctly.
  //
  // Encoding: a run of >=5 equal bytes -> ED ED count value; a run of the
  // byte ED (>=2) -> ED ED count ED; a lone ED is emitted with the byte after
  // it (never leaving ED ED to be misread); everything else raw.
  const compressPage = (buf) => {
    const out = [];
    let i = 0;
    while (i < buf.length) {
      const b = buf[i];
      let run = 1;
      while (i + run < buf.length && buf[i + run] === b && run < 255) run++;
      if (b === 0xed) {
        if (run >= 2) { out.push(0xed, 0xed, run, 0xed); i += run; }
        else { out.push(0xed); if (i + 1 < buf.length) out.push(buf[i + 1]); i += 2; }
      } else if (run >= 5) {
        out.push(0xed, 0xed, run, b); i += run;
      } else {
        for (let k = 0; k < run; k++) out.push(b);
        i += run;
      }
    }
    return Buffer.from(out);
  };

  const parts = [hdr];
  for (let b = 0; b < 8; b++) {
    const comp = compressPage(banks[b]);
    const page = Buffer.alloc(3);
    page.writeUInt16LE(comp.length, 0);   // real compressed length
    page[2] = b + 3;                       // .z80 page number for RAM bank b
    parts.push(page, comp);
  }
  const out = Buffer.concat(parts);
  const file = path.join(ROOT, "build/doom.z80");
  fs.writeFileSync(file, out);
  console.log(`${file}  ${out.length} bytes  (PC=$${start.toString(16)})`);
  return { banks, start, sym };
}

if (require.main === module) build();
module.exports = { build };
