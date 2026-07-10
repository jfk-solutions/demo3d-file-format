import { describe, expect, it } from "vitest";
import * as three from "three";
import { parseDemo3D } from "../src/index.js";
import {
  createDemo3DThreeGroup,
  decodeDemo3DThreeGeometry,
  createDemo3DThreeMaterial
} from "../src/three/index.js";
import {
  annularCylinderXmlFixture,
  createZip,
  demo3dXmlFixture,
  generatedObjectsXmlFixture,
  parseXml,
  rollerAspectConveyorXmlFixture,
  supportStandXmlFixture
} from "./helpers.js";

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

  it("combines ARGB alpha, transparency, and reflectivity", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: alphaMaterialXmlFixture }]), {
      parseXml
    });
    const partial = createDemo3DThreeMaterial(parsed.model.visuals[0]?.materials[0], three) as three.MeshStandardMaterial;
    const invisible = createDemo3DThreeMaterial(parsed.model.visuals[1]?.materials[0], three) as three.MeshStandardMaterial;

    expect(partial.opacity).toBeCloseTo((128 / 255) * 0.75);
    expect(partial.transparent).toBe(true);
    expect(partial.depthWrite).toBe(false);
    expect(partial.roughness).toBeCloseTo(0.525);
    expect(invisible.opacity).toBe(0);
    expect(invisible.transparent).toBe(true);
  });

  it("creates a Three object hierarchy without importing Three from the parser root", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture }]), { parseXml });

    const group = await createDemo3DThreeGroup(parsed, { three, includeSerializedRenderables: false });

    expect(group.type).toBe("Group");
    expect(group.userData.demo3d.stats.meshes).toBeGreaterThan(0);
    expect(group.userData.demo3d.stats.groups).toBeGreaterThan(0);
    expect(group.children[0]?.userData.demo3d.layer).toBe("Main");
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

  it("renders procedural straight belts only when explicitly enabled", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: straightBeltXmlFixture }]), {
      parseXml
    });

    const disabled = await createDemo3DThreeGroup(parsed, { three });
    const enabled = await createDemo3DThreeGroup(parsed, { three, renderProceduralBelts: true });
    const visual = enabled.children[0]!;
    const belt = visual.children[0] as three.Mesh;
    belt.geometry.computeBoundingBox();

    expect(disabled.userData.demo3d.stats.proceduralBelts).toBe(0);
    expect(enabled.userData.demo3d.stats.proceduralBelts).toBe(1);
    expect(belt.userData.demo3d.kind).toBe("procedural-belt");
    expect(belt.geometry.boundingBox?.min.x).toBeCloseTo(0);
    expect(belt.geometry.boundingBox?.min.y).toBeCloseTo(-0.1);
    expect(belt.geometry.boundingBox?.min.z).toBeCloseTo(-0.25);
    expect(belt.geometry.boundingBox?.max.x).toBeCloseTo(2);
    expect(belt.geometry.boundingBox?.max.y).toBeCloseTo(0);
    expect(belt.geometry.boundingBox?.max.z).toBeCloseTo(0.25);
    expect((belt.material as three.Material[]).length).toBe(2);
    expect(((belt.material as three.Material[])[0] as three.MeshStandardMaterial).color.getHex()).toBe(0x808080);
    expect(((belt.material as three.Material[])[1] as three.MeshStandardMaterial).color.getHex()).toBe(0xc0c0c0);
  });

  it("renders profile-based support stands only when explicitly enabled", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: supportStandXmlFixture }]), {
      parseXml
    });
    const disabled = await createDemo3DThreeGroup(parsed, { three });
    const enabled = await createDemo3DThreeGroup(parsed, { three, renderProceduralSupportStands: true });
    let support: three.Object3D | undefined;
    enabled.traverse((object) => {
      if (object.userData.demo3d?.kind === "procedural-support-stand") {
        support = object;
      }
    });

    expect(disabled.userData.demo3d.stats.proceduralSupportStands).toBe(0);
    expect(enabled.userData.demo3d.stats.proceduralSupportStands).toBe(1);
    expect(support).toBeDefined();
    expect(support?.children).toHaveLength(9);
    const bounds = new three.Box3().setFromObject(support!);
    const size = bounds.getSize(new three.Vector3());
    expect(size.y).toBeGreaterThan(1.1);
    expect(size.z).toBeGreaterThan(0.5);
    expect(support?.userData.demo3d).toMatchObject({
      span: 0.5,
      braceHeights: [0.4, 0.8]
    });
    expect(support?.userData.demo3d.supportHeight).toBeCloseTo(1.2);
  });

  it("renders the remaining generated conveyor families behind explicit options", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: generatedObjectsXmlFixture }]),
      { parseXml }
    );
    const disabled = await createDemo3DThreeGroup(parsed, { three });
    const enabled = await createDemo3DThreeGroup(parsed, {
      three,
      renderProceduralConveyorSides: true,
      renderProceduralPhotoEyes: true,
      renderProceduralRollers: true,
      renderProceduralMotors: true,
      renderDimensions: true
    });
    const stats = enabled.userData.demo3d.stats;
    const generatedKinds = new Set<string>();
    let conveyorSide: three.Mesh | undefined;
    enabled.traverse((object) => {
      const kind = object.userData.demo3d?.kind;
      if (kind) {
        generatedKinds.add(kind);
      }
      if (kind === "procedural-conveyor-side") {
        conveyorSide = object as three.Mesh;
      }
    });

    expect(disabled.userData.demo3d.stats.proceduralConveyorSides).toBe(0);
    expect(disabled.userData.demo3d.stats.proceduralPhotoEyes).toBe(0);
    expect(disabled.userData.demo3d.stats.proceduralRollers).toBe(0);
    expect(disabled.userData.demo3d.stats.proceduralMotors).toBe(0);
    expect(disabled.userData.demo3d.stats.dimensions).toBe(0);
    expect(stats.proceduralConveyorSides).toBe(2);
    expect(stats.proceduralPhotoEyes).toBe(1);
    expect(stats.proceduralRollers).toBe(8);
    expect(stats.proceduralMotors).toBe(1);
    expect(stats.dimensions).toBe(1);
    expect(generatedKinds.has("procedural-conveyor-side")).toBe(true);
    expect(generatedKinds.has("procedural-photo-eye")).toBe(true);
    expect(generatedKinds.has("procedural-roller")).toBe(true);
    expect(generatedKinds.has("procedural-conveyor-motor")).toBe(true);
    expect(generatedKinds.has("dimension")).toBe(true);
    expect(Array.isArray(conveyorSide?.material)).toBe(true);
    expect((conveyorSide?.material as three.Material[])).toHaveLength(4);
    expect(conveyorSide?.geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2, 3, 0]);
  });

  it("does not duplicate rollers when serialized cylinder aspects exist", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: rollerAspectConveyorXmlFixture }]),
      { parseXml }
    );
    const group = await createDemo3DThreeGroup(parsed, { three, renderProceduralRollers: true });

    expect(group.userData.demo3d.stats.proceduralRollers).toBe(0);
    expect(group.userData.demo3d.stats.serializedRenderables).toBe(1);
  });

  it("keeps InnerRadius holes in partial cylinder renderables", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: annularCylinderXmlFixture }]),
      { parseXml }
    );
    const group = await createDemo3DThreeGroup(parsed, { three });
    let ring: three.Mesh | undefined;
    group.traverse((object) => {
      if (object.userData.demo3d?.renderableId === "ring-renderable") {
        ring = object as three.Mesh;
      }
    });
    const position = ring?.geometry.getAttribute("position");
    const radii = Array.from({ length: position?.count ?? 0 }, (_, index) =>
      Math.hypot(position!.getX(index), position!.getZ(index))
    );

    expect(ring).toBeDefined();
    expect(position?.count).toBeGreaterThan(100);
    expect(Math.min(...radii)).toBeCloseTo(0.75, 5);
    expect(Math.max(...radii)).toBeCloseTo(1, 5);
  });

  it("diagnoses script visuals that do not contain reconstructable geometry", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: unreconstructableScriptVisualXmlFixture }]),
      { parseXml }
    );
    const quiet = await createDemo3DThreeGroup(parsed, { three });
    const diagnostic = await createDemo3DThreeGroup(parsed, { three, includeUnsupported: true });

    expect(quiet.userData.demo3d.stats.unreconstructedProceduralVisuals).toBe(0);
    expect(diagnostic.userData.demo3d.stats.unreconstructedProceduralVisuals).toBe(1);
    expect(diagnostic.userData.demo3d.warnings).toEqual([
      expect.objectContaining({ code: "DEMO3D_THREE_UNRECONSTRUCTABLE_SCRIPT_VISUAL" })
    ]);
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

const alphaMaterialXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:BoxVisual"><Id>partial</Id><N>Partial</N><P><Material><MeshMaterial xsi:type="e3d:MeshMaterial">
      <Diffuse>-2130706433</Diffuse><Transparency>0.25</Transparency><Reflectivity>0.5</Reflectivity>
    </MeshMaterial></Material></P></e>
    <e xsi:type="e3d:BoxVisual"><Id>invisible</Id><N>Invisible</N><P><Material><MeshMaterial xsi:type="e3d:MeshMaterial">
      <Diffuse>16777215</Diffuse>
    </MeshMaterial></Material></P></e>
  </C>
</e3d:Demo3DProject>`;

const unreconstructableScriptVisualXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="Vendor.GeneratedVisual"><Id>generated-1</Id><N>Vendor generated object</N>
    <P xsi:type="Vendor.CustomScriptProperties"><ScriptName>BuildGeometry</ScriptName></P>
  </e></C>
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

const straightBeltXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:StraightBeltConveyor">
      <Id>belt-visual</Id>
      <N>Belt</N>
      <P xsi:type="e3d:StraightBeltConveyorProperties">
        <BeltLength>2</BeltLength>
        <BeltWidth>0.5</BeltWidth>
        <BeltDiameter>0.1</BeltDiameter>
        <BeltCenterHeight>0.1</BeltCenterHeight>
        <BeltCapStart>Box</BeltCapStart>
        <BeltCapEnd>Box</BeltCapEnd>
        <SurfaceMaterial>
          <MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-8355712</Diffuse></MeshMaterial>
        </SurfaceMaterial>
        <SurfaceSideMaterial>
          <MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-4144960</Diffuse></MeshMaterial>
        </SurfaceSideMaterial>
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
