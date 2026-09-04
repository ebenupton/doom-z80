// Headless ZX Spectrum 128K emulator for automated testing.
//
// Uses Molly Howell's Z80 core (tools/Z80.js, MIT) for instruction semantics
// and adds the 128K machine around it: 8 x 16K banks, the 0x7FFD paging port,
// ULA screen decode, keyboard matrix, and an approximate contention model.
//
// The contention model is necessarily approximate: the CPU core reports cycles
// per instruction rather than per bus access, so a contended access is charged
// the delay for the instruction's current T-state position rather than the
// exact cycle the access lands on. Counts of contended accesses are right; the
// per-access phase is not. Good to a few percent for frame budgeting.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Z80 = require("./Z80.js");

const TSTATES_PER_FRAME = 70908; // 128K: 228 T/line * 311 lines
const TSTATES_PER_LINE = 228;
const FIRST_PIXEL_TSTATE = 14361; // 128K ULA
const CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];

// Bank 5 is at 0x4000, bank 2 at 0x8000; 1/3/5/7 are the contended banks.
const CONTENDED_BANK = [false, true, false, true, false, true, false, true];

const PALETTE = [
  // normal (bright 0)
  [0x00, 0x00, 0x00], [0x00, 0x00, 0xd7], [0xd7, 0x00, 0x00], [0xd7, 0x00, 0xd7],
  [0x00, 0xd7, 0x00], [0x00, 0xd7, 0xd7], [0xd7, 0xd7, 0x00], [0xd7, 0xd7, 0xd7],
  // bright
  [0x00, 0x00, 0x00], [0x00, 0x00, 0xff], [0xff, 0x00, 0x00], [0xff, 0x00, 0xff],
  [0x00, 0xff, 0x00], [0x00, 0xff, 0xff], [0xff, 0xff, 0x00], [0xff, 0xff, 0xff],
];

// ZX Spectrum keyboard matrix: half-row select line -> 5 keys, bit 0 first.
const KEY_MATRIX = {
  0xfe: ["SHIFT", "Z", "X", "C", "V"],
  0xfd: ["A", "S", "D", "F", "G"],
  0xfb: ["Q", "W", "E", "R", "T"],
  0xf7: ["1", "2", "3", "4", "5"],
  0xef: ["0", "9", "8", "7", "6"],
  0xdf: ["P", "O", "I", "U", "Y"],
  0xbf: ["ENTER", "L", "K", "J", "H"],
  0x7f: ["SPACE", "SYMSHIFT", "M", "N", "B"],
};

// Aliases so callers can say "up"/"left" rather than remembering that the
// Sinclair cursor keys are shifted digits.
const KEY_ALIAS = {
  UP: ["SHIFT", "7"], DOWN: ["SHIFT", "6"], LEFT: ["SHIFT", "5"], RIGHT: ["SHIFT", "8"],
  CAPSSHIFT: ["SHIFT"], CS: ["SHIFT"], SS: ["SYMSHIFT"], RET: ["ENTER"], " ": ["SPACE"],
};

function romPath(name) {
  return path.join(__dirname, "roms", name);
}

class Spectrum128 {
  constructor(opts = {}) {
    this.contention = opts.contention !== false;
    this.ram = [];
    for (let i = 0; i < 8; i++) this.ram.push(new Uint8Array(16384));
    this.rom = [
      new Uint8Array(fs.readFileSync(romPath("128-0.rom"))),
      new Uint8Array(fs.readFileSync(romPath("128-1.rom"))),
    ];
    if (opts.rom48) {
      const r48 = new Uint8Array(fs.readFileSync(romPath("48.rom")));
      this.rom = [r48, r48];
    }

    this.tstates = 0;
    this.frames = 0;
    this.borderColour = 7;
    this.keys = new Set();
    this.port7ffd = 0;
    this.pagingLocked = false;
    this.trapped = null; // set when a trap opcode/address is hit

    // Instrumentation
    this.breakpoints = new Map(); // addr -> {count, hits}
    this.watchStack = [];
    this.contentionCycles = 0;
    this.rawCycles = 0;
    this.instructionCount = 0;

    this.applyPaging(0);

    const self = this;
    this.cpu = Z80({
      mem_read: (a) => self.readByte(a),
      mem_write: (a, v) => self.writeByte(a, v),
      io_read: (p) => self.ioRead(p),
      io_write: (p, v) => self.ioWrite(p, v),
    });
    this.cpu.reset();
  }

  // --- memory map -----------------------------------------------------------

  applyPaging(value) {
    this.port7ffd = value;
    this.pagedBank = value & 7;
    this.screenBank = value & 0x08 ? 7 : 5;
    this.romBank = value & 0x10 ? 1 : 0;
    if (value & 0x20) this.pagingLocked = true;
  }

  readByte(addr) {
    addr &= 0xffff;
    const slot = addr >> 14;
    const off = addr & 0x3fff;
    if (slot === 0) return this.rom[this.romBank][off];
    if (slot === 1) { this.contend(5); return this.ram[5][off]; }
    if (slot === 2) return this.ram[2][off];
    const b = this.pagedBank;
    if (CONTENDED_BANK[b]) this.contend(b);
    return this.ram[b][off];
  }

  writeByte(addr, val) {
    addr &= 0xffff;
    val &= 0xff;
    const slot = addr >> 14;
    const off = addr & 0x3fff;
    if (slot === 0) return; // ROM
    if (slot === 1) { this.contend(5); this.ram[5][off] = val; return; }
    if (slot === 2) { this.ram[2][off] = val; return; }
    const b = this.pagedBank;
    if (CONTENDED_BANK[b]) this.contend(b);
    this.ram[b][off] = val;
  }

  // Byte access helpers that bypass contention accounting (for the harness).
  peek(addr) {
    addr &= 0xffff;
    const slot = addr >> 14;
    const off = addr & 0x3fff;
    if (slot === 0) return this.rom[this.romBank][off];
    if (slot === 1) return this.ram[5][off];
    if (slot === 2) return this.ram[2][off];
    return this.ram[this.pagedBank][off];
  }

  poke(addr, val) {
    addr &= 0xffff;
    const slot = addr >> 14;
    const off = addr & 0x3fff;
    if (slot === 0) return;
    if (slot === 1) this.ram[5][off] = val & 0xff;
    else if (slot === 2) this.ram[2][off] = val & 0xff;
    else this.ram[this.pagedBank][off] = val & 0xff;
  }

  peekBank(bank, off) { return this.ram[bank][off & 0x3fff]; }
  pokeBank(bank, off, v) { this.ram[bank][off & 0x3fff] = v & 0xff; }

  contend(_bank) {
    if (!this.contention) return;
    const d = this.contentionDelay(this.tstates);
    if (d) { this.tstates += d; this.contentionCycles += d; }
  }

  contentionDelay(t) {
    let x = t % TSTATES_PER_FRAME;
    x -= FIRST_PIXEL_TSTATE;
    if (x < 0) return 0;
    const line = (x / TSTATES_PER_LINE) | 0;
    if (line >= 192) return 0;
    const col = x % TSTATES_PER_LINE;
    if (col >= 128) return 0;
    return CONTENTION_PATTERN[col & 7];
  }

  // --- I/O ------------------------------------------------------------------

  ioRead(port) {
    port &= 0xffff;
    if ((port & 1) === 0) {
      // ULA: keyboard on the high byte's select lines, active low.
      let result = 0x1f;
      const sel = (port >> 8) & 0xff;
      for (const [line, keys] of Object.entries(KEY_MATRIX)) {
        // A half-row is selected when its address line is driven low.
        if ((sel & (~Number(line) & 0xff)) !== 0) continue;
        for (let bit = 0; bit < 5; bit++) {
          if (this.keys.has(keys[bit])) result &= ~(1 << bit) & 0xff;
        }
      }
      return result | 0xa0; // bits 5/7 float high, bit 6 = EAR (silent)
    }
    if ((port & 0xff) === 0x1f) return 0x00; // Kempston: no joystick
    return 0xff;
  }

  ioWrite(port, val) {
    port &= 0xffff;
    if ((port & 1) === 0) {
      this.borderColour = val & 7;
      return;
    }
    // 0x7FFD is decoded on A15=0, A1=0 on real hardware.
    if ((port & 0x8002) === 0) {
      if (!this.pagingLocked) this.applyPaging(val & 0xff);
      return;
    }
  }

  // --- keyboard -------------------------------------------------------------

  normaliseKey(k) {
    const up = String(k).toUpperCase();
    if (KEY_ALIAS[up]) return KEY_ALIAS[up];
    return [up];
  }

  keyDown(k) { for (const p of this.normaliseKey(k)) this.keys.add(p); }
  keyUp(k) { for (const p of this.normaliseKey(k)) this.keys.delete(p); }
  clearKeys() { this.keys.clear(); }

  // --- execution ------------------------------------------------------------

  setBreakpoint(addr) {
    this.breakpoints.set(addr & 0xffff, { hits: 0 });
  }
  clearBreakpoint(addr) { this.breakpoints.delete(addr & 0xffff); }
  clearBreakpoints() { this.breakpoints.clear(); }

  get regs() {
    const s = this.cpu.getState();
    return s;
  }

  step() {
    const before = this.tstates;
    const c = this.cpu.run_instruction();
    this.rawCycles += c;
    this.tstates += c;
    this.instructionCount++;
    return this.tstates - before;
  }

  // Run for a number of T-states, firing interrupts at frame boundaries.
  // Returns {reason, tstates}. reason is "cycles" | "breakpoint" | "halt-trap".
  run(tstateBudget, opts = {}) {
    const target = this.tstates + tstateBudget;
    const maxInsns = opts.maxInstructions || Infinity;
    let executed = 0;
    while (this.tstates < target) {
      const st = this.cpu.getState();
      const bp = this.breakpoints.get(st.pc);
      if (bp && executed > 0) {
        bp.hits++;
        return { reason: "breakpoint", pc: st.pc, tstates: this.tstates };
      }
      this.maybeInterrupt();
      this.step();
      executed++;
      if (executed >= maxInsns) return { reason: "instructions", tstates: this.tstates };
    }
    return { reason: "cycles", tstates: this.tstates };
  }

  // Run until PC hits one of `addrs` (or budget exhausted).
  runUntil(addrs, tstateBudget = TSTATES_PER_FRAME * 200) {
    const want = new Set((Array.isArray(addrs) ? addrs : [addrs]).map((a) => a & 0xffff));
    const target = this.tstates + tstateBudget;
    while (this.tstates < target) {
      this.maybeInterrupt();
      this.step();
      const pc = this.cpu.getState().pc;
      if (want.has(pc)) return { reason: "hit", pc, tstates: this.tstates };
    }
    return { reason: "timeout", tstates: this.tstates };
  }

  maybeInterrupt() {
    const frame = (this.tstates / TSTATES_PER_FRAME) | 0;
    if (frame !== this.frames) {
      this.frames = frame;
      // The INT line is held low for 32 T-states at the start of the frame.
      this.cpu.interrupt(false, 0xff);
    }
  }

  runFrames(n) {
    const budget = n * TSTATES_PER_FRAME;
    return this.run(budget);
  }

  // --- screen ---------------------------------------------------------------

  static screenAddress(x, y) {
    // x in 0..255 (pixel), y in 0..191
    return ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | (x >> 3);
  }

  // Render the currently displayed screen (bank 5 or 7) to RGBA.
  // `border` adds a border ring of the given width in pixels.
  renderRGBA(opts = {}) {
    const bank = opts.bank !== undefined ? opts.bank : this.screenBank;
    const border = opts.border || 0;
    const flash = opts.flash || false;
    const W = 256 + border * 2;
    const H = 192 + border * 2;
    const out = new Uint8Array(W * H * 4);
    const mem = this.ram[bank];
    const bc = PALETTE[this.borderColour];

    if (border) {
      for (let i = 0; i < W * H; i++) {
        out[i * 4] = bc[0]; out[i * 4 + 1] = bc[1]; out[i * 4 + 2] = bc[2]; out[i * 4 + 3] = 255;
      }
    }

    for (let y = 0; y < 192; y++) {
      const rowBase = ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
      const attrRow = 0x1800 + (y >> 3) * 32;
      for (let cx = 0; cx < 32; cx++) {
        const bits = mem[rowBase + cx];
        const attr = mem[attrRow + cx];
        let ink = attr & 7, paper = (attr >> 3) & 7;
        const bright = (attr & 0x40) ? 8 : 0;
        if (flash && (attr & 0x80)) { const t = ink; ink = paper; paper = t; }
        const cInk = PALETTE[ink + bright];
        const cPaper = PALETTE[paper + bright];
        for (let b = 0; b < 8; b++) {
          const px = cx * 8 + b;
          const on = (bits >> (7 - b)) & 1;
          const c = on ? cInk : cPaper;
          const o = ((y + border) * W + (px + border)) * 4;
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
        }
      }
    }
    return { data: out, width: W, height: H };
  }

  // Monochrome ASCII dump of the bitmap - handy for quick shape checks in logs.
  renderASCII(opts = {}) {
    const bank = opts.bank !== undefined ? opts.bank : this.screenBank;
    const mem = this.ram[bank];
    const x0 = opts.x0 || 0, x1 = opts.x1 !== undefined ? opts.x1 : 256;
    const y0 = opts.y0 || 0, y1 = opts.y1 !== undefined ? opts.y1 : 192;
    const sx = opts.scaleX || 2, sy = opts.scaleY || 4;
    const lines = [];
    for (let y = y0; y < y1; y += sy) {
      let line = "";
      for (let x = x0; x < x1; x += sx) {
        let any = 0;
        for (let dy = 0; dy < sy && y + dy < y1; dy++) {
          const rowBase = (((y + dy) & 0xc0) << 5) | (((y + dy) & 0x07) << 8) | (((y + dy) & 0x38) << 2);
          for (let dx = 0; dx < sx && x + dx < x1; dx++) {
            const px = x + dx;
            if ((mem[rowBase + (px >> 3)] >> (7 - (px & 7))) & 1) { any = 1; break; }
          }
          if (any) break;
        }
        line += any ? "#" : ".";
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  savePNG(file, opts = {}) {
    const { data, width, height } = this.renderRGBA(opts);
    const scale = opts.scale || 1;
    let px = data, W = width, H = height;
    if (scale > 1) {
      W = width * scale; H = height * scale;
      px = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) {
        const sy = (y / scale) | 0;
        for (let x = 0; x < W; x++) {
          const sx = (x / scale) | 0;
          const so = (sy * width + sx) * 4, dofs = (y * W + x) * 4;
          px[dofs] = data[so]; px[dofs + 1] = data[so + 1];
          px[dofs + 2] = data[so + 2]; px[dofs + 3] = data[so + 3];
        }
      }
    }
    fs.writeFileSync(file, encodePNG(px, W, H));
    return { file, width: W, height: H };
  }

  // --- image loading --------------------------------------------------------

  // Load a build manifest: {start, sp, port7ffd, blocks:[{bank,addr,file}|{addr,file}]}
  loadManifest(manifestFile) {
    const dir = path.dirname(manifestFile);
    const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    for (const b of m.blocks) {
      const data = new Uint8Array(fs.readFileSync(path.resolve(dir, b.file)));
      if (b.bank !== undefined) {
        const off = (b.addr !== undefined ? b.addr : 0) & 0x3fff;
        this.ram[b.bank].set(data, off);
      } else {
        // Address-space load through the current paging configuration.
        for (let i = 0; i < data.length; i++) this.poke(b.addr + i, data[i]);
      }
    }
    if (m.port7ffd !== undefined) this.applyPaging(m.port7ffd);
    const st = this.cpu.getState();
    st.pc = m.start !== undefined ? m.start : 0x8000;
    st.sp = m.sp !== undefined ? m.sp : 0xbfff;
    st.i = m.i !== undefined ? m.i : 0x3f;
    st.imode = m.imode !== undefined ? m.imode : 1;
    st.iff1 = 0; st.iff2 = 0;
    this.cpu.setState(st);
    this.manifest = m;
    return m;
  }
}

// --- minimal PNG encoder ----------------------------------------------------

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { Spectrum128, TSTATES_PER_FRAME, encodePNG };
