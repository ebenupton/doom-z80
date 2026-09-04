#!/usr/bin/env node
// Assemble a source file with sjasmplus and run it in the headless 128K
// Spectrum, then report or dump whatever the test asked for.
//
//   zbuild.js asm  src/foo.z80 -o build/foo.bin
//   zbuild.js run  src/foo.z80 [--frames N] [--png out.png] [--dump addr:len]
//
// Test programs signal completion by writing a magic byte to TEST_DONE and
// halting; the runner watches for the halt.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Spectrum128, TSTATES_PER_FRAME } = require("./spectrum.js");

const ROOT = path.resolve(__dirname, "..");
const SJASM = path.join(ROOT, "tools", "sjasmplus");

function assemble(src, outBin, opts = {}) {
  const lst = outBin.replace(/\.bin$/, ".lst");
  const sym = outBin.replace(/\.bin$/, ".sym");
  fs.mkdirSync(path.dirname(outBin), { recursive: true });
  const args = [
    "--nologo",
    `--lst=${lst}`,
    `--sym=${sym}`,
    `--raw=${outBin}`,
    `-I${path.join(ROOT, "src")}`,
    ...(opts.define || []).map((d) => `-D${d}`),
    src,
  ];
  try {
    const out = execFileSync(SJASM, args, { cwd: ROOT, encoding: "utf8" });
    return { ok: true, out, lst, sym, bin: outBin };
  } catch (e) {
    const msg = (e.stdout || "") + (e.stderr || "");
    return { ok: false, out: msg, lst, sym, bin: outBin };
  }
}

function readSymbols(symFile) {
  const map = new Map();
  if (!fs.existsSync(symFile)) return map;
  for (const line of fs.readFileSync(symFile, "utf8").split("\n")) {
    // sjasmplus --sym format:  NAME: EQU $ABCD
    const m = line.match(/^([A-Za-z_.@][\w.@]*):\s+EQU\s+(?:\$|0x)?([0-9A-Fa-f]+)/);
    if (m) map.set(m[1], parseInt(m[2], 16));
  }
  return map;
}

module.exports = { assemble, readSymbols, Spectrum128, TSTATES_PER_FRAME, ROOT };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  const src = argv.shift();
  const flag = (n, d) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : d;
  };
  const base = path.basename(src).replace(/\.\w+$/, "");
  const bin = flag("-o", path.join(ROOT, "build", base + ".bin"));
  const r = assemble(src, bin);
  if (!r.ok) {
    console.error(r.out);
    process.exit(1);
  }
  if (r.out.trim()) console.log(r.out.trim());
  if (cmd === "asm") {
    console.log(`assembled ${bin} (${fs.statSync(bin).size} bytes)`);
    process.exit(0);
  }
  const syms = readSymbols(r.sym);
  const org = syms.get("ORG_ADDR") !== undefined ? syms.get("ORG_ADDR") : 0x8000;
  const m = new Spectrum128({ contention: flag("--contention", "1") !== "0" });
  const data = fs.readFileSync(bin);
  for (let i = 0; i < data.length; i++) m.poke(org + i, data[i]);
  const st = m.cpu.getState();
  st.pc = syms.get("START") !== undefined ? syms.get("START") : org;
  st.sp = 0xbfff;
  st.iff1 = 0; st.iff2 = 0; st.imode = 1;
  m.cpu.setState(st);

  const frames = Number(flag("--frames", 0));
  let res;
  if (frames > 0) {
    res = m.run(frames * TSTATES_PER_FRAME);
  } else {
    // Run until HALT (the test convention) or a generous timeout.
    const limit = m.tstates + TSTATES_PER_FRAME * 400;
    res = { reason: "timeout" };
    while (m.tstates < limit) {
      m.step();
      if (m.cpu.getState().halted) { res = { reason: "halt" }; break; }
    }
  }
  const t = m.tstates;
  console.log(`${res.reason} tstates=${t} (${(t / TSTATES_PER_FRAME).toFixed(2)} frames) ` +
              `insns=${m.instructionCount} contention=${m.contentionCycles}`);
  const png = flag("--png", null);
  if (png) { m.savePNG(png, { border: 8, scale: 2 }); console.log("png -> " + png); }
  for (const a of argv.filter((x) => /^--dump=/.test(x))) {
    const [addr, len] = a.slice(7).split(":");
    const A = parseInt(addr, 16), L = parseInt(len || "16", 10);
    let s = "";
    for (let i = 0; i < L; i++) s += m.peek(A + i).toString(16).padStart(2, "0") + " ";
    console.log(`${A.toString(16)}: ${s}`);
  }
}
