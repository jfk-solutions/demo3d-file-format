import {
  decodeText,
  inflateRawDeflate,
  readUInt16LE,
  readUInt32LE,
  sliceBytes
} from "./binary.js";
import { Demo3DUnsupportedError, Demo3DZipError } from "./errors.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

export interface ZipEntryInfo {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionMethod: number;
  readonly flags: number;
  readonly crc32: number;
}

export class ZipArchive {
  readonly entries: ZipEntry[];

  constructor(private readonly bytes: Uint8Array, entries: ZipEntry[]) {
    this.entries = entries;
  }

  getEntry(name: string): ZipEntry | undefined {
    const normalized = normalizeZipPath(name);
    return this.entries.find((entry) => entry.name === normalized);
  }
}

export class ZipEntry implements ZipEntryInfo {
  constructor(
    private readonly archiveBytes: Uint8Array,
    public readonly name: string,
    public readonly compressedSize: number,
    public readonly uncompressedSize: number,
    public readonly compressionMethod: number,
    public readonly flags: number,
    public readonly crc32: number,
    private readonly localHeaderOffset: number
  ) {}

  async arrayBuffer(): Promise<Uint8Array> {
    const compressed = this.compressedData();

    if (this.compressionMethod === 0) {
      return compressed.slice();
    }

    if (this.compressionMethod === 8) {
      return inflateRawDeflate(compressed);
    }

    throw new Demo3DUnsupportedError(
      `ZIP entry "${this.name}" uses unsupported compression method ${this.compressionMethod}.`,
      "DEMO3D_ZIP_COMPRESSION_UNSUPPORTED"
    );
  }

  private compressedData(): Uint8Array {
    if ((this.flags & 0x01) !== 0) {
      throw new Demo3DUnsupportedError(
        `ZIP entry "${this.name}" is encrypted, which is not supported.`,
        "DEMO3D_ZIP_ENCRYPTED"
      );
    }

    const offset = this.localHeaderOffset;
    if (readUInt32LE(this.archiveBytes, offset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Demo3DZipError(`ZIP entry "${this.name}" has an invalid local file header.`);
    }

    const fileNameLength = readUInt16LE(this.archiveBytes, offset + 26);
    const extraLength = readUInt16LE(this.archiveBytes, offset + 28);
    const dataOffset = offset + 30 + fileNameLength + extraLength;
    const dataEnd = dataOffset + this.compressedSize;

    if (dataEnd > this.archiveBytes.length) {
      throw new Demo3DZipError(`ZIP entry "${this.name}" extends past the end of the archive.`);
    }

    return sliceBytes(this.archiveBytes, dataOffset, this.compressedSize);
  }
}

export function parseZip(bytes: Uint8Array): ZipArchive {
  const eocdOffset = findEndOfCentralDirectory(bytes);

  const diskNumber = readUInt16LE(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readUInt16LE(bytes, eocdOffset + 6);
  const entryCountOnDisk = readUInt16LE(bytes, eocdOffset + 8);
  const entryCount = readUInt16LE(bytes, eocdOffset + 10);
  const centralDirectorySize = readUInt32LE(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUInt32LE(bytes, eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entryCountOnDisk !== entryCount) {
    throw new Demo3DUnsupportedError("Multi-disk ZIP archives are not supported.", "DEMO3D_ZIP_MULTIDISK");
  }

  if (
    entryCount === ZIP64_SENTINEL_16 ||
    centralDirectorySize === ZIP64_SENTINEL_32 ||
    centralDirectoryOffset === ZIP64_SENTINEL_32
  ) {
    throw new Demo3DUnsupportedError("ZIP64 archives are not supported.", "DEMO3D_ZIP64_UNSUPPORTED");
  }

  if (centralDirectoryOffset + centralDirectorySize > bytes.length) {
    throw new Demo3DZipError("ZIP central directory extends past the end of the archive.");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32LE(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Demo3DZipError(`Invalid ZIP central directory entry at offset ${offset}.`);
    }

    const flags = readUInt16LE(bytes, offset + 8);
    const compressionMethod = readUInt16LE(bytes, offset + 10);
    const crc32 = readUInt32LE(bytes, offset + 16);
    const compressedSize = readUInt32LE(bytes, offset + 20);
    const uncompressedSize = readUInt32LE(bytes, offset + 24);
    const fileNameLength = readUInt16LE(bytes, offset + 28);
    const extraLength = readUInt16LE(bytes, offset + 30);
    const commentLength = readUInt16LE(bytes, offset + 32);
    const localHeaderOffset = readUInt32LE(bytes, offset + 42);

    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw new Demo3DUnsupportedError("ZIP64 entries are not supported.", "DEMO3D_ZIP64_UNSUPPORTED");
    }

    const nameBytes = sliceBytes(bytes, offset + 46, fileNameLength);
    const nameEncoding = (flags & 0x0800) !== 0 ? "utf-8" : "latin1";
    const name = normalizeZipPath(decodeText(nameBytes, nameEncoding));

    entries.push(
      new ZipEntry(
        bytes,
        name,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        flags,
        crc32,
        localHeaderOffset
      )
    );

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return new ZipArchive(bytes, entries);
}

export function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 65_557);

  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32LE(bytes, offset) === EOCD_SIGNATURE) {
      const commentLength = readUInt16LE(bytes, offset + 20);
      if (offset + 22 + commentLength === bytes.length) {
        return offset;
      }
    }
  }

  throw new Demo3DZipError("Could not find ZIP end of central directory.");
}
