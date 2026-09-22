export type LuaVersion = '5.1.5' | '5.2.4' | '5.3.6' | '5.4.7' | '5.5.1';

export interface WASIOptions {
  args?: string[];
  env?: Record<string, string>;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  stdin?: string | (() => string | null);
  lineBuffered?: boolean;
}

export interface LuaValueRecord {
  [key: string]: any;
}

export type LuaJSValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | ((...args: any[]) => any)
  | any[]
  | LuaValueRecord;

export interface LuaEngineOptions {
  version?: LuaVersion;
  wasmBase?: string;
  wasmSource?: string | ArrayBuffer | Response | Uint8Array;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  globals?: Record<string, LuaJSValue>;
  lineBuffered?: boolean;
  args?: string[];
}

export interface ExecutionResult {
  value: any;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
  error?: Error | null;
}

export interface RegisteredGlobalInfo {
  name: string;
  type: string;
  valueString: string;
}
