// Call individual Z80 routines from JavaScript.
//
// Loads an assembled image into the emulator once, then lets a test drive
// any labelled routine thousands of times with chosen register and memory
// state. Return is detected by pushing a sentinel address whose opcode is
// HALT, so a plain RET lands there.

const fs = require("fs");
const path = require("path");
const { assemble, readSymbols } = require("./zbuild.js");
const { Spectrum128 } = require("./spectrum.js");

const SENTINEL = 0xbff8; // in bank 2, above the stack top

class ZHarness {
  constructor(src, opts = {}) {
    const base = path.basename(src).replace(/\.\w+$/, "");
    const bin = opts.bin || path.join(__dirname, "..", "build", base + ".bin");
    const r = assemble(src, bin);
    if (!r.ok) {
      throw new Error("assembly failed:\n" + r.out);
    }
    this.asmOut = r.out;
    this.sym = readSymbols(r.sym);
    this.m = new Spectrum128({ contention: opts.contention !== false });
    let data = fs.readFileSync(bin);
    const b4p = bin.replace(/\.bin$/, "_b4.bin");   // the objects' bank, when the source builds one
    if (fs.existsSync(b4p) && fs.statSync(b4p).mtimeMs >= fs.statSync(bin).mtimeMs - 5000) {
      const b4 = fs.readFileSync(b4p);
      this.m.ram[4].set(b4, 0);
      data = data.subarray(0, data.length - b4.length);   // the raw image carries a copy on its tail
    }
    this.org = this.sym.get("IMAGE_BASE");
    if (this.org === undefined) this.org = this.sym.get("ORG_ADDR");
    if (this.org === undefined) this.org = 0x8400;
    for (let i = 0; i < data.length; i++) {
      const a = this.org + i;
      if (a >= 0xc000) { this.m.ram[6][a - 0xc000] = data[i]; this.m.ram[7][a - 0xc000] = data[i]; }   // the rasteriser's banks
      else this.m.poke(a, data[i]);
    }
    this.m.poke(SENTINEL, 0x76); // HALT
    this.size = data.length;
  }

  sym_(name) {
    const v = this.sym.get(name);
    if (v === undefined) throw new Error("no symbol " + name);
    return v;
  }

  // Run a routine. `regs` may set a,f,b,c,d,e,h,l,ix,iy and the shadow set.
  // Returns the register state plus the T-states consumed.
  call(name, regs = {}, opts = {}) {
    const m = this.m;
    const st = m.cpu.getState();
    st.pc = typeof name === "number" ? name : this.sym_(name);
    st.sp = opts.sp || 0xbff0;
    st.iff1 = 0; st.iff2 = 0; st.halted = false;
    for (const k of ["a", "b", "c", "d", "e", "h", "l", "i", "r",
                     "ix", "iy"]) {
      if (regs[k] !== undefined) st[k] = regs[k];
    }
    if (regs.hl !== undefined) { st.h = (regs.hl >> 8) & 0xff; st.l = regs.hl & 0xff; }
    if (regs.de !== undefined) { st.d = (regs.de >> 8) & 0xff; st.e = regs.de & 0xff; }
    if (regs.bc !== undefined) { st.b = (regs.bc >> 8) & 0xff; st.c = regs.bc & 0xff; }
    m.cpu.setState(st);
    // push the sentinel return address
    m.poke(st.sp - 1, SENTINEL >> 8);
    m.poke(st.sp - 2, SENTINEL & 0xff);
    const st2 = m.cpu.getState();
    st2.sp = st.sp - 2;
    m.cpu.setState(st2);

    const t0 = m.tstates;
    const limit = opts.maxT || 4000000;
    while (m.tstates - t0 < limit) {
      m.step();
      const s = m.cpu.getState();
      if (opts.hook) opts.hook(s);
      if (s.halted) {
        const out = m.cpu.getState();
        out.tstates = m.tstates - t0;
        out.hl = (out.h << 8) | out.l;
        out.de = (out.d << 8) | out.e;
        out.bc = (out.b << 8) | out.c;
        out.cf = out.flags.C;
        out.zf = out.flags.Z;
        out.halted = false;
        m.cpu.setState(out);
        return out;
      }
    }
    throw new Error(`routine ${name} did not return within ${limit} T-states`);
  }

  peek(a) { return this.m.peek(a); }
  poke(a, v) { this.m.poke(a, v); }
  peek16(a) { return this.m.peek(a) | (this.m.peek(a + 1) << 8); }
  poke16(a, v) { this.m.poke(a, v & 0xff); this.m.poke(a + 1, (v >> 8) & 0xff); }
  peekBytes(a, n) {
    const o = new Uint8Array(n);
    for (let i = 0; i < n; i++) o[i] = this.m.peek(a + i);
    return o;
  }
  pokeBytes(a, bytes) {
    for (let i = 0; i < bytes.length; i++) this.m.poke(a + i, bytes[i]);
  }
}

// Signed helpers used all over the tests.
const s8 = (v) => (v & 0x80 ? (v & 0xff) - 256 : v & 0xff);
const s16 = (v) => (v & 0x8000 ? (v & 0xffff) - 65536 : v & 0xffff);
const s24 = (v) => (v & 0x800000 ? (v & 0xffffff) - 16777216 : v & 0xffffff);

module.exports = { ZHarness, SENTINEL, s8, s16, s24 };
