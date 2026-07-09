import { Demo3DUnsupportedError } from "./errors.js";

export type Demo3DInput = ArrayBuffer | Uint8Array | DataView;

export function toUint8Array(input: Demo3DInput): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof DataView) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }

  return new Uint8Array(input);
}

export function sliceBytes(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  return bytes.subarray(offset, offset + length);
}

export function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function decodeText(bytes: Uint8Array, encoding: "utf-8" | "latin1" = "utf-8"): string {
  if (encoding === "latin1") {
    return new TextDecoder("windows-1252").decode(bytes);
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function encodeBase64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, "");
  const typedArrayConstructor = Uint8Array as typeof Uint8Array & {
    fromBase64?: (value: string) => Uint8Array;
  };

  if (typeof typedArrayConstructor.fromBase64 === "function") {
    return typedArrayConstructor.fromBase64(clean);
  }

  if (typeof atob !== "function") {
    throw new Demo3DUnsupportedError(
      "Base64 decoding requires atob() or Uint8Array.fromBase64().",
      "DEMO3D_BASE64_UNSUPPORTED"
    );
  }

  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

export async function inflateRawDeflate(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new Demo3DUnsupportedError(
      'DEFLATE entries require DecompressionStream("deflate-raw") in this runtime.',
      "DEMO3D_DEFLATE_UNSUPPORTED"
    );
  }

  let stream: DecompressionStream;
  try {
    stream = new DecompressionStream("deflate-raw");
  } catch (error) {
    throw new Demo3DUnsupportedError(
      `DEFLATE entries require DecompressionStream("deflate-raw"): ${String(error)}`,
      "DEMO3D_DEFLATE_UNSUPPORTED"
    );
  }

  const readable = new Blob([compressed as unknown as BlobPart]).stream().pipeThrough(stream);
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
  }

  return concatBytes(chunks);
}
