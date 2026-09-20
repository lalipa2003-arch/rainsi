import { WASIPolyfill } from './wasi-polyfill.js';
import { patchWasmBinary } from './wasm-patcher.js';
import { createWasmCallback } from './trampoline.js';
import {
  LuaVersion,
  LuaEngineOptions,
  LuaJSValue,
  ExecutionResult,
} from './types.js';

export class LuaEngine {
  public readonly version: LuaVersion;
  private instance: WebAssembly.Instance;
  private memory: WebAssembly.Memory;
  private exports: any;
  private wasi: WASIPolyfill;
  private L: number = 0;
  private isClosed: boolean = false;
  private nextRefId: number = 1;
  private refsFinalizer?: FinalizationRegistry<number>;

  
  private scratchPtr: number = 0;

  private constructor(
    version: LuaVersion,
    instance: WebAssembly.Instance,
    wasi: WASIPolyfill
  ) {
    this.version = version;
    this.instance = instance;
    this.exports = instance.exports;
    this.memory = this.exports.memory;
    this.wasi = wasi;

    if (typeof FinalizationRegistry !== 'undefined') {
      this.refsFinalizer = new FinalizationRegistry<number>((refId) => {
        if (!this.isClosed && this.L) {
          try {
            this.releaseRef(refId);
          } catch {
            
          }
        }
      });
    }
  }

  public static async create(options: LuaEngineOptions = {}): Promise<LuaEngine> {
    const version = options.version || '5.4.7';

    
    let wasmBytes!: Uint8Array;
    if (options.wasmSource instanceof Uint8Array) {
      wasmBytes = options.wasmSource;
    } else if (options.wasmSource instanceof ArrayBuffer) {
      wasmBytes = new Uint8Array(options.wasmSource);
    } else if (options.wasmSource instanceof Response) {
      const buf = await options.wasmSource.arrayBuffer();
      wasmBytes = new Uint8Array(buf);
    } else if (typeof options.wasmSource === 'string') {
      let isFileUrl = false;
      try {
        const parsed = new URL(options.wasmSource, import.meta.url);
        if (parsed.protocol === 'file:') {
          const { readFile } = await import('fs/promises');
          const { fileURLToPath } = await import('url');
          wasmBytes = await readFile(fileURLToPath(parsed));
          isFileUrl = true;
        }
      } catch {}

      if (!isFileUrl) {
        const resp = await fetch(options.wasmSource);
        if (!resp.ok) throw new Error(`Failed to fetch WASM from ${options.wasmSource}: ${resp.statusText}`);
        wasmBytes = new Uint8Array(await resp.arrayBuffer());
      }
    } else {
      let url: URL;
      if (options.wasmBase) {
        url = new URL(`${options.wasmBase}/lua-${version}.wasm`, import.meta.url);
      } else {
        try {
          url = new URL(`../wasm/lua-${version}.wasm`, import.meta.url);
        } catch {
          url = new URL(`/lua-${version}.wasm`, 'http://localhost');
        }
      }

      if (url.protocol === 'file:') {
        try {
          const { readFile } = await import('fs/promises');
          const { fileURLToPath } = await import('url');
          wasmBytes = await readFile(fileURLToPath(url));
        } catch (err: any) {
          throw new Error(`Failed to load Lua ${version} binary from local file path ${url.pathname}: ${err.message}`);
        }
      } else {
        const resp = await fetch(url.href);
        if (!resp.ok) {
          throw new Error(
            `Failed to load Lua ${version} binary from default path ${url.href} (HTTP ${resp.status}). ` +
            `Please ensure that the precompiled 'lua-${version}.wasm' file is placed in your project's public/ directory or served at this root URL. ` +
            `Alternatively, configure a custom 'wasmSource' or 'wasmBase' in LuaEngine.create() options.`
          );
        }
        wasmBytes = new Uint8Array(await resp.arrayBuffer());
      }
    }

    
    wasmBytes = patchWasmBinary(wasmBytes);

    
    const wasi = new WASIPolyfill({
      args: options.args || ['lua'],
      onStdout: options.onStdout,
      onStderr: options.onStderr,
      lineBuffered: options.lineBuffered,
    });

    const imports = wasi.getImports();

    
    const wasmModule = await WebAssembly.compile(wasmBytes as any);
    const instance = await WebAssembly.instantiate(wasmModule, {
      wasi_snapshot_preview1: imports.wasi_snapshot_preview1,
      env: imports.env,
    });

    
    const memory = instance.exports.memory as WebAssembly.Memory;
    wasi.setMemoryGetter(() => memory);
    wasi.setInstanceExports(instance.exports);

    const cppTag = (instance.exports.__cpp_exception || instance.exports.__c_longjmp) as WebAssembly.Tag || null;
    wasi.setCppTag(cppTag);

    
    const engine = new LuaEngine(version, instance, wasi);
    engine.initLuaState();

    
    if (options.globals) {
      for (const [key, val] of Object.entries(options.globals)) {
        engine.setGlobal(key, val);
      }
    }

    return engine;
  }

  private initLuaState(): void {
    const exp = this.exports;

    
    this.L = exp.luaL_newstate();
    if (!this.L) {
      throw new Error(`Failed to allocate Lua state for Lua ${this.version}`);
    }

    
    if (exp.luaL_openlibs) {
      exp.luaL_openlibs(this.L);
    } else if (exp.luaL_openselectedlibs) {
      exp.luaL_openselectedlibs(this.L, ~0, 0);
    }

    
    if (exp.malloc) {
      this.scratchPtr = exp.malloc(2048);
      this.wasi.setScratchArgPtr(this.scratchPtr);
    }

    
    exp.lua_createtable(this.L, 0, 0);
    this.withString('__luabros_refs', (keyPtr) => {
      if (exp.lua_setglobal) {
        exp.lua_setglobal(this.L, keyPtr);
      } else {
        exp.lua_setfield(this.L, -10002, keyPtr);
      }
    });

    
    const wasiArgs = this.wasi.getArgs();
    exp.lua_createtable(this.L, wasiArgs.length, 0);
    const scriptIdx = wasiArgs.length > 1 ? 1 : 0;
    for (let i = 0; i < wasiArgs.length; i++) {
      this.pushJSValue(wasiArgs[i]);
      this.rawSetI(-2, i - scriptIdx);
    }
    this.withString('arg', (keyPtr) => {
      if (exp.lua_setglobal) {
        exp.lua_setglobal(this.L, keyPtr);
      } else {
        exp.lua_setfield(this.L, -10002, keyPtr);
      }
    });

    exp.lua_settop(this.L, 0);
  }

  

  private withString<T>(str: string, cb: (ptr: number, len: number) => T): T {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(str);
    const ptr = this.exports.malloc(encoded.length + 1);
    try {
      const bytes = new Uint8Array(this.memory.buffer);
      bytes.set(encoded, ptr);
      bytes[ptr + encoded.length] = 0; 
      return cb(ptr, encoded.length);
    } finally {
      this.exports.free(ptr);
    }
  }

  private readString(ptr: number, maxLen?: number): string {
    if (!ptr) return '';
    const bytes = new Uint8Array(this.memory.buffer);
    let len = 0;
    if (typeof maxLen === 'number' && maxLen >= 0) {
      len = maxLen;
    } else {
      while (bytes[ptr + len] !== 0) {
        len++;
      }
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(ptr, ptr + len));
  }

  private luaPop(n: number = 1): void {
    this.exports.lua_settop(this.L, -n - 1);
  }

  private luaRemove(idx: number): void {
    const exp = this.exports;
    if (exp.lua_remove) {
      exp.lua_remove(this.L, idx);
    } else if (exp.lua_rotate) {
      exp.lua_rotate(this.L, idx, -1);
      this.luaPop(1);
    }
  }

  private rawSetI(tableIdx: number, n: number): void {
    const exp = this.exports;
    if (this.version.startsWith('5.1') || this.version.startsWith('5.2')) {
      exp.lua_rawseti(this.L, tableIdx, n);
    } else {
      exp.lua_rawseti(this.L, tableIdx, BigInt(n));
    }
  }

  private rawGetI(tableIdx: number, n: number): void {
    const exp = this.exports;
    if (this.version.startsWith('5.1') || this.version.startsWith('5.2')) {
      exp.lua_rawgeti(this.L, tableIdx, n);
    } else {
      exp.lua_rawgeti(this.L, tableIdx, BigInt(n));
    }
  }

  private pushRefsTable(): void {
    const exp = this.exports;
    this.withString('__luabros_refs', (keyPtr) => {
      if (exp.lua_getglobal) {
        exp.lua_getglobal(this.L, keyPtr);
      } else {
        exp.lua_getfield(this.L, -10002, keyPtr);
      }
    });
  }

  private releaseRef(refId: number): void {
    const exp = this.exports;
    this.pushRefsTable();
    exp.lua_pushnil(this.L);
    this.rawSetI(-2, refId);
    this.luaPop(1);
  }

  private readLuaError(): string {
    const exp = this.exports;
    const len = Number(exp.lua_rawlen ? exp.lua_rawlen(this.L, -1) : 0);
    const ptr = exp.lua_tolstring(this.L, -1, 0);
    if (!ptr) return 'Unknown Lua Error';
    return this.readString(ptr, len || undefined);
  }

  

  public pushJSValue(val: any): void {
    const exp = this.exports;

    if (val === null || val === undefined) {
      exp.lua_pushnil(this.L);
    } else if (typeof val === 'boolean') {
      exp.lua_pushboolean(this.L, val ? 1 : 0);
    } else if (typeof val === 'number') {
      exp.lua_pushnumber(this.L, val);
    } else if (typeof val === 'string') {
      this.withString(val, (ptr, len) => {
        exp.lua_pushlstring(this.L, ptr, len);
      });
    } else if (typeof val === 'function') {
      
      const table = this.exports.__indirect_function_table as WebAssembly.Table;
      if (!table) {
        throw new Error('WebAssembly table not exported for function registration');
      }

      const wasmCallback = createWasmCallback((luaState: number) => {
        const argCount = exp.lua_gettop(luaState);
        const jsArgs: any[] = [];
        for (let i = 1; i <= argCount; i++) {
          jsArgs.push(this.pullLuaValue(i));
        }

        try {
          const ret = val(...jsArgs);
          if (ret === undefined) {
            return 0;
          } else if (Array.isArray(ret) && (ret as any).__lua_multi_return) {
            for (const item of ret) {
              this.pushJSValue(item);
            }
            return ret.length;
          } else {
            this.pushJSValue(ret);
            return 1;
          }
        } catch (e: any) {
          const errMsg = e instanceof Error ? e.message : String(e);
          this.withString(`JavaScript error in callback: ${errMsg}`, (errPtr) => {
            exp.lua_pushstring(luaState, errPtr);
          });
          return exp.lua_error(luaState);
        }
      });

      const fnIdx = table.grow(1);
      table.set(fnIdx, wasmCallback);
      exp.lua_pushcclosure(this.L, fnIdx, 0);
    } else if (Array.isArray(val)) {
      exp.lua_createtable(this.L, val.length, 0);
      for (let i = 0; i < val.length; i++) {
        this.pushJSValue(val[i]);
        this.rawSetI(-2, i + 1); 
      }
    } else if (typeof val === 'object') {
      const keys = Object.keys(val);
      exp.lua_createtable(this.L, 0, keys.length);
      for (const k of keys) {
        this.withString(k, (keyPtr, keyLen) => {
          exp.lua_pushlstring(this.L, keyPtr, keyLen);
          this.pushJSValue(val[k]);
          exp.lua_rawset(this.L, -3);
        });
      }
    } else {
      exp.lua_pushnil(this.L);
    }
  }

  

  public pullLuaValue(idx: number, depth: number = 0): any {
    const exp = this.exports;
    const type = exp.lua_type(this.L, idx);

    switch (type) {
      case 0: 
        return null;

      case 1: 
        return Boolean(exp.lua_toboolean(this.L, idx));

      case 2: 
        return exp.lua_touserdata(this.L, idx);

      case 3: 
        return exp.lua_tonumberx ? exp.lua_tonumberx(this.L, idx, 0) : exp.lua_tonumber(this.L, idx);

      case 4: { 
        const len = Number(exp.lua_rawlen ? exp.lua_rawlen(this.L, idx) : 0);
        const ptr = exp.lua_tolstring(this.L, idx, 0);
        return this.readString(ptr, len || undefined);
      }

      case 5: { 
        if (depth > 20) return '[Circular Table / Max Depth]';

        
        const len = Number(exp.lua_rawlen ? exp.lua_rawlen(this.L, idx) : 0);
        const obj: Record<string, any> = {};
        const arr: any[] = [];
        let isArray = len > 0;

        
        exp.lua_pushnil(this.L);
        
        const absTableIdx = idx > 0 ? idx : exp.lua_gettop(this.L) - 1;

        let entryCount = 0;
        let highestIntKey = 0;

        while (exp.lua_next(this.L, absTableIdx) !== 0) {
          entryCount++;
          
          const keyType = exp.lua_type(this.L, -2);
          const val = this.pullLuaValue(-1, depth + 1);

          if (keyType === 3) {
            const numKey = exp.lua_tonumberx ? exp.lua_tonumberx(this.L, -2, 0) : exp.lua_tonumber(this.L, -2);
            if (Number.isInteger(numKey) && numKey >= 1) {
              if (numKey > highestIntKey) highestIntKey = numKey;
              obj[String(numKey)] = val;
            } else {
              isArray = false;
              obj[String(numKey)] = val;
            }
          } else {
            isArray = false;
            const keyStr = String(this.pullLuaValue(-2, depth + 1));
            obj[keyStr] = val;
          }

          
          this.luaPop(1);
        }

        if (isArray && highestIntKey === entryCount) {
          for (let i = 1; i <= entryCount; i++) {
            arr.push(obj[String(i)]);
          }
          return arr;
        }

        return obj;
      }

      case 6: { 
        
        const refId = this.nextRefId++;
        this.pushRefsTable();
        exp.lua_pushvalue(this.L, idx > 0 ? idx : idx - 1);
        this.rawSetI(-2, refId);
        this.luaPop(1); 

        
        const callable = (...fnArgs: any[]): any => {
          if (this.isClosed || !this.L) {
            throw new Error('Cannot call Lua function: Lua state is closed');
          }

          const topBefore = exp.lua_gettop(this.L);
          
          this.pushRefsTable();
          
          this.rawGetI(-1, refId);
          
          this.luaRemove(-2);

          
          for (const arg of fnArgs) {
            this.pushJSValue(arg);
          }

          
          const pcallFn = exp.lua_pcallk || exp.lua_pcall;
          const status = pcallFn(this.L, fnArgs.length, 1, 0, 0, 0);

          if (status !== 0) {
            const errMsg = this.readLuaError();
            exp.lua_settop(this.L, topBefore);
            this.wasi.flush();
            throw new Error(`Lua function error: ${errMsg}`);
          }

          const result = this.pullLuaValue(exp.lua_gettop(this.L));
          exp.lua_settop(this.L, topBefore);
          this.wasi.flush();
          return result;
        };

        if (this.refsFinalizer) {
          this.refsFinalizer.register(callable, refId);
        }

        return callable;
      }

      default:
        return `[Lua Type: ${type}]`;
    }
  }

  

  public getGlobal(name: string): any {
    if (this.isClosed) throw new Error('LuaEngine is closed');
    const exp = this.exports;

    this.withString(name, (namePtr) => {
      if (exp.lua_getglobal) {
        exp.lua_getglobal(this.L, namePtr);
      } else {
        exp.lua_getfield(this.L, -10002, namePtr);
      }
    });

    const val = this.pullLuaValue(exp.lua_gettop(this.L));
    this.luaPop(1);
    return val;
  }

  public setGlobal(name: string, value: LuaJSValue): void {
    if (this.isClosed) throw new Error('LuaEngine is closed');
    const exp = this.exports;

    this.pushJSValue(value);
    this.withString(name, (namePtr) => {
      if (exp.lua_setglobal) {
        exp.lua_setglobal(this.L, namePtr);
      } else {
        exp.lua_setfield(this.L, -10002, namePtr);
      }
    });
  }

  public registerFunction(name: string, fn: (...args: any[]) => any): void {
    this.setGlobal(name, fn);
  }

  public call(functionName: string, ...args: any[]): any {
    const fn = this.getGlobal(functionName);
    if (typeof fn !== 'function') {
      throw new Error(`Lua global "${functionName}" is not a callable function (type: ${typeof fn})`);
    }
    return fn(...args);
  }

  public get(name: string): any {
    return this.getGlobal(name);
  }

  public set(name: string, value: LuaJSValue): void {
    this.setGlobal(name, value);
  }

  public register(name: string, fn: (...args: any[]) => any): void {
    this.registerFunction(name, fn);
  }

  public getStdout(): string {
    return this.wasi.stdoutAccumulator;
  }

  public getStderr(): string {
    return this.wasi.stderrAccumulator;
  }

  public doString(code: string): any {
    if (this.isClosed) throw new Error('LuaEngine is closed');
    const exp = this.exports;

    const loadFn = exp.luaL_loadbufferx || exp.luaL_loadbuffer;
    const chunkName = '=[string]';

    
    let loadStatus = 0;
    try {
      loadStatus = this.withString(code, (codePtr, codeLen) => {
        return this.withString(chunkName, (namePtr) => {
          return loadFn(this.L, codePtr, codeLen, namePtr, 0);
        });
      });
    } catch (e: any) {
      
      const errMsg = this.readLuaError();
      exp.lua_settop(this.L, 0);
      this.wasi.flush();
      throw new Error(errMsg || `WASM Exception during parsing: ${e?.message || e}`);
    }

    if (loadStatus !== 0) {
      const errMsg = this.readLuaError();
      exp.lua_settop(this.L, 0);
      this.wasi.flush();
      throw new Error(errMsg);
    }

    
    const pcallFn = exp.lua_pcallk || exp.lua_pcall;
    let callStatus = 0;
    try {
      callStatus = pcallFn(this.L, 0, -1, 0, 0, 0);
    } catch (e: any) {
      
      const errMsg = this.readLuaError();
      exp.lua_settop(this.L, 0);
      this.wasi.flush();
      throw new Error(errMsg || `WASM Exception during execution: ${e?.message || e}`);
    }

    if (callStatus !== 0) {
      const errMsg = this.readLuaError();
      exp.lua_settop(this.L, 0);
      this.wasi.flush();
      throw new Error(errMsg);
    }

    
    const top = exp.lua_gettop(this.L);
    let result: any = undefined;

    if (top === 1) {
      result = this.pullLuaValue(1);
    } else if (top > 1) {
      result = [];
      for (let i = 1; i <= top; i++) {
        result.push(this.pullLuaValue(i));
      }
    }

    exp.lua_settop(this.L, 0);
    this.wasi.flush();
    return result;
  }

  public runWithMetrics(code: string): ExecutionResult {
    const startTime = performance.now();
    this.wasi.clearBuffers();

    let value: any = undefined;
    let error: Error | null = null;

    try {
      value = this.doString(code);
    } catch (err: any) {
      error = err instanceof Error ? err : new Error(String(err));
    } finally {
      this.wasi.flush();
    }

    const executionTimeMs = performance.now() - startTime;

    return {
      value,
      stdout: this.wasi.stdoutAccumulator,
      stderr: this.wasi.stderrAccumulator,
      executionTimeMs,
      error,
    };
  }

  public run(code: string): { ok: true; values: any[] } | { ok: false; error: string } {
    if (this.isClosed) throw new Error('LuaEngine is closed');
    const exp = this.exports;

    this.wasi.clearBuffers();

    const loadFn = exp.luaL_loadbufferx || exp.luaL_loadbuffer;
    const chunkName = '=[string]';

    
    let loadStatus = 0;
    try {
      loadStatus = this.withString(code, (codePtr, codeLen) => {
        return this.withString(chunkName, (namePtr) => {
          return loadFn(this.L, codePtr, codeLen, namePtr, 0);
        });
      });
    } catch (e: any) {
      const errMsg = this.readLuaError();
      exp.lua_settop(this.L, 0);
      this.wasi.flush();
      return { ok: false, error: errMsg || `WASM Exception during parsing: ${e?.message || e}` };
    }

    if (loadStatus !== 0) {
      const errMsg = this.readLuaError();
      exp.lua_settop(this.L, 0);
      this.wasi.flush();
      return { ok: false, error: errMsg };
    }

    
    const pcallFn = exp.lua_pcallk || exp.lua_pcall;
    let callStatus = 0;
    try {
      callStatus = pcallFn(this.L, 0, -1, 0, 0, 0);
    } catch (e: any) {
      const errMsg = this.readLuaError();
      exp.lua_settop(this.L, 0);
      this.wasi.flush();
      return { ok: false, error: errMsg || `WASM Exception during execution: ${e?.message || e}` };
    }

    if (callStatus !== 0) {
      const errMsg = this.readLuaError();
      exp.lua_settop(this.L, 0);
      this.wasi.flush();
      return { ok: false, error: errMsg };
    }

    
    const top = exp.lua_gettop(this.L);
    const values: any[] = [];
    for (let i = 1; i <= top; i++) {
      values.push(this.pullLuaValue(i));
    }

    exp.lua_settop(this.L, 0);
    this.wasi.flush();
    return { ok: true, values };
  }

  
  public writeFile(path: string, content: string | Uint8Array): void {
    this.wasi.writeFile(path, content);
  }

  public readFile(path: string): Uint8Array | null {
    return this.wasi.readFile(path);
  }

  public listFiles(): string[] {
    return this.wasi.listFiles();
  }

  public clearLogs(): void {
    this.wasi.clearBuffers();
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.scratchPtr && this.exports.free) {
      try {
        this.exports.free(this.scratchPtr);
      } catch {
        
      }
      this.scratchPtr = 0;
    }

    if (this.L && this.exports.lua_close) {
      try {
        this.exports.lua_close(this.L);
      } catch {
        
      }
      this.L = 0;
    }
  }
}
