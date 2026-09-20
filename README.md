Rainsi

Rainsi is a TypeScript runtime for executing Lua in WebAssembly in browser and JavaScript environments.

It packages precompiled Lua runtimes for Lua 5.1, 5.2, 5.3, 5.4, and 5.5 and provides a JavaScript/TypeScript API around them.

Features

Lua 5.1.5, 5.2.4, 5.3.6, 5.4.7, and 5.5.1

WebAssembly-based execution

Browser-friendly WASI compatibility layer

Execute Lua source from JavaScript/TypeScript

Read and set Lua globals

Register JavaScript functions for Lua code to call

JavaScript ↔ Lua value conversion

Captured stdout and stderr

In-memory virtual file support

Custom WASM sources and configurable WASM base paths

No server or native Lua installation required for browser use

Installation

npm install rainsi-lua

Quick start

import { LuaEngine } from 'rainsi-lua';

const lua = await LuaEngine.create({
version: '5.4.7',
});

const result = await lua.run(local x = 20 return x * 2);

console.log(result.value); // 40
lua.close();

Selecting a Lua version

const lua = await LuaEngine.create({
version: '5.1.5',
});

Supported versions:

5.1.5

5.2.4

5.3.6

5.4.7

5.5.1

The default version is 5.4.7.

JavaScript globals

Values can be supplied when creating an engine:

const lua = await LuaEngine.create({
version: '5.4.7',
globals: {
answer: 42,
name: 'Rainsi',
},
});

const result = await lua.run(return name .. ': ' .. answer);

console.log(result.value);

Globals can also be changed after creation:

lua.set('counter', 10);
console.log(lua.get('counter'));

Calling JavaScript from Lua

JavaScript functions can be registered as Lua globals:

lua.register('add', (a, b) => a + b);

const result = await lua.run(return add(5, 7));

console.log(result.value); // 12

Output

Lua output can be collected from the execution result:

const result = await lua.run(print('hello from Lua'));

console.log(result.stdout);
console.log(result.stderr);

Callbacks can also be supplied when creating the engine:

const lua = await LuaEngine.create({
version: '5.4.7',
onStdout: text => console.log('[Lua]', text),
onStderr: text => console.error('[Lua]', text),
});

Virtual files

Rainsi includes an in-memory virtual filesystem exposed through the runtime:

lua.writeFile('hello.txt', 'Hello from Rainsi');

const data = lua.readFile('hello.txt');
console.log(data);

console.log(lua.listFiles());

This filesystem is held in memory and is not the user's real filesystem.

WASM loading

Rainsi can load its bundled WASM files automatically, or a caller can provide a custom source.

const lua = await LuaEngine.create({
version: '5.4.7',
wasmSource: someUint8Array,
});

A custom base path can also be supplied:

const lua = await LuaEngine.create({
version: '5.4.7',
wasmBase: '/wasm',
});

Architecture

Rainsi is split into a few main pieces:

JavaScript / TypeScript
│
▼
LuaEngine
│
├── WASM patcher
├── WASI compatibility layer
├── JS ↔ Lua trampoline
│
▼
Lua WebAssembly binary

lua-engine.ts

The main public runtime. It loads a Lua WASM binary, creates the WASM instance, initializes Lua, handles values and function registration, and exposes the high-level API.

wasi-polyfill.ts

A browser-oriented implementation of the WASI functions expected by the Lua WASM builds. It handles things such as standard I/O, arguments, environment values, virtual files, and other runtime compatibility behavior.

wasm-patcher.ts

Applies the runtime's required modifications to the WASM binary before instantiation.

trampoline.ts

Provides the bridge used when Lua needs to call JavaScript functions registered through the engine.

wasm/

Contains the precompiled Lua WebAssembly binaries for each supported Lua release.

Browser use

Rainsi is designed to run without a backend. The Lua code executes inside WebAssembly in the JavaScript environment hosting Rainsi.

A web application still needs to make the .wasm files available to the browser if the default package-relative loading path does not match its bundler or deployment setup. wasmBase and wasmSource can be used for custom loading setups.

Building from source

Clone the repository and install the development dependencies:

git clone https://github.com/lalipa2003-arch/rainsi.git
cd rainsi
npm install
npm run build

The TypeScript build outputs the compiled package into dist/.

Project status

Rainsi is an experimental project. The API and implementation may change between releases.

The bundled Lua binaries are compiled WebAssembly builds of the corresponding Lua versions; Rainsi provides the JavaScript runtime layer around those binaries.

License

MIT

Repository

https://github.com/lalipa2003-arch/rainsi
