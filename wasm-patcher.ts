function readVarUint(buf: Uint8Array, pos: number): [number, number] {
  let res = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = buf[pos++];
    res |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [res, pos];
}

function writeVarUint(val: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let b = val & 0x7f;
    val >>>= 7;
    if (val !== 0) b |= 0x80;
    bytes.push(b);
  } while (val !== 0);
  return new Uint8Array(bytes);
}

export function patchWasmTable(wasmBytes: Uint8Array): Uint8Array {
  let p = 8;
  let tableSecStart = -1;
  let tableSecEnd = -1;
  let payloadStart = -1;
  let payloadLen = 0;

  while (p < wasmBytes.length) {
    const start = p;
    const id = wasmBytes[p++];
    let len = 0;
    let shift = 0;
    let b: number;
    do {
      b = wasmBytes[p++];
      len |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);

    if (id === 4) {
      tableSecStart = start;
      tableSecEnd = p + len;
      payloadStart = p;
      payloadLen = len;
      break;
    }
    p += len;
  }

  if (tableSecStart === -1) {
    return wasmBytes;
  }

  let ptr = payloadStart;
  const count = wasmBytes[ptr++];
  const type = wasmBytes[ptr++];
  const flags = wasmBytes[ptr++];

  if (flags === 1) {
    let initial = 0;
    let shift = 0;
    let b: number;
    const initialStart = ptr;
    do {
      b = wasmBytes[ptr++];
      initial |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    const initialEnd = ptr;

    const initialBytes = wasmBytes.subarray(initialStart, initialEnd);
    const newPayload = new Uint8Array(3 + initialBytes.length);
    newPayload[0] = count;
    newPayload[1] = type;
    newPayload[2] = 0; // limit flag = 0 (no max)
    newPayload.set(initialBytes, 3);

    const newLen = newPayload.length;
    const newLenBytes = writeVarUint(newLen);
    const newSec = new Uint8Array(1 + newLenBytes.length + newLen);
    newSec[0] = 4;
    newSec.set(newLenBytes, 1);
    newSec.set(newPayload, 1 + newLenBytes.length);

    const result = new Uint8Array(tableSecStart + newSec.length + (wasmBytes.length - tableSecEnd));
    result.set(wasmBytes.subarray(0, tableSecStart), 0);
    result.set(newSec, tableSecStart);
    result.set(wasmBytes.subarray(tableSecEnd), tableSecStart + newSec.length);

    try {
      const _validationModule = new WebAssembly.Module(result as any);
      return result;
    } catch {
      return wasmBytes;
    }
  }

  return wasmBytes;
}

export function patchWasmBinary(wasmBytes: Uint8Array): Uint8Array {
  // Always patch the table first to guarantee it is growable.
  wasmBytes = patchWasmTable(wasmBytes);

  try {
    const mod = new WebAssembly.Module(wasmBytes as any);
    const existing = WebAssembly.Module.exports(mod).find((e) => e.name === '__cpp_exception');
    if (existing) {
      return wasmBytes;
    }
  } catch {
  }

  let p = 8;
  let expSecStart = -1;
  let expSecPayloadStart = -1;
  let expSecPayloadEnd = -1;

  while (p < wasmBytes.length) {
    const secStart = p;
    const id = wasmBytes[p++];
    const [len, newP] = readVarUint(wasmBytes, p);
    if (id === 7) {
      expSecStart = secStart;
      expSecPayloadStart = newP;
      expSecPayloadEnd = newP + len;
      break;
    }
    p = newP + len;
  }

  if (expSecStart === -1) {
    return wasmBytes;
  }

  const [expCount, countEnd] = readVarUint(wasmBytes, expSecPayloadStart);

  const nameBytes = new TextEncoder().encode('__cpp_exception');
  const tagExport = new Uint8Array(1 + nameBytes.length + 2);
  tagExport[0] = nameBytes.length;
  tagExport.set(nameBytes, 1);
  tagExport[1 + nameBytes.length] = 0x04;
  tagExport[1 + nameBytes.length + 1] = 0x00;

  const countBytes = writeVarUint(expCount + 1);
  const remainingExistingPayload = wasmBytes.subarray(countEnd, expSecPayloadEnd);

  const newPayloadLen = countBytes.length + remainingExistingPayload.length + tagExport.length;
  const newPayload = new Uint8Array(newPayloadLen);
  newPayload.set(countBytes, 0);
  newPayload.set(remainingExistingPayload, countBytes.length);
  newPayload.set(tagExport, countBytes.length + remainingExistingPayload.length);

  const newSecLenBytes = writeVarUint(newPayloadLen);
  const newSec = new Uint8Array(1 + newSecLenBytes.length + newPayloadLen);
  newSec[0] = 7;
  newSec.set(newSecLenBytes, 1);
  newSec.set(newPayload, 1 + newSecLenBytes.length);

  const result = new Uint8Array(expSecStart + newSec.length + (wasmBytes.length - expSecPayloadEnd));
  result.set(wasmBytes.subarray(0, expSecStart), 0);
  result.set(newSec, expSecStart);
  result.set(wasmBytes.subarray(expSecPayloadEnd), expSecStart + newSec.length);

  try {
    const _validationModule = new WebAssembly.Module(result as any);
    return result;
  } catch {
    return wasmBytes;
  }
}
