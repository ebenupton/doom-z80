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
  banks[2].set(fs.readFileSync(path.join(ROOT, "build/doom.bin")), 0x8400 - 0x8000);

  const start = sym.get("START");
  const hdr = Buffer.alloc(30 + 2 + 54);
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
  // --- v3 extension ---
  hdr.writeUInt16LE(54, 30);         // extra header length
  hdr.writeUInt16LE(start, 32);      // PC
  hdr[34] = 4;                       // hardware: 128K
  hdr[35] = 0x10;                    // $7FFD: bank 0 at $C000, 48K ROM
  hdr[36] = 0;
  hdr[37] = 0;
  hdr[38] = 0;                       // $FFFD

  const parts = [hdr];
  for (let b = 0; b < 8; b++) {
    const page = Buffer.alloc(3);
    page.writeUInt16LE(0xffff, 0);   // 0xFFFF = stored uncompressed
    page[2] = b + 3;                 // .z80 page number for RAM bank b
    parts.push(page, banks[b]);
  }
  const out = Buffer.concat(parts);
  const file = path.join(ROOT, "build/doom.z80");
  fs.writeFileSync(file, out);
  console.log(`${file}  ${out.length} bytes  (PC=$${start.toString(16)})`);
  return { banks, start, sym };
}

if (require.main === module) build();
module.exports = { build };
