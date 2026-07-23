import * as three from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRaw3D } from "../src/index.js";
import { createRaw3DThreeGroup, decodeRaw3DThreeGeometry } from "../src/three/index.js";
import { createZip } from "./helpers.js";

describe("RAW3D support", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
      textIndex: 0,
      interactionMode: 8,
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
    expect(parsed.model.meshes[0]?.meshType).toBe("TriangleList");
    expect(parsed.model.vertexBuffers[0]).toMatchObject({ stride: 32 });
    expect(parsed.model.vertexBuffers[1]).toMatchObject({ stride: 4 });
    expect(parsed.model.vertexBuffers[0]?.data).toHaveLength(96);
    expect(parsed.model.indexBuffers[0]?.data).toHaveLength(6);
    expect(parsed.model.textObjects[0]).toMatchObject({
      value: "Triangle label",
      size: 0.1,
      fontFamily: "Arial",
      materialIndex: 0,
      verticalAlign: 0
    });
    expect(parsed.model.lights[0]).toMatchObject({
      nodeIndex: 10,
      materialIndex: 0,
      enabled: true,
      type: "Directional"
    });
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
    const child = parent.children.find((object) => object.name === "Triangle")!;
    const mesh = child.children.find((object) => object instanceof three.Mesh) as three.Mesh;
    expect(parent.name).toBe("Parent");
    expect(child.name).toBe("Triangle");
    expect(child.position.toArray()).toEqual([1, 2, -3]);
    expect(child.rotation.order).toBe("YXZ");
    expect(mesh.material).toBeInstanceOf(three.MeshStandardMaterial);
    expect((mesh.material as three.MeshStandardMaterial).opacity).toBeCloseTo(0.8);
    expect(child.userData.raw3d).toMatchObject({
      textIndex: 0,
      interactionMode: 8,
      text: { value: "Triangle label" }
    });
    expect(parent.children.some((object) => object instanceof three.DirectionalLight)).toBe(true);
    expect(group.userData.raw3d.stats).toMatchObject({
      nodes: 2,
      meshes: 1,
      geometries: 1,
      textObjects: 1,
      lights: 1
    });
    expect(group.userData.raw3d.warnings).toEqual([]);
  });

  it("decodes ImageBitmap textures with the RAW3D Y orientation", async () => {
    const createBitmap = vi.fn(async () => ({ width: 1, height: 1 }) as ImageBitmap);
    vi.stubGlobal("createImageBitmap", createBitmap);
    const parsed = await parseRaw3D(raw3dFixture(true));

    const group = await createRaw3DThreeGroup(parsed, { three });
    let mesh: three.Mesh | undefined;
    group.traverse((object) => {
      if (object instanceof three.Mesh) {
        mesh = object;
      }
    });
    const material = mesh!.material as three.MeshStandardMaterial;

    expect(createBitmap).toHaveBeenCalledOnce();
    expect(createBitmap.mock.calls[0]).toHaveLength(1);
    expect(material.map).toBeInstanceOf(three.Texture);
    expect(material.map?.flipY).toBe(false);
  });

  it("uses each index buffer's declared element format", async () => {
    const parsed = await parseRaw3D(raw3dFixture(false, true));
    const geometry = decodeRaw3DThreeGeometry(parsed.model.meshes[0]!, parsed.model, three);

    expect(parsed.model.indexBuffers[0]?.format).toBe("Int32");
    expect(parsed.model.indexBuffers[0]?.data).toHaveLength(12);
    expect([...geometry.getIndex()!.array]).toEqual([0, 2, 1]);
  });

  it("renders LineList and PointList primitives without treating them as triangles", async () => {
    const parsed = await parseRaw3D(raw3dPrimitiveFixture());
    const lineGeometry = decodeRaw3DThreeGeometry(parsed.model.meshes[0]!, parsed.model, three);
    expect([...lineGeometry.getIndex()!.array]).toEqual([0, 1]);

    const group = await createRaw3DThreeGroup(parsed, { three });
    const drawables: three.Object3D[] = [];
    group.traverse((object) => {
      if (object instanceof three.LineSegments || object instanceof three.Points) drawables.push(object);
    });
    expect(drawables).toHaveLength(2);
    expect(drawables[0]).toBeInstanceOf(three.LineSegments);
    expect(drawables[1]).toBeInstanceOf(three.Points);
  });
});

function raw3dPrimitiveFixture(): Uint8Array {
  const model = `<Scene><Nodes><Node Index="0" Name="Line" Mesh="0" Materials="0" /><Node Index="1" Name="Points" Mesh="1" Materials="0" /></Nodes><Materials><Material R="1" G="0" B="0" /></Materials><Meshes><Mesh MeshType="LineList" VertexBuffer="0" IndexBuffers="0" /><Mesh MeshType="PointList" VertexBuffer="0" IndexBuffers="0" /></Meshes><VertexBuffers><VertexBuffer Path="v0.dat"><Attribute Usage="Position" /></VertexBuffer></VertexBuffers><IndexBuffers><IndexBuffer Path="i0.dat" /></IndexBuffers></Scene>`;
  return createZip([
    { name: "Model.xml", data: model },
    { name: "v0.dat", data: floatBytes([0, 0, 0, 1, 0, 0]) },
    { name: "i0.dat", data: uint16Bytes([0, 1]) }
  ]);
}

function raw3dFixture(textured = false, int32Indices = false): Uint8Array {
  const model = `<?xml version="1.0" encoding="utf-8"?>
<Scene Origin="Demo3D, Version=18.3.0.53">
  <Views><View Name="Default View" Position="5 4 3" Target="0 0 0" /></Views>
  <Nodes>
    <Node Index="10" Name="Parent" CustomAttributes="UID|parent-id|" />
    <Node Index="11" Name="Triangle" Parent="10" Mesh="0" Layer="0" Materials="0" Text="0" InteractionMode="8" CustomAttributes="UID|child-id|" Location="1 2 3" Rotation="0.1 0.2 0.3" />
  </Nodes>
  <Layers><Layer Name="Main" Material="0" /></Layers>
  <Materials><Material R="0.25" G="0.5" B="0.75" A="0.2" Reflectivity="0.4"${textured ? " Texture=\"0\"" : ""} /></Materials>
  <Textures>${textured ? '<Texture Path="t0.png" />' : ""}</Textures>
  <Meshes><Mesh VertexBuffer="0" IndexBuffers="0"><Bones /></Mesh></Meshes>
  <VertexBuffers>
    <VertexBuffer Path="v0.dat"><Attribute Usage="Position" /><Attribute Usage="Normal" /><Attribute Usage="Texture" Type="Vector2" /></VertexBuffer>
    <VertexBuffer Path="v1.dat"><Attribute Usage="Texture" Type="Single" /></VertexBuffer>
  </VertexBuffers>
  <IndexBuffers><IndexBuffer Path="i0.dat"${int32Indices ? ' Format="Int32"' : ""} /></IndexBuffers>
  <TextObjects><Text Value="Triangle label" Size="0.1" Material="0" VerticalAlign="0" StartPosition="0 0 0" EndPosition="1 0 0" /></TextObjects>
  <Lights><Light Node="10" Material="0" Enabled="true" Type="Directional" AttenuationConstant="1" /></Lights>
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
    { name: "v1.dat", data: floatBytes([0.5]) },
    { name: "i0.dat", data: int32Indices ? uint32Bytes([0, 1, 2]) : uint16Bytes([0, 1, 2]) },
    ...(textured ? [{ name: "t0.png", data: new Uint8Array([137, 80, 78, 71]) }] : [])
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

function uint32Bytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}
