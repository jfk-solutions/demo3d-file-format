import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDemo3D } from "../src/index.js";
import { parseXml } from "./helpers.js";

const benchmarkPath = "C:/Program Files (x86)/Emulate3D 2025/Benchmark/Graphics.demo3d";
const suppliedPath = "D:/5801704_DE40_Kardex_Bauhaus_REV07neu3.demo3d";

describe("installed Demo3D files", () => {
  it.skipIf(!existsSync(benchmarkPath))("parses the installed Graphics benchmark project", async () => {
    const parsed = await parseDemo3D(readFileSync(benchmarkPath), { parseXml });

    expect(parsed.modelEntryName.toLowerCase()).toBe("graphics.demo3d");
    expect(parsed.thumbnail).toBeDefined();
    expect(parsed.model.header.product).toContain("Demo3D");
    expect(parsed.model.meshes.length).toBeGreaterThan(0);
    expect(parsed.model.typedObjects.length).toBeGreaterThan(0);
  });

  it.skipIf(!existsSync(suppliedPath))("parses the supplied project without fatal unknown-type failures", async () => {
    const parsed = await parseDemo3D(readFileSync(suppliedPath));

    expect(parsed.modelEntryName.toLowerCase()).toContain(".demo3d");
    expect(parsed.thumbnail).toBeDefined();
    expect(parsed.buffers.length).toBeGreaterThan(0);
    expect(parsed.model.header.product).toContain("Demo3D");
    expect(parsed.model.meshes.length).toBeGreaterThan(0);
    expect(parsed.model.typedObjects.length).toBeGreaterThan(0);
    expect(parsed.model.unknownTypes.size).toBeGreaterThan(0);
  });
});
