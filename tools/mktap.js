#!/usr/bin/env node
// Build build/doom.tap: BASIC loader, boot stub, then the three data blocks.
//
// Untested against real tape hardware - this environment has no tape
// emulation - so build/doom.z80 remains the verified artefact.
const fs = require("fs");
const path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const ROOT = path.resolve(__dirname, "..");

function tapBlock(flag, payload) {
  const body = Buffer.concat([Buffer.from([flag]), payload]);
  let sum = 0;
  for (const b of body) sum ^= b;
  const full = Buffer.concat([body, Buffer.from([sum])]);
  const len = Buffer.alloc(2);
  len.writeUInt16LE(full.length, 0);
  return Buffer.concat([len, full]);
}

function header(type, name, length, p1, p2) {
  const h = Buffer.alloc(17);
  h[0] = type;
  Buffer.from(name.padEnd(10).slice(0, 10), "ascii").copy(h, 1);
  h.writeUInt16LE(length, 11);
  h.writeUInt16LE(p1, 13);
  h.writeUInt16LE(p2, 15);
  return tapBlock(0x00, h);
}

function codeFile(name, addr, data) {
  return Buffer.concat([header(3, name, data.length, addr, 32768),
                        tapBlock(0xff, data)]);
}

// 10 CLEAR VAL "32767": LOAD ""CODE : RANDOMIZE USR VAL "32768"
function basicLoader() {
  const t = [];
  t.push(0xfd, 0xb0, 0x22); t.push(...Buffer.from("32767")); t.push(0x22);
  t.push(0x3a, 0xef, 0x22, 0x22, 0xaf);
  t.push(0x3a, 0xf9, 0xc0, 0xb0, 0x22); t.push(...Buffer.from("32768")); t.push(0x22);
  t.push(0x0d);
  const line = Buffer.alloc(4 + t.length);
  line.writeUInt16BE(10, 0);            // line number, big endian
  line.writeUInt16LE(t.length, 2);
  Buffer.from(t).copy(line, 4);
  return Buffer.concat([header(0, "doom", line.length, 10, line.length),
                        tapBlock(0xff, line)]);
}

const eng = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
if (!eng.ok) { console.error(eng.out); process.exit(1); }
const engSym = readSymbols(eng.sym);
const bank4 = fs.readFileSync(path.join(ROOT, "build/bank4.bin"));
const image = fs.readFileSync(path.join(ROOT, "build/doom.bin")).subarray(0, -bank4.length);   // the raw image carries a copy of bank 4 on its tail

// The stub needs the image length and entry point baked in.
const l8 = fs.readFileSync(path.join(ROOT, "build/l8.bin"));
const atan = fs.readFileSync(path.join(ROOT, "build/atan.bin"));
const defs = [`IMAGE_LEN=${image.length}`, `BANK4_LEN=${bank4.length}`, `L8_LEN=${l8.length}`, `ATAN_LEN=${atan.length}`, `CODE_IMAGE=0x8800`,
              `ENGINE_START=0x${engSym.get("START").toString(16)}`];
const boot = assemble(path.join(ROOT, "src/tapeboot.z80"),
                      path.join(ROOT, "build/tapeboot.bin"), { define: defs });
if (!boot.ok) { console.error(boot.out); process.exit(1); }
const stub = fs.readFileSync(path.join(ROOT, "build/tapeboot.bin"));

const geom = fs.readFileSync(path.join(ROOT, "build/bank0.bin"));
const nodebb = fs.readFileSync(path.join(ROOT, "build/nodebb.bin"));

const tap = Buffer.concat([
  basicLoader(),
  codeFile("boot", 0x8000, stub),
  codeFile("geom", 0xc000, geom),
  codeFile("objs", 0xc000, bank4),
  codeFile("bbox", 0x6580, nodebb),
  codeFile("l8", 0x6200, l8),
  codeFile("atan", 0x5b00, atan),
  codeFile("engine", 0x8800, image),
]);
const out = path.join(ROOT, "build/doom.tap");
fs.writeFileSync(out, tap);
console.log(`${out}  ${tap.length} bytes  (stub ${stub.length}, image ${image.length})`);
