import * as three from "three";
import { describe, expect, it } from "vitest";
import { parseRaw3D } from "../src/index.js";
import { createRaw3DThreeGroup, decodeRaw3DThreeGeometry } from "../src/three/index.js";
import { createZip } from "./helpers.js";

describe("RAW3D support", () => {
  it("parses the render-ready scene and its external buffers", async () => {
    const parsed = await parseRaw3D(raw3dFixture());

    expect(parsed.modelEntryName).toBe("Model.xml");
    expect(parsed.model.origin).toContain("Demo3D");
    expect(parsed.model.nodes).toHaveLength(2);
    expect(parsed.model.nodes[1]).toMatchObject({
      index: 11,
      parentIndex: 10,
      meshIndex: 0,
      materialIndices: [0],
      location: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3]
    });
    expect(parsed.model.nodes[1]?.customAttributes.get("UID")).toBe("child-id");
    expect(parsed.model.materials[0]).toMatchObject({
      red: 0.25,
      green: 0.5,
      blue: 0.75,
      transparency: 0.2
    });
    expect(parsed.model.meshes[0]).toMatchObject({ vertexBufferIndex: 0, indexBufferIndices: [0] });
    expect(parsed.model.vertexBuffers[0]).toMatchObject({ stride: 32 });
    expect(parsed.model.vertexBuffers[0]?.data).toHaveLength(96);
    expect(parsed.model.indexBuffers[0]?.data).toHaveLength(6);
  });

  it("decodes RAW3D geometry, hierarchy, transforms, and materials for Three.js", async () => {
    const parsed = await parseRaw3D(raw3dFixture());
    const geometry = decodeRaw3DThreeGeometry(parsed.model.meshes[0]!, parsed.model, three);

    expect([...geometry.getAttribute("position").array]).toEqual([
      0, 0, -1,
      1, 0, -1,
      0, 1, -1
    ]);
    expect([...geometry.getIndex()!.array]).toEqual([0, 2, 1]);
    expect(geometry.groups).toEqual([{ start: 0, count: 3, materialIndex: 0 }]);

    const group = await createRaw3DThreeGroup(parsed, { three });
    const parent = group.children[0]!;
    const child = parent.children[0]!;
    const mesh = child.children[0] as three.Mesh;
    expect(parent.name).toBe("Parent");
    expect(child.name).toBe("Triangle");
    expect(child.position.toArray()).toEqual([1, 2, -3]);
    expect(child.rotation.order).toBe("YXZ");
    expect(mesh.material).toBeInstanceOf(three.MeshStandardMaterial);
    expect((mesh.material as three.MeshStandardMaterial).opacity).toBeCloseTo(0.8);
    expect(group.userData.raw3d.stats).toMatchObject({ nodes: 2, meshes: 1, geometries: 1 });
    expect(group.userData.raw3d.warnings).toEqual([]);
  });
});

function raw3dFixture(): Uint8Array {
  const model = `<?xml version="1.0" encoding="utf-8"?>
<Scene Origin="Demo3D, Version=18.3.0.53">
  <Views><View Name="Default View" Position="5 4 3" Target="0 0 0" /></Views>
  <Nodes>
    <Node Index="10" Name="Parent" CustomAttributes="UID|parent-id|" />
    <Node Index="11" Name="Triangle" Parent="10" Mesh="0" Layer="0" Materials="0" CustomAttributes="UID|child-id|" Location="1 2 3" Rotation="0.1 0.2 0.3" />
  </Nodes>
  <Layers><Layer Name="Main" Material="0" /></Layers>
  <Materials><Material R="0.25" G="0.5" B="0.75" A="0.2" Reflectivity="0.4" /></Materials>
  <Textures />
  <Meshes><Mesh VertexBuffer="0" IndexBuffers="0"><Bones /></Mesh></Meshes>
  <VertexBuffers><VertexBuffer Path="v0.dat"><Attribute Usage="Position" /><Attribute Usage="Normal" /><Attribute Usage="Texture" Type="Vector2" /></VertexBuffer></VertexBuffers>
  <IndexBuffers><IndexBuffer Path="i0.dat" /></IndexBuffers>
</Scene>`;
  return createZip([
    { name: "Thumbnail.png", data: new Uint8Array([1, 2, 3]) },
    { name: "Model.xml", data: model, method: 8 },
    { name: "Aspects.json", data: "{}" },
    { name: "v0.dat", data: floatBytes([
      0, 0, 1, 0, 0, 1, 0, 0,
      1, 0, 1, 0, 0, 1, 1, 0,
      0, 1, 1, 0, 0, 1, 0, 1
    ]), method: 8 },
    { name: "i0.dat", data: uint16Bytes([0, 1, 2]) }
  ]);
}

function floatBytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

function uint16Bytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}
