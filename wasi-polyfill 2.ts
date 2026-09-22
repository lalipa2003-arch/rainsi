import { WASIOptions } from './types.js';

export interface VFSFile {
  content: Uint8Array;
  mtime: bigint;
}

export interface FileDescriptor {
  path?: string;
  offset: number;
  flags: number;
  type: number; 
}

export class WASIPolyfill {
  private args: string[];
  private env: Record<string, string>;
  private onStdout: ((text: string) => void) | null;
  private onStderr: ((text: string) => void) | null;
  private lineBuffered: boolean;
  private stdinBuffer: string = '';
  private memoryGetter: () => WebAssembly.Memory | null = () => null;
  private instanceExports: any = null;

  public stdoutAccumulator: string = '';
  public stderrAccumulator: string = '';
  private stdoutLineBuffer: string = '';
  private stderrLineBuffer: string = '';

  
  private vfsFiles: Map<string, Uint8Array> = new Map();
  private openFds: Map<number, FileDescriptor> = new Map();
  private nextFd: number = 4; 

  
  private setjmpId: number = 0;
  private tempRet0: number = 0;
  private cppTag: WebAssembly.Tag | null = null;
  private scratchArgPtr: number = 1024;

  constructor(options: WASIOptions = {}) {
    this.args = options.args || ['lua'];
    this.env = {
      LUA_PATH: './?.lua;;',
      LUA_CPATH: './?.so;;',
      USER: 'web',
      HOME: '/home/web',
      ...(options.env || {}),
    };
    this.onStdout = options.onStdout || null;
    this.onStderr = options.onStderr || null;
    this.lineBuffered = options.lineBuffered ?? false;

    if (typeof options.stdin === 'string') {
      this.stdinBuffer = options.stdin;
    }

    
    this.openFds.set(0, { offset: 0, flags: 0, type: 2 }); 
    this.openFds.set(1, { offset: 0, flags: 0, type: 2 }); 
    this.openFds.set(2, { offset: 0, flags: 0, type: 2 }); 
    this.openFds.set(3, { path: '.', offset: 0, flags: 0, type: 3 }); 
  }

  public setMemoryGetter(getter: () => WebAssembly.Memory) {
    this.memoryGetter = getter;
  }

  public setInstanceExports(exports: any) {
    this.instanceExports = exports;
  }

  public setCppTag(tag: WebAssembly.Tag | null) {
    this.cppTag = tag;
  }

  public setScratchArgPtr(ptr: number) {
    this.scratchArgPtr = ptr;
  }

  public getArgs(): string[] {
    return this.args;
  }

  public clearBuffers() {
    this.stdoutAccumulator = '';
    this.stderrAccumulator = '';
    this.stdoutLineBuffer = '';
    this.stderrLineBuffer = '';
  }

  public flush(): void {
    if (this.stdoutLineBuffer.length > 0) {
      this.onStdout?.(this.stdoutLineBuffer);
      this.stdoutLineBuffer = '';
    }
    if (this.stderrLineBuffer.length > 0) {
      this.onStderr?.(this.stderrLineBuffer);
      this.stderrLineBuffer = '';
    }
  }

  
  public writeFile(path: string, content: string | Uint8Array): void {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    this.vfsFiles.set(this.normalizePath(path), bytes);
  }

  public readFile(path: string): Uint8Array | null {
    return this.vfsFiles.get(this.normalizePath(path)) || null;
  }

  public listFiles(): string[] {
    return Array.from(this.vfsFiles.keys());
  }

  private normalizePath(p: string): string {
    let clean = p.replace(/\\/g, '/');
    if (clean.startsWith('./')) clean = clean.slice(2);
    if (clean.startsWith('/')) clean = clean.slice(1);
    return clean;
  }

  private getMemoryView(): DataView {
    const mem = this.memoryGetter();
    if (!mem) throw new Error('WebAssembly memory not bound to WASI polyfill');
    return new DataView(mem.buffer);
  }

  private getMemoryBytes(): Uint8Array {
    const mem = this.memoryGetter();
    if (!mem) throw new Error('WebAssembly memory not bound to WASI polyfill');
    return new Uint8Array(mem.buffer);
  }

  public getImports(): { wasi_snapshot_preview1: WebAssembly.ModuleImports; env: WebAssembly.ModuleImports } {
    return {
      wasi_snapshot_preview1: new Proxy({
        args_sizes_get: (argcPtr: number, argvBufSizePtr: number): number => {
          const view = this.getMemoryView();
          view.setUint32(argcPtr, this.args.length, true);
          let totalBytes = 0;
          for (const arg of this.args) {
            totalBytes += new TextEncoder().encode(arg + '\0').length;
          }
          view.setUint32(argvBufSizePtr, totalBytes, true);
          return 0; 
        },

        args_get: (argvPtr: number, argvBufPtr: number): number => {
          const view = this.getMemoryView();
          const bytes = this.getMemoryBytes();
          let currentBufOffset = argvBufPtr;

          for (let i = 0; i < this.args.length; i++) {
            view.setUint32(argvPtr + i * 4, currentBufOffset, true);
            const encoded = new TextEncoder().encode(this.args[i] + '\0');
            bytes.set(encoded, currentBufOffset);
            currentBufOffset += encoded.length;
          }
          return 0;
        },

        environ_sizes_get: (environCountPtr: number, environBufSizePtr: number): number => {
          const entries = Object.entries(this.env);
          const view = this.getMemoryView();
          view.setUint32(environCountPtr, entries.length, true);
          let totalBytes = 0;
          for (const [key, val] of entries) {
            totalBytes += new TextEncoder().encode(`${key}=${val}\0`).length;
          }
          view.setUint32(environBufSizePtr, totalBytes, true);
          return 0;
        },

        environ_get: (environPtr: number, environBufPtr: number): number => {
          const entries = Object.entries(this.env);
          const view = this.getMemoryView();
          const bytes = this.getMemoryBytes();
          let currentBufOffset = environBufPtr;

          for (let i = 0; i < entries.length; i++) {
            const [k, v] = entries[i];
            view.setUint32(environPtr + i * 4, currentBufOffset, true);
            const encoded = new TextEncoder().encode(`${k}=${v}\0`);
            bytes.set(encoded, currentBufOffset);
            currentBufOffset += encoded.length;
          }
          return 0;
        },

        clock_time_get: (_clockId: number, _precision: bigint, timePtr: number): number => {
          const view = this.getMemoryView();
          const nowMs = performance.now();
          const nowNs = BigInt(Math.floor(nowMs * 1_000_000));
          view.setBigUint64(timePtr, nowNs, true);
          return 0;
        },

        fd_close: (fd: number): number => {
          if (fd > 2) {
            this.openFds.delete(fd);
          }
          return 0;
        },

        fd_fdstat_get: (fd: number, statPtr: number): number => {
          const view = this.getMemoryView();
          let type = 2; 
          if (fd === 3) {
            type = 3; 
          } else if (this.openFds.has(fd)) {
            type = this.openFds.get(fd)!.type;
          } else {
            return 8; 
          }
          view.setUint8(statPtr, type);
          view.setUint16(statPtr + 2, 0, true);
          view.setBigUint64(statPtr + 8, 0xffffffffffffffffn, true);
          view.setBigUint64(statPtr + 16, 0xffffffffffffffffn, true);
          return 0;
        },

        fd_fdstat_set_flags: (): number => 0,

        fd_advise: (fd: number, _offset: bigint, _len: bigint, _advice: number): number => {
          if (!this.openFds.has(fd) && fd > 2) return 8; 
          return 0;
        },

        fd_allocate: (fd: number, _offset: bigint, _len: bigint): number => {
          if (!this.openFds.has(fd) && fd > 2) return 8; 
          return 0;
        },

        fd_datasync: (fd: number): number => {
          if (!this.openFds.has(fd) && fd > 2) return 8; 
          return 0;
        },

        fd_fdstat_set_rights: (fd: number, _rightsBase: bigint, _rightsInheriting: bigint): number => {
          if (!this.openFds.has(fd) && fd > 2) return 8; 
          return 0;
        },

        fd_filestat_get: (fd: number, statPtr: number): number => {
          const desc = this.openFds.get(fd);
          if (!desc) return 8; 
          const view = this.getMemoryView();
          const fileData = (desc.path ? this.vfsFiles.get(desc.path) : null) || new Uint8Array(0);
          
          view.setBigUint64(statPtr + 0, 1n, true); 
          view.setBigUint64(statPtr + 8, BigInt(fd), true); 
          view.setUint8(statPtr + 16, desc.type); 
          view.setBigUint64(statPtr + 24, 1n, true); 
          view.setBigUint64(statPtr + 32, BigInt(fileData.length), true); 
          const nowNs = BigInt(Math.floor(Date.now() * 1_000_000));
          view.setBigUint64(statPtr + 40, nowNs, true); 
          view.setBigUint64(statPtr + 48, nowNs, true); 
          view.setBigUint64(statPtr + 56, nowNs, true); 
          return 0;
        },

        fd_filestat_set_size: (fd: number, size: bigint): number => {
          const desc = this.openFds.get(fd);
          if (!desc) return 8; 
          const path = desc.path || '';
          let fileData = this.vfsFiles.get(path) || new Uint8Array(0);
          const targetSize = Number(size);
          if (fileData.length !== targetSize) {
            const newBuf = new Uint8Array(targetSize);
            newBuf.set(fileData.subarray(0, Math.min(fileData.length, targetSize)));
            this.vfsFiles.set(path, newBuf);
          }
          return 0;
        },

        fd_filestat_set_times: (fd: number, _atim: bigint, _mtim: bigint, _fst_flags: number): number => {
          if (!this.openFds.has(fd) && fd > 2) return 8; 
          return 0;
        },

        fd_readdir: (fd: number, bufPtr: number, bufLen: number, cookie: bigint, nwrittenPtr: number): number => {
          if (fd !== 3) return 8; 
          const view = this.getMemoryView();
          const bytes = this.getMemoryBytes();
          
          const files = Array.from(this.vfsFiles.keys());
          let bytesWritten = 0;
          
          for (let i = 0; i < files.length; i++) {
            if (BigInt(i) < cookie) continue;
            const name = files[i];
            const nameBytes = new TextEncoder().encode(name);
            const entrySize = 24 + nameBytes.length;
            
            if (bytesWritten + entrySize > bufLen) {
              break;
            }
            
            const entryPtr = bufPtr + bytesWritten;
            const nextCookie = BigInt(i + 1);
            view.setBigUint64(entryPtr + 0, nextCookie, true); 
            view.setBigUint64(entryPtr + 8, BigInt(1000 + i), true); 
            view.setUint32(entryPtr + 16, nameBytes.length, true); 
            view.setUint8(entryPtr + 20, 4); 
            view.setUint8(entryPtr + 21, 0);
            view.setUint16(entryPtr + 22, 0, true);
            
            bytes.set(nameBytes, entryPtr + 24);
            bytesWritten += entrySize;
          }
          
          view.setUint32(nwrittenPtr, bytesWritten, true);
          return 0;
        },

        fd_sync: (fd: number): number => {
          if (!this.openFds.has(fd) && fd > 2) return 8; 
          return 0;
        },

        fd_tell: (fd: number, offsetPtr: number): number => {
          const desc = this.openFds.get(fd);
          if (!desc) return 8; 
          const view = this.getMemoryView();
          view.setBigUint64(offsetPtr, BigInt(desc.offset), true);
          return 0;
        },

        fd_prestat_get: (fd: number, prestatPtr: number): number => {
          if (fd === 3) {
            const view = this.getMemoryView();
            view.setUint8(prestatPtr, 0); 
            view.setUint32(prestatPtr + 4, 1, true); 
            return 0;
          }
          return 8; 
        },

        fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number): number => {
          if (fd === 3) {
            const bytes = this.getMemoryBytes();
            const dot = new TextEncoder().encode('.');
            bytes.set(dot.subarray(0, pathLen), pathPtr);
            return 0;
          }
          return 8; 
        },

        fd_read: (fd: number, iovs: number, iovsLen: number, nreadPtr: number): number => {
          const view = this.getMemoryView();
          const bytes = this.getMemoryBytes();
          let totalRead = 0;

          if (fd === 0 && this.stdinBuffer.length > 0) {
            const encoded = new TextEncoder().encode(this.stdinBuffer);
            let remaining = encoded.length;
            let encodedOffset = 0;

            for (let i = 0; i < iovsLen && remaining > 0; i++) {
              const bufPtr = view.getUint32(iovs + i * 8, true);
              const bufLen = view.getUint32(iovs + i * 8 + 4, true);
              const toWrite = Math.min(bufLen, remaining);
              bytes.set(encoded.subarray(encodedOffset, encodedOffset + toWrite), bufPtr);
              totalRead += toWrite;
              encodedOffset += toWrite;
              remaining -= toWrite;
            }
            this.stdinBuffer = this.stdinBuffer.slice(encodedOffset);
          } else if (this.openFds.has(fd)) {
            const desc = this.openFds.get(fd)!;
            const fileData = (desc.path ? this.vfsFiles.get(desc.path) : null) || new Uint8Array(0);

            for (let i = 0; i < iovsLen; i++) {
              const bufPtr = view.getUint32(iovs + i * 8, true);
              const bufLen = view.getUint32(iovs + i * 8 + 4, true);
              if (desc.offset >= fileData.length) break;

              const toRead = Math.min(bufLen, fileData.length - desc.offset);
              bytes.set(fileData.subarray(desc.offset, desc.offset + toRead), bufPtr);
              desc.offset += toRead;
              totalRead += toRead;
            }
          }

          view.setUint32(nreadPtr, totalRead, true);
          return 0;
        },

        fd_renumber: (): number => 0,

        fd_seek: (fd: number, offset: bigint, whence: number, newOffsetPtr: number): number => {
          const desc = this.openFds.get(fd);
          if (!desc) return 8; 

          const fileData = (desc.path ? this.vfsFiles.get(desc.path) : null) || new Uint8Array(0);
          let target = 0;
          if (whence === 0) {
            
            target = Number(offset);
          } else if (whence === 1) {
            
            target = desc.offset + Number(offset);
          } else if (whence === 2) {
            
            target = fileData.length + Number(offset);
          }
          desc.offset = Math.max(0, target);

          const view = this.getMemoryView();
          view.setBigUint64(newOffsetPtr, BigInt(desc.offset), true);
          return 0;
        },

        fd_write: (fd: number, iovs: number, iovsLen: number, nwrittenPtr: number): number => {
          const view = this.getMemoryView();
          const bytes = this.getMemoryBytes();
          let totalWritten = 0;

          if (fd === 1 || fd === 2) {
            let outputText = '';
            for (let i = 0; i < iovsLen; i++) {
              const bufPtr = view.getUint32(iovs + i * 8, true);
              const bufLen = view.getUint32(iovs + i * 8 + 4, true);
              if (bufLen > 0) {
                const chunkBytes = bytes.subarray(bufPtr, bufPtr + bufLen);
                outputText += new TextDecoder('utf-8', { fatal: false }).decode(chunkBytes);
                totalWritten += bufLen;
              }
            }

            if (fd === 1) {
              this.stdoutAccumulator += outputText;
              if (this.lineBuffered) {
                this.stdoutLineBuffer += outputText;
                const lines = this.stdoutLineBuffer.split('\n');
                this.stdoutLineBuffer = lines.pop() || '';
                for (const line of lines) {
                  this.onStdout?.(line + '\n');
                }
              } else {
                this.onStdout?.(outputText);
              }
            } else {
              this.stderrAccumulator += outputText;
              if (this.lineBuffered) {
                this.stderrLineBuffer += outputText;
                const lines = this.stderrLineBuffer.split('\n');
                this.stderrLineBuffer = lines.pop() || '';
                for (const line of lines) {
                  this.onStderr?.(line + '\n');
                }
              } else {
                this.onStderr?.(outputText);
              }
            }
          } else if (this.openFds.has(fd)) {
            
            const desc = this.openFds.get(fd)!;
            const path = desc.path || '';
            let fileData = this.vfsFiles.get(path) || new Uint8Array(0);

            for (let i = 0; i < iovsLen; i++) {
              const bufPtr = view.getUint32(iovs + i * 8, true);
              const bufLen = view.getUint32(iovs + i * 8 + 4, true);
              if (bufLen > 0) {
                const chunk = bytes.subarray(bufPtr, bufPtr + bufLen);
                if (desc.offset + bufLen > fileData.length) {
                  const grown = new Uint8Array(desc.offset + bufLen);
                  grown.set(fileData);
                  fileData = grown;
                }
                fileData.set(chunk, desc.offset);
                desc.offset += bufLen;
                totalWritten += bufLen;
              }
            }
            this.vfsFiles.set(path, fileData);
          }

          view.setUint32(nwrittenPtr, totalWritten, true);
          return 0;
        },

        path_open: (
          _dirFd: number,
          _dirflags: number,
          pathPtr: number,
          pathLen: number,
          oflags: number,
          _fsRightsBase: bigint,
          _fsRightsInheriting: bigint,
          fdflags: number,
          openedFdPtr: number
        ): number => {
          const bytes = this.getMemoryBytes();
          const rawPath = new TextDecoder('utf-8').decode(bytes.subarray(pathPtr, pathPtr + pathLen));
          const normalized = this.normalizePath(rawPath);

          const isCreate = (oflags & 1) !== 0 || (oflags & 4) !== 0; 
          const isTrunc = (oflags & 2) !== 0; 

          if (!this.vfsFiles.has(normalized)) {
            if (!isCreate) {
              return 44; 
            }
            this.vfsFiles.set(normalized, new Uint8Array(0));
          } else if (isTrunc) {
            this.vfsFiles.set(normalized, new Uint8Array(0));
          }

          const fd = this.nextFd++;
          this.openFds.set(fd, {
            path: normalized,
            offset: 0,
            flags: fdflags,
            type: 4, 
          });

          const view = this.getMemoryView();
          view.setUint32(openedFdPtr, fd, true);
          return 0; 
        },

        path_remove_directory: (_dirFd: number, pathPtr: number, pathLen: number): number => {
          const bytes = this.getMemoryBytes();
          const rawPath = new TextDecoder('utf-8').decode(bytes.subarray(pathPtr, pathPtr + pathLen));
          const normalized = this.normalizePath(rawPath);
          this.vfsFiles.delete(normalized);
          return 0;
        },

        path_rename: (
          _oldDirFd: number,
          oldPathPtr: number,
          oldPathLen: number,
          _newDirFd: number,
          newPathPtr: number,
          newPathLen: number
        ): number => {
          const bytes = this.getMemoryBytes();
          const oldName = this.normalizePath(new TextDecoder('utf-8').decode(bytes.subarray(oldPathPtr, oldPathPtr + oldPathLen)));
          const newName = this.normalizePath(new TextDecoder('utf-8').decode(bytes.subarray(newPathPtr, newPathPtr + newPathLen)));

          if (!this.vfsFiles.has(oldName)) {
            return 44; 
          }
          const content = this.vfsFiles.get(oldName)!;
          this.vfsFiles.delete(oldName);
          this.vfsFiles.set(newName, content);
          return 0;
        },

        path_unlink_file: (_dirFd: number, pathPtr: number, pathLen: number): number => {
          const bytes = this.getMemoryBytes();
          const name = this.normalizePath(new TextDecoder('utf-8').decode(bytes.subarray(pathPtr, pathPtr + pathLen)));
          if (!this.vfsFiles.has(name)) {
            return 44; 
          }
          this.vfsFiles.delete(name);
          return 0;
        },

        path_create_directory: (_dirFd: number, _pathPtr: number, _pathLen: number): number => {
          return 0;
        },

        path_filestat_get: (_dirFd: number, _flags: number, pathPtr: number, pathLen: number, statPtr: number): number => {
          const bytes = this.getMemoryBytes();
          const rawPath = new TextDecoder('utf-8').decode(bytes.subarray(pathPtr, pathPtr + pathLen));
          const normalized = this.normalizePath(rawPath);
          
          if (!this.vfsFiles.has(normalized)) {
            return 44; 
          }
          const fileData = this.vfsFiles.get(normalized)!;
          const view = this.getMemoryView();
          view.setBigUint64(statPtr + 0, 1n, true); 
          view.setBigUint64(statPtr + 8, 999n, true); 
          view.setUint8(statPtr + 16, 4); 
          view.setBigUint64(statPtr + 24, 1n, true); 
          view.setBigUint64(statPtr + 32, BigInt(fileData.length), true); 
          const nowNs = BigInt(Math.floor(Date.now() * 1_000_000));
          view.setBigUint64(statPtr + 40, nowNs, true); 
          view.setBigUint64(statPtr + 48, nowNs, true); 
          view.setBigUint64(statPtr + 56, nowNs, true); 
          return 0;
        },

        path_filestat_set_times: (_dirFd: number, _flags: number, _pathPtr: number, _pathLen: number, _atim: bigint, _mtim: bigint, _fstFlags: number): number => {
          return 0;
        },

        path_link: (_oldDirFd: number, _oldFlags: number, _oldPathPtr: number, _oldPathLen: number, _newDirFd: number, _newPathPtr: number, _newPathLen: number): number => {
          return 58; 
        },

        path_symlink: (_oldPathPtr: number, _oldPathLen: number, _dirFd: number, _newPathPtr: number, _newPathLen: number): number => {
          return 58; 
        },

        path_readlink: (_dirFd: number, _pathPtr: number, _pathLen: number, _bufPtr: number, _bufLen: number, _nreadPtr: number): number => {
          return 22; 
        },

        random_get: (bufPtr: number, bufLen: number): number => {
          const bytes = this.getMemoryBytes();
          const sub = bytes.subarray(bufPtr, bufPtr + bufLen);
          if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(sub as any);
          } else {
            for (let i = 0; i < bufLen; i++) {
              sub[i] = Math.floor(Math.random() * 256);
            }
          }
          return 0;
        },

        sched_yield: (): number => 0,

        proc_raise: (_sig: number): number => 0,

        sock_recv: (): number => 58, 
        sock_send: (): number => 58,
        sock_shutdown: (): number => 58,

        proc_exit: (_rval: number): void => {
          
        },
      } as any, {
        get: (target: any, prop: string | symbol) => {
          if (prop in target) {
            return target[prop];
          }
          if (typeof prop === 'string') {
            return (..._args: any[]) => 0;
          }
          return undefined;
        }
      }) as any,
      env: new Proxy({
        
        saveSetjmp: (envPtr: number, label: number, tablePtr: number, size: number): number => {
          const view = this.getMemoryView();
          this.setjmpId++;
          view.setUint32(envPtr, this.setjmpId, true);

          for (let i = 0; i < size; i++) {
            const entryId = view.getUint32(tablePtr + i * 8, true);
            if (entryId === 0) {
              view.setUint32(tablePtr + i * 8, this.setjmpId, true);
              view.setUint32(tablePtr + i * 8 + 4, label, true);
              view.setUint32(tablePtr + (i + 1) * 8, 0, true);
              this.tempRet0 = size;
              return tablePtr;
            }
          }

          
          this.tempRet0 = size;
          return tablePtr;
        },

        testSetjmp: (id: number, tablePtr: number, size: number): number => {
          const view = this.getMemoryView();
          for (let i = 0; i < size; i++) {
            const curr = view.getUint32(tablePtr + i * 8, true);
            if (curr === 0) break;
            if (curr === id) {
              return view.getUint32(tablePtr + i * 8 + 4, true);
            }
          }
          return 0;
        },

        getTempRet0: (): number => {
          return this.tempRet0;
        },

        setTempRet0: (val: number): void => {
          this.tempRet0 = val;
        },

        __wasm_longjmp: (envPtr: number, val: number): void => {
          const cleanVal = val === 0 ? 1 : val;
          const view = this.getMemoryView();

          
          view.setUint32(this.scratchArgPtr, envPtr, true);
          view.setUint32(this.scratchArgPtr + 4, cleanVal, true);

          if (this.cppTag && typeof WebAssembly.Exception === 'function') {
            throw new WebAssembly.Exception(this.cppTag, [this.scratchArgPtr]);
          }

          throw new Error(`Lua Error: unwound stack via longjmp (env=${envPtr}, val=${cleanVal})`);
        },

        _emscripten_throw_longjmp: (): void => {
          throw Infinity;
        },

        tmpfile: (): number => 0,
        system: (): number => -1,
        tmpnam: (): number => 0,
      } as any, {
        get: (target: any, prop: string | symbol) => {
          if (prop in target) {
            return target[prop];
          }
          if (typeof prop === 'string') {
            if (prop.startsWith('invoke_')) {
              return (...args: any[]) => {
                const exports = this.instanceExports;
                const table = exports?.__indirect_function_table || exports?.table;
                if (!table) {
                  throw new Error(`WebAssembly Table not found for invoke helper ${prop}`);
                }
                const funcIdx = args[0];
                const fn = table.get(funcIdx);
                const sp = exports.stackSave ? exports.stackSave() : 0;
                try {
                  return fn(...args.slice(1));
                } catch (e: any) {
                  if (exports.stackRestore) {
                    exports.stackRestore(sp);
                  }
                  if (e !== e + 0) throw e;
                  if (exports.setThrew) {
                    exports.setThrew(1, 0);
                  }
                }
              };
            }
            
            return (..._args: any[]) => {
              return 0;
            };
          }
          return undefined;
        }
      }) as any,
    };
  }
}
