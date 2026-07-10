import { describe, expect, it } from "vitest";
import * as three from "three";
import { parseDemo3D } from "../src/index.js";
import {
  createDemo3DThreeGroup,
  decodeDemo3DThreeGeometry,
  createDemo3DThreeMaterial
} from "../src/three/index.js";
import { createZip, demo3dXmlFixture, parseXml } from "./helpers.js";

describe("Three renderer adapter", () => {
  it("converts parsed Demo3D meshes into Three geometry", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture }]), { parseXml });

    const geometry = decodeDemo3DThreeGeometry(parsed.model.meshes[0]!, three);

    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(geometry.index?.count).toBeGreaterThan(0);
    expect(Array.from(geometry.index!.array.slice(0, 3))).toEqual([0, 2, 1]);
  });

  it("converts Demo3D diffuse colors into Three materials", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture }]), { parseXml });
    const source = parsed.model.visuals[0]!.materials[0];
    const material = createDemo3DThreeMaterial(source, three) as three.MeshStandardMaterial;

    expect(source?.diffuse).toBe(-16744448);
    expect(material.type).toBe("MeshStandardMaterial");
    expect(material.color.getHex()).toBe(0x008000);
  });

  it("creates a Three object hierarchy without importing Three from the parser root", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture }]), { parseXml });

    const group = await createDemo3DThreeGroup(parsed, { three, includeSerializedRenderables: false });

    expect(group.type).toBe("Group");
    expect(group.userData.demo3d.stats.meshes).toBeGreaterThan(0);
    expect(group.userData.demo3d.stats.groups).toBeGreaterThan(0);
    expect(JSON.stringify(group.userData.demo3d.warnings)).not.toContain("DEMO3D_THREE_MISSING_MESH");
  });

  it("places serialized renderer aspects through visual AS links", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: aspectLinkedXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });
    const visual = group.children[0]!;
    const renderable = visual.children[0]!;

    expect(group.userData.demo3d.stats.meshes).toBe(1);
    expect(group.userData.demo3d.stats.serializedRenderables).toBe(1);
    expect(group.userData.demo3d.stats.unsupported).toBe(0);
    expect(visual.position.toArray()).toEqual([1, 2, -3]);
    expect(visual.rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(renderable.userData.demo3d.aspectType).toBe("e3d:CylinderRendererAspect");
  });

  it("creates renderable objects for TextVisual entries", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: textVisualXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });
    const visual = group.children[0]!;
    const text = visual.children[0]!;

    expect(group.userData.demo3d.stats.textVisuals).toBe(1);
    expect(group.userData.demo3d.stats.meshes).toBe(1);
    expect(visual.userData.demo3d.kind).toBe("visual");
    expect(text.userData.demo3d.kind).toBe("text");
    expect(text.userData.demo3d.text).toBe("Hello Demo3D");
    expect((text as three.Mesh).geometry.getAttribute("normal").getZ(0)).toBe(-1);
    expect(Array.from((text as three.Mesh).geometry.index!.array.slice(0, 3))).toEqual([0, 1, 2]);
  });

  it("renders XML DrawingBlock BREP lines for PrimitivesVisual entries", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: drawingBlockXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });
    const visual = group.children[0]!;
    const drawing = visual.children[0]!;

    expect(group.userData.demo3d.stats.drawingBlocks).toBe(1);
    expect(group.userData.demo3d.stats.lines).toBe(1);
    expect(drawing.type).toBe("LineSegments");
    expect(drawing.userData.demo3d.blockId).toBe("block-1");
  });

  it("renders buffer-backed DrawingBlock lines from package Buffers_MD entries", async () => {
    const parsed = await parseDemo3D(
      createZip([
        { name: "fixture.demo3d", data: bufferDrawingBlockXmlFixture },
        { name: "Buffers_MD/buffer-lines", data: float32Bytes([0, 0, 0, 1, 0, 0]) }
      ]),
      { parseXml }
    );

    const group = await createDemo3DThreeGroup(parsed, { three });
    const visual = group.children[0]!;
    const drawing = visual.children[0]!;

    expect(group.userData.demo3d.stats.drawingBlocks).toBe(1);
    expect(group.userData.demo3d.stats.lines).toBe(1);
    expect(drawing.type).toBe("LineSegments");
    expect(drawing.userData.demo3d.blockId).toBe("block-buffer");
  });

  it("renders direct primitive visual geometry and applies visual scale", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: directVisualXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });
    const visual = group.children[0]!;
    const box = visual.children[0]!;

    expect(group.userData.demo3d.stats.directVisuals).toBe(1);
    expect(box.userData.demo3d.kind).toBe("direct-visual");
    expect(visual.scale.toArray()).toEqual([2, 3, 4]);
  });

  it("renders Demo3D light visuals as Three lights", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: lightVisualXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });
    const visual = group.children[0]!;
    const light = visual.children[0]!;

    expect(group.userData.demo3d.stats.lights).toBe(1);
    expect(light.type).toBe("DirectionalLight");
    expect(light.userData.demo3d.kind).toBe("light");
  });

  it("draws diagnostic placeholders for missing mesh references by default", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: missingMeshXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });
    const visual = group.children[0]!;
    const placeholder = visual.children[0]!;

    expect(group.userData.demo3d.stats.missingGeometryPlaceholders).toBe(1);
    expect(group.userData.demo3d.stats.unsupported).toBe(1);
    expect(placeholder.userData.demo3d.kind).toBe("missing-geometry-placeholder");
    expect(placeholder.userData.demo3d.meshReferenceId).toBe("missing-mesh");
  });

  it("can suppress missing mesh placeholders for strict geometry-only rendering", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: missingMeshXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three, showPlaceholders: false });

    expect(group.userData.demo3d.stats.missingGeometryPlaceholders).toBe(0);
    expect(group.userData.demo3d.stats.unsupported).toBe(1);
  });
});

const aspectLinkedXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:Visual">
      <Id>visual-1</Id>
      <N>Roller Visual</N>
      <LR>1|2|3||1.5707963267948966|</LR>
      <AS><E>aspect-1</E></AS>
    </e>
  </C>
  <SerializedObjects>
    <E xsi:type="e3d:CylinderRendererAspect">
      <Id>aspect-1</Id>
      <Renderables>
        <E>
          <Id>renderable-1</Id>
          <Length>2</Length>
          <Radius>0.25</Radius>
          <RadiusRatio>1</RadiusRatio>
          <ConeRatio>1</ConeRatio>
          <Slices>12</Slices>
          <Angle>360</Angle>
          <StartAngle>0</StartAngle>
          <MaterialProperties>
            <e>
              <MeshMaterial xsi:type="e3d:MeshMaterial">
                <Diffuse>-16744448</Diffuse>
              </MeshMaterial>
            </e>
          </MaterialProperties>
          <MeshReference><Id>primitive-cylinder-template</Id></MeshReference>
        </E>
      </Renderables>
    </E>
  </SerializedObjects>
</e3d:Demo3DProject>`;

const bufferDrawingBlockXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <DrawingBlockLibrary>
    <Blocks>
      <e xsi:type="e3d:DictionaryEntry">
        <key xsi:type="e3d:DrawingBlockReference">block-buffer</key>
        <val xsi:type="e3d:DB">
          <Name>buffer-lines</Name>
        </val>
      </e>
    </Blocks>
  </DrawingBlockLibrary>
  <C>
    <e xsi:type="e3d:PrimitivesVisual">
      <Id>primitive-buffer</Id>
      <N>Primitive Buffer</N>
      <P xsi:type="e3d:DrawingBlockProperties">
        <DrawingBlockRef>block-buffer</DrawingBlockRef>
        <Materials>
          <MeshMaterials>
            <e xsi:type="e3d:MeshMaterial">
              <Diffuse>-16777216</Diffuse>
            </e>
          </MeshMaterials>
        </Materials>
      </P>
    </e>
  </C>
</e3d:Demo3DProject>`;

function float32Bytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

const directVisualXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:BoxVisual">
      <Id>box-visual</Id>
      <N>Box</N>
      <P xsi:type="e3d:BoxProperties">
        <Width>1</Width>
        <Height>2</Height>
        <Depth>3</Depth>
        <Scale>2|3|4</Scale>
        <Material>
          <MeshMaterial xsi:type="e3d:MeshMaterial">
            <Diffuse>-16777216</Diffuse>
          </MeshMaterial>
        </Material>
      </P>
    </e>
  </C>
</e3d:Demo3DProject>`;

const lightVisualXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:LightVisual">
      <Id>light-visual</Id>
      <N>Light</N>
      <P xsi:type="e3d:LightProperties">
        <Diffuse>-1</Diffuse>
        <LightType>Directional</LightType>
      </P>
    </e>
  </C>
</e3d:Demo3DProject>`;

const missingMeshXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:Visual">
      <Id>missing-visual</Id>
      <N>Missing Mesh Visual</N>
      <P xsi:type="e3d:VisualProperties">
        <Mesh><Id>missing-mesh</Id></Mesh>
        <Material>
          <MeshMaterial xsi:type="e3d:MeshMaterial">
            <Diffuse>-16711681</Diffuse>
          </MeshMaterial>
        </Material>
      </P>
    </e>
  </C>
</e3d:Demo3DProject>`;

const drawingBlockXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <DrawingBlockLibrary>
    <Blocks>
      <e xsi:type="e3d:DictionaryEntry">
        <key xsi:type="e3d:DrawingBlockReference">block-1</key>
        <val xsi:type="e3d:DB">
          <Name>block-1</Name>
          <BREP>
            <E xsi:type="Demo3D.BREP.Line">
              <C>0 0 0|1 0 0|</C>
            </E>
          </BREP>
        </val>
      </e>
    </Blocks>
  </DrawingBlockLibrary>
  <C>
    <e xsi:type="e3d:PrimitivesVisual">
      <Id>primitive-1</Id>
      <N>Primitive</N>
      <P xsi:type="e3d:DrawingBlockProperties">
        <DrawingBlockRef>block-1</DrawingBlockRef>
        <Materials>
          <MeshMaterials>
            <e xsi:type="e3d:MeshMaterial">
              <Diffuse>-16777216</Diffuse>
            </e>
          </MeshMaterials>
        </Materials>
      </P>
    </e>
  </C>
</e3d:Demo3DProject>`;

const textVisualXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:TextVisual">
      <Id>text-visual-1</Id>
      <N>Label</N>
      <LR>1|2|3|1.5707963267948966||</LR>
      <P xsi:type="e3d:TextProperties">
        <Bold>1</Bold>
        <FontFamily>sans-serif</FontFamily>
        <HorizontalAlign>Left</HorizontalAlign>
        <LineHeight>0.05</LineHeight>
        <Material>
          <MeshMaterial xsi:type="e3d:MeshMaterial">
            <Diffuse>-1</Diffuse>
          </MeshMaterial>
        </Material>
        <Text>Hello Demo3D</Text>
        <VerticalAlign>Center</VerticalAlign>
      </P>
    </e>
  </C>
</e3d:Demo3DProject>`;
