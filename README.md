# Rainsi

Multi-version Lua, compiled to WASI, for the browser and Node.

Rainsi packages the full PUC-Rio Lua interpreter (5.1 through 5.5) as WebAssembly modules targeting **WASI**. A small TypeScript host loads the right binary, provides a browser-friendly WASI layer, and gives you a simple JS/TS API.

This is not a Lua-to-WASM compiler. It is stock Lua, running inside WASI-WASM.

## Features

- Lua **5.1.5**, **5.2.4**, **5.3.6**, **5.4.7**, **5.5.1**
- Full interpreter: tables, coroutines, metatables, standard libraries
- WASI compatibility layer for browser and Node (stdio, args, env, in-memory VFS)
- JS â†” Lua value marshalling (primitives, tables, arrays, functions)
- Register JavaScript functions and call them from Lua
- Call Lua functions from JavaScript
- Captured stdout / stderr
- Virtual filesystem (`writeFile` / `readFile` / `listFiles`) so `require` works without a real disk
- Zero runtime dependencies

## Install

```bash
npm install rainsi-lua
```

## Quick start

```ts
import { LuaEngine } from 'rainsi-lua';

const lua = await LuaEngine.create({ version: '5.4.7' });

lua.register('log', (msg) => console.log('[lua]', msg));

const result = lua.run(`
  log("running on " .. _VERSION)
  return 21 * 2, { ok = true }
`);

if (result.ok) {
  console.log(result.values); // [42, { ok: true }]
} else {
  console.error(result.error);
}

lua.close();
```

## Selecting a Lua version

```ts
const lua = await LuaEngine.create({
  version: '5.1.5', // '5.1.5' | '5.2.4' | '5.3.6' | '5.4.7' | '5.5.1'
});
```

Default is **5.4.7**.

Each version is a normal PUC-Rio release. Language and library differences between versions are the usual ones:

| Feature | 5.1 | 5.2 | 5.3+ | 5.4+ |
| --- | --- | --- | --- | --- |
| `loadstring` / `module()` | yes | â€” | â€” | â€” |
| `bit32` | â€” | yes | â€” | â€” |
| `//`, `<<`, `utf8` | â€” | â€” | yes | yes |
| to-be-closed vars | â€” | â€” | â€” | yes |

Pick the version that matches the code you want to run.

## API

### `LuaEngine.create(options)`

```ts
const lua = await LuaEngine.create({
  version: '5.4.7',
  wasmBase: '/wasm',           // optional: base path/CDN for .wasm files
  wasmSource: bytes,           // optional: Uint8Array / ArrayBuffer override
  args: ['script'],            // becomes Lua's `arg` table
  onStdout: (text) => {},
  onStderr: (text) => {},
  globals: { answer: 42 },     // set before first run
});
```

### `lua.run(code)`

Compile and run a chunk. Does not throw on Lua errors.

```ts
const result = lua.run(`return 1 + 2, "ok"`);
// Success: { ok: true,  values: [3, "ok"] }
// Failure: { ok: false, error: "..." }
```

### `lua.doString(code)`

Same as `run`, but throws on error and returns the value(s) directly (single value, or array if multiple).

### `lua.runWithMetrics(code)`

```ts
const { value, stdout, stderr, executionTimeMs, error } = lua.runWithMetrics(`
  print("hello")
  return 42
`);
```

### Globals and functions

```ts
lua.set('config', { debug: true, limit: 100 });
const config = lua.get('config');

lua.register('add', (a, b) => a + b);
lua.run(`return add(5, 7)`); // values: [12]

lua.call('add', 5, 7);       // call a Lua global from JS
```

### Virtual filesystem

```ts
lua.writeFile('mymod.lua', `
  return {
    ping = function() return "pong" end
  }
`);

lua.run(`return require("mymod").ping()`); // values: ["pong"]

lua.readFile('mymod.lua');
lua.listFiles();
```

Files live in memory only. They are not written to the host filesystem.

### Cleanup

```ts
lua.close();
```

## WASM loading

By default the package loads `wasm/lua-<version>.wasm` next to the built JS.

In browsers and some bundlers that path may not resolve. Use one of:

```ts
// Serve the files yourself and point at them
await LuaEngine.create({
  version: '5.4.7',
  wasmBase: 'https://cdn.example.com/rainsi-wasm',
});

// Or pass the bytes directly
await LuaEngine.create({
  version: '5.4.7',
  wasmSource: await fetch('/lua-5.4.7.wasm').then(r => r.arrayBuffer()),
});
```

The five binaries ship inside the npm package under `wasm/`.

## Architecture

```text
JavaScript / TypeScript
        |
        v
   LuaEngine
        |
        |-- WASM binary patcher (growable table, exception tags)
        |-- WASI polyfill (stdio, args, env, VFS)
        |-- JS <-> Lua trampoline
        v
   Lua WebAssembly binary (WASI)
```

- `lua-engine.ts` â€” public API, marshalling, pcall
- `wasi-polyfill.ts` â€” WASI snapshot preview1 surface for the browser/Node
- `wasm-patcher.ts` â€” makes the funcref table growable; ensures exception tags are exported
- `trampoline.ts` â€” small WASM stub so JS functions can be pushed as Lua C functions
- `wasm/` â€” prebuilt `lua-5.1.5.wasm` â€¦ `lua-5.5.1.wasm`

## Browser use

No server and no native Lua install are required. The Lua VM runs entirely inside the WASM module. You only need the `.wasm` files reachable by the page (see [WASM loading](#wasm-loading) above).

## Status

Experimental. The API may still change between releases.

## License

MIT

## Links

- npm: [`rainsi-lua`](https://www.npmjs.com/package/rainsi-lua)
- Source: [github.com/lalipa2003-arch/rainsi](https://github.com/lalipa2003-arch/rainsi)
