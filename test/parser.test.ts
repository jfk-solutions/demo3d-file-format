import { describe, expect, it } from "vitest";
import { parseDemo3D } from "../src/index.js";
import { createZip, demo3dXmlFixture, parseXml } from "./helpers.js";

describe("parseDemo3D", () => {
  it("parses a Demo3D package into a typed object model", async () => {
    const archive = createZip([
      { name: "Thumbnail.png", data: new Uint8Array([1, 2, 3]) },
      { name: "Buffers_MD/buffer-1", data: new Uint8Array([4, 5, 6]), method: 8 },
      { name: "fixture.demo3d", data: demo3dXmlFixture, method: 8 }
    ]);

    const parsed = await parseDemo3D(archive, { parseXml });

    expect(parsed.modelEntryName).toBe("fixture.demo3d");
    expect(parsed.thumbnail?.path).toBe("Thumbnail.png");
    expect(parsed.buffers).toHaveLength(1);
    expect(parsed.model.header.product).toBe("Demo3D");
    expect(parsed.model.header.version).toBe("18.3.0.53");
    expect(parsed.model.meshes).toHaveLength(1);
    expect(parsed.model.meshes[0]?.id).toBe("mesh-1");
    expect(parsed.model.meshes[0]?.meshFormat).toBe("TriangleList");
    expect(parsed.model.meshes[0]?.vertices?.toUint8Array().byteLength).toBe(72);
    expect(parsed.model.visuals).toHaveLength(1);
    expect(parsed.model.visuals[0]?.id).toBe("visual-1");
    expect(parsed.model.visuals[0]?.displayName).toBe("Box 1");
    expect(parsed.model.visuals[0]?.materials[0]?.textureReference).toBe("texture-1");
    expect(parsed.model.visuals[0]?.localTransform).toEqual([1, 2, 3]);
    expect(parsed.model.visuals[0]?.children).toHaveLength(1);
    expect(parsed.model.unknownTypes.get("Vendor.CustomThing")).toBe(1);
  });

  it("preserves raw XML shape for unknown objects", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture }]), { parseXml });
    const unknown = parsed.model.typedObjects.find((object) => object.typeName === "Vendor.CustomThing");

    expect(unknown?.xml.localName).toBe("VendorThing");
    expect(unknown?.xml.child("Value")?.value).toBe(42);
  });
});
