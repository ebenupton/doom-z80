#!/usr/bin/env node
// MCP server exposing the headless ZX Spectrum 128K to a model.
//
// Speaks JSON-RPC 2.0 over stdio (Content-Length framed, per MCP). It keeps a
// single live machine so a session can boot the engine, press keys, step
// frames and look at the screen without rebuilding anything in between.

const fs = require("fs");
const path = require("path");
const { Spectrum128, TSTATES_PER_FRAME } = require("./spectrum.js");
const { assemble, readSymbols } = require("./zbuild.js");

const ROOT = path.resolve(__dirname, "..");

let machine = null;
let symbols = new Map();

function freshMachine(opts) {
  machine = new Spectrum128(opts);
  return machine;
}

function need() {
  if (!machine) throw new Error("no machine: call spectrum_boot first");
  return machine;
}

// --- tool implementations ---------------------------------------------------

const TOOLS = {
  spectrum_boot: {
    description:
      "Build the DOOM engine (or load a raw image) into a fresh 128K Spectrum " +
      "and set the program counter to its entry point. Returns the entry address.",
    inputSchema: {
      type: "object",
      properties: {
        rebuild: { type: "boolean", description: "Re-run the assembler first (default true)" },
        contention: { type: "boolean", description: "Model ULA contention (default true)" },
      },
    },
    run(args) {
      if (args.rebuild !== false) {
        const r = assemble(path.join(ROOT, "src/main.z80"), path.join(ROOT, "build/doom.bin"));
        if (!r.ok) throw new Error("assembly failed:\n" + r.out);
        symbols = readSymbols(r.sym);
      } else {
        symbols = readSymbols(path.join(ROOT, "build/doom.sym"));
      }
      const m = freshMachine({ contention: args.contention !== false });
      m.ram[0].set(fs.readFileSync(path.join(ROOT, "build/bank0.bin")), 0);
      m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/nodebb.bin")), 0x6580 - 0x4000);
      m.ram[5].set(fs.readFileSync(path.join(ROOT, "build/l8.bin")), 0x6200 - 0x4000);
      m.ram[2].set(fs.readFileSync(path.join(ROOT, "build/doom.bin")), 0x8400 - 0x8000);
      const st = m.cpu.getState();
      st.pc = symbols.get("START");
      st.sp = 0xbff0;
      st.imode = 1; st.iff1 = 0; st.iff2 = 0;
      m.cpu.setState(st);
      return `booted; PC = $${st.pc.toString(16)}, ${symbols.size} symbols`;
    },
  },

  spectrum_boot_rom: {
    description: "Start a stock 128K Spectrum at its ROM boot menu (no engine loaded).",
    inputSchema: { type: "object", properties: {} },
    run() {
      freshMachine({});
      machine.cpu.reset();
      return "booted 128K ROM";
    },
  },

  spectrum_run_frames: {
    description:
      "Run the machine for N PAL fields (50 per second), firing the frame " +
      "interrupt at each boundary. Returns elapsed T-states and the PC.",
    inputSchema: {
      type: "object",
      properties: { frames: { type: "number", description: "PAL fields to run (default 1)" } },
    },
    run(args) {
      const m = need();
      const n = args.frames || 1;
      const t0 = m.tstates;
      m.run(n * TSTATES_PER_FRAME);
      const s = m.cpu.getState();
      return `ran ${n} fields, ${m.tstates - t0} T-states, PC = $${s.pc.toString(16)}`;
    },
  },

  spectrum_run_renders: {
    description:
      "Run until the engine has started N new frames (breakpoint on render_frame). " +
      "Reports the measured cost of each rendered frame - the real frame rate.",
    inputSchema: {
      type: "object",
      properties: { count: { type: "number", description: "Rendered frames to wait for (default 1)" } },
    },
    run(args) {
      const m = need();
      const target = symbols.get("render_frame");
      if (target === undefined) throw new Error("render_frame symbol not available");
      const want = args.count || 1;
      let seen = 0, prev = 0, last = m.tstates;
      const times = [];
      const limit = m.tstates + TSTATES_PER_FRAME * 4000;
      while (seen < want && m.tstates < limit) {
        m.maybeInterrupt();
        m.step();
        const pc = m.cpu.getState().pc;
        if (pc === target && prev !== target) {
          if (seen > 0 || times.length) times.push(m.tstates - last);
          last = m.tstates;
          seen++;
        }
        prev = pc;
      }
      const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
      return `rendered ${seen} frames` +
        (avg ? `; ${(avg / 1000).toFixed(0)}k T-states each = ${(3546900 / avg).toFixed(2)} fps` : "");
    },
  },

  spectrum_key: {
    description:
      "Hold or release a key. Names are Spectrum keys (Q, A, O, P, Z, X, SPACE, ENTER) " +
      "or the aliases UP/DOWN/LEFT/RIGHT for the shifted cursor keys.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        down: { type: "boolean", description: "true to press, false to release (default true)" },
      },
      required: ["key"],
    },
    run(args) {
      const m = need();
      if (args.down === false) m.keyUp(args.key); else m.keyDown(args.key);
      return `${args.key} ${args.down === false ? "released" : "pressed"}`;
    },
  },

  spectrum_screenshot: {
    description:
      "Capture the displayed screen as a PNG. Returns the image itself, so the " +
      "rendered frame can be looked at directly.",
    inputSchema: {
      type: "object",
      properties: {
        scale: { type: "number", description: "Integer pixel scale (default 2)" },
        border: { type: "number", description: "Border width in pixels (default 16)" },
        path: { type: "string", description: "Also write the PNG here" },
      },
    },
    run(args) {
      const m = need();
      const opts = { scale: args.scale || 2, border: args.border === undefined ? 16 : args.border };
      const file = args.path || path.join(ROOT, "build/screenshot.png");
      m.savePNG(file, opts);
      return { image: fs.readFileSync(file).toString("base64"), text: `screen -> ${file}` };
    },
  },

  spectrum_ascii: {
    description: "Dump the displayed bitmap as ASCII art - cheap to read when the shape is all that matters.",
    inputSchema: {
      type: "object",
      properties: {
        scaleX: { type: "number", description: "Pixels per character across (default 4)" },
        scaleY: { type: "number", description: "Pixels per character down (default 8)" },
      },
    },
    run(args) {
      const m = need();
      return m.renderASCII({ scaleX: args.scaleX || 4, scaleY: args.scaleY || 8 });
    },
  },

  spectrum_peek: {
    description: "Read bytes through the current paging, or from a specific RAM bank.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "number" },
        length: { type: "number", description: "Bytes to read (default 16)" },
        bank: { type: "number", description: "Read this RAM bank directly; address is then 0..16383" },
      },
      required: ["address"],
    },
    run(args) {
      const m = need();
      const n = args.length || 16;
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push((args.bank === undefined ? m.peek(args.address + i)
                                          : m.peekBank(args.bank, args.address + i))
          .toString(16).padStart(2, "0"));
      }
      return `${args.address.toString(16)}: ${out.join(" ")}`;
    },
  },

  spectrum_poke: {
    description: "Write bytes through the current paging, or into a specific RAM bank.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "number" },
        bytes: { type: "array", items: { type: "number" } },
        bank: { type: "number" },
      },
      required: ["address", "bytes"],
    },
    run(args) {
      const m = need();
      args.bytes.forEach((b, i) => {
        if (args.bank === undefined) m.poke(args.address + i, b);
        else m.pokeBank(args.bank, args.address + i, b);
      });
      return `wrote ${args.bytes.length} bytes at ${args.address.toString(16)}`;
    },
  },

  spectrum_registers: {
    description: "Report the CPU registers, paging state and cycle counters.",
    inputSchema: { type: "object", properties: {} },
    run() {
      const m = need();
      const s = m.cpu.getState();
      const h = (v, n = 4) => "$" + (v >>> 0).toString(16).padStart(n, "0");
      return [
        `PC ${h(s.pc)}  SP ${h(s.sp)}  AF ${h((s.a << 8))}  BC ${h((s.b << 8) | s.c)}`,
        `DE ${h((s.d << 8) | s.e)}  HL ${h((s.h << 8) | s.l)}  IX ${h(s.ix)}  IY ${h(s.iy)}`,
        `I ${h(s.i, 2)}  IM ${s.imode}  IFF1 ${s.iff1}  halted ${s.halted}`,
        `$7FFD ${h(m.port7ffd, 2)}  bank@C000 ${m.pagedBank}  screen bank ${m.screenBank}`,
        `T-states ${m.tstates}  (${(m.tstates / TSTATES_PER_FRAME).toFixed(1)} fields)  contention ${m.contentionCycles}`,
      ].join("\n");
    },
  },

  spectrum_symbol: {
    description: "Look up an assembler symbol's address, or list symbols matching a prefix.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, prefix: { type: "string" } },
    },
    run(args) {
      if (args.name) {
        const v = symbols.get(args.name);
        if (v === undefined) throw new Error("no such symbol: " + args.name);
        return `${args.name} = $${v.toString(16)}`;
      }
      const p = args.prefix || "";
      const hits = [...symbols.entries()].filter(([k]) => k.startsWith(p))
        .sort((a, b) => a[1] - b[1])
        .map(([k, v]) => `${k} = $${v.toString(16)}`);
      return hits.length ? hits.join("\n") : "no matches";
    },
  },

  spectrum_call: {
    description:
      "Call one routine by name with chosen register values and report the result. " +
      "Returns when it executes its RET.",
    inputSchema: {
      type: "object",
      properties: {
        routine: { type: "string" },
        hl: { type: "number" }, de: { type: "number" }, bc: { type: "number" },
        a: { type: "number" },
      },
      required: ["routine"],
    },
    run(args) {
      const m = need();
      const addr = symbols.get(args.routine);
      if (addr === undefined) throw new Error("no such routine: " + args.routine);
      const SENT = 0xbff8;
      m.poke(SENT, 0x76);
      const st = m.cpu.getState();
      st.pc = addr; st.sp = 0xbfee; st.halted = false;
      if (args.a !== undefined) st.a = args.a & 0xff;
      if (args.hl !== undefined) { st.h = (args.hl >> 8) & 0xff; st.l = args.hl & 0xff; }
      if (args.de !== undefined) { st.d = (args.de >> 8) & 0xff; st.e = args.de & 0xff; }
      if (args.bc !== undefined) { st.b = (args.bc >> 8) & 0xff; st.c = args.bc & 0xff; }
      m.cpu.setState(st);
      m.poke(0xbfee, SENT & 0xff); m.poke(0xbfef, SENT >> 8);
      const t0 = m.tstates;
      while (m.tstates - t0 < 8000000) {
        m.step();
        const s = m.cpu.getState();
        if (s.halted) {
          s.halted = false; m.cpu.setState(s);
          const h = (v) => "$" + (v >>> 0).toString(16).padStart(4, "0");
          return `${args.routine} returned in ${m.tstates - t0} T-states; ` +
            `A=${s.a} HL=${h((s.h << 8) | s.l)} DE=${h((s.d << 8) | s.e)} ` +
            `BC=${h((s.b << 8) | s.c)} CF=${s.flags.C} ZF=${s.flags.Z}`;
        }
      }
      throw new Error(`${args.routine} did not return`);
    },
  },
};

// --- JSON-RPC plumbing ------------------------------------------------------

function toolList() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name, description: t.description, inputSchema: t.inputSchema,
  }));
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "spectrum", version: "1.0.0" },
    };
  }
  if (method === "tools/list") return { tools: toolList() };
  if (method === "tools/call") {
    const t = TOOLS[params.name];
    if (!t) throw new Error("unknown tool: " + params.name);
    const out = t.run(params.arguments || {});
    if (out && out.image) {
      return {
        content: [
          { type: "image", data: out.image, mimeType: "image/png" },
          { type: "text", text: out.text },
        ],
      };
    }
    return { content: [{ type: "text", text: String(out) }] };
  }
  if (method === "ping") return {};
  throw new Error("unknown method: " + method);
}

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep < 0) return;
    const head = buf.subarray(0, sep).toString("ascii");
    const m = /Content-Length:\s*(\d+)/i.exec(head);
    if (!m) { buf = buf.subarray(sep + 4); continue; }
    const len = Number(m[1]);
    if (buf.length < sep + 4 + len) return;
    const body = buf.subarray(sep + 4, sep + 4 + len).toString("utf8");
    buf = buf.subarray(sep + 4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    if (msg.id === undefined) continue;               // notification
    let resp;
    try { resp = { jsonrpc: "2.0", id: msg.id, result: handle(msg) }; }
    catch (e) { resp = { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: e.message } }; }
    const out = Buffer.from(JSON.stringify(resp), "utf8");
    process.stdout.write(`Content-Length: ${out.length}\r\n\r\n`);
    process.stdout.write(out);
  }
});
