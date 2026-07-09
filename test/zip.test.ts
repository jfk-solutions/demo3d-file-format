import { describe, expect, it } from "vitest";
import { Demo3DUnsupportedError, parseZip } from "../src/index.js";
import { createZip } from "./helpers.js";

describe("parseZip", () => {
  it("reads stored entries from the central directory", async () => {
    const archive = parseZip(createZip([{ name: "folder\\hello.txt", data: "hello" }]));

    expect(archive.entries).toHaveLength(1);
    expect(archive.entries[0]?.name).toBe("folder/hello.txt");
    await expect(archive.entries[0]?.arrayBuffer()).resolves.toEqual(new TextEncoder().encode("hello"));
  });

  it("inflates raw DEFLATE entries with DecompressionStream", async () => {
    const archive = parseZip(createZip([{ name: "compressed.txt", data: "compressed data", method: 8 }]));

    const data = await archive.entries[0]!.arrayBuffer();

    expect(new TextDecoder().decode(data)).toBe("compressed data");
  });

  it("rejects encrypted entries clearly", async () => {
    const archive = parseZip(createZip([{ name: "secret.txt", data: "nope", flags: 0x0801 }]));

    await expect(archive.entries[0]!.arrayBuffer()).rejects.toBeInstanceOf(Demo3DUnsupportedError);
  });

  it("rejects invalid archives", () => {
    expect(() => parseZip(new Uint8Array([1, 2, 3]))).toThrow("Could not find ZIP end of central directory");
  });
});
