import { afterEach, describe, expect, it, vi } from "vitest";
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
  demo3d2026Fixture,
  demo3dXmlFixture,
  generatedObjectsXmlFixture,
  parseXml,
  rollerAspectConveyorXmlFixture,
  supportStandXmlFixture
} from "./helpers.js";

describe("Three renderer adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Demo3D 2026 external mesh-cache geometry", async () => {
    const parsed = await parseDemo3D(demo3d2026Fixture());
    const group = await createDemo3DThreeGroup(parsed, { three });

    expect(group.userData.demo3d.stats).toMatchObject({
      meshes: 1,
      geometries: 1,
      serializedRenderables: 1,
      missingGeometryPlaceholders: 0
    });
    const bounds = new three.Box3().setFromObject(group);
    expect(bounds.isEmpty()).toBe(false);
  });

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

  it("respects hidden layers while allowing child layer overrides", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: hiddenLayerXmlFixture }]),
      { parseXml }
    );
    const visibleOnly = await createDemo3DThreeGroup(parsed, { three });
    const withHidden = await createDemo3DThreeGroup(parsed, { three, includeHiddenLayers: true });
    const visibleNames: string[] = [];
    visibleOnly.traverse((object) => {
      if ((object as three.Mesh).isMesh) {
        visibleNames.push(object.parent?.name ?? object.name);
      }
    });

    expect(visibleOnly.userData.demo3d.stats.meshes).toBe(1);
    expect(visibleNames).toEqual(["Visible child"]);
    expect(withHidden.userData.demo3d.stats.meshes).toBe(3);
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

  it("assigns serialized material slots to mesh face subsets", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: multiMaterialMeshAspectXmlFixture }]),
      { parseXml }
    );

    const group = await createDemo3DThreeGroup(parsed, { three });
    let renderable: three.Mesh | undefined;
    group.traverse((object) => {
      if (object.userData.demo3d?.renderableId === "subset-renderable") {
        renderable = object as three.Mesh;
      }
    });

    expect(group.userData.demo3d.stats.serializedRenderables).toBe(1);
    expect(renderable).toBeDefined();
    expect(renderable!.material).toBeInstanceOf(Array);
    const materials = renderable!.material as three.MeshStandardMaterial[];
    expect(materials).toHaveLength(2);
    expect(materials.map((material) => material.color.getHex())).toEqual([0xff0000, 0x00ff00]);
    expect(renderable!.geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 }
    ]);
  });

  it("does not render serialized aspects that Demo3D marks as disabled", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: disabledAspectXmlFixture }]),
      { parseXml }
    );

    const group = await createDemo3DThreeGroup(parsed, { three, includeUnsupported: true });

    expect(group.userData.demo3d.stats.meshes).toBe(0);
    expect(group.userData.demo3d.stats.serializedRenderables).toBe(0);
    expect(group.userData.demo3d.stats.unsupported).toBe(0);
    expect(group.userData.demo3d.warnings).toEqual([]);
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

    const position = (box as three.Mesh).geometry.getAttribute("position");
    const normal = (box as three.Mesh).geometry.getAttribute("normal");
    const uv = (box as three.Mesh).geometry.getAttribute("uv");
    const frontFace = Array.from({ length: position.count }, (_, index) => index)
      .filter((index) => normal.getZ(index) > 0.5)
      .map((index) => ({
        x: position.getX(index),
        y: position.getY(index),
        u: uv.getX(index),
        v: uv.getY(index)
      }));
    expect(frontFace.find((vertex) => vertex.x < 0 && vertex.y > 0)).toMatchObject({ u: 0, v: 1 });
    expect(frontFace.find((vertex) => vertex.x > 0 && vertex.y > 0)).toMatchObject({ u: 1, v: 1 });
    expect(frontFace.find((vertex) => vertex.x < 0 && vertex.y < 0)).toMatchObject({ u: 0, v: 0 });
  });

  it("uses TextureLoader's Y flip for Demo3D texture images", async () => {
    const loadedTexture = new three.Texture();
    const load = vi.fn(() => loadedTexture);
    class TestTextureLoader {
      load(url: string): three.Texture {
        return load(url);
      }
    }
    vi.stubGlobal("document", {});
    const threeWithTextureLoader = {
      ...three,
      TextureLoader: TestTextureLoader
    } as unknown as typeof three;
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: texturedDirectVisualXmlFixture }]),
      { parseXml }
    );

    const group = await createDemo3DThreeGroup(parsed, { three: threeWithTextureLoader });
    const box = group.children[0]?.children[0] as three.Mesh;
    const material = box.material as three.MeshStandardMaterial;

    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0]?.[0]).toContain("data:image/png;base64,");
    expect(material.map).toBe(loadedTexture);
    expect(material.map?.flipY).toBe(true);
  });

  it("renders point-cloud buffers and sphere visuals", async () => {
    const parsed = await parseDemo3D(createZip([
      { name: "fixture.demo3d", data: pointCloudAndSphereXmlFixture },
      { name: "Buffers_MD/points.bin", data: float32Bytes([1, 2, 3, -1, 0, -2]) }
    ]), { parseXml });
    const group = await createDemo3DThreeGroup(parsed, { three });
    let points: three.Points | undefined;
    let sphere: three.Mesh | undefined;
    group.traverse((object) => {
      if (object instanceof three.Points) {
        points = object;
      }
      if (object instanceof three.Mesh && object.geometry instanceof three.SphereGeometry) {
        sphere = object;
      }
    });

    expect(parsed.model.pointClouds).toHaveLength(1);
    expect(parsed.model.unknownTypes.has("e3d:PointCloudVisual")).toBe(false);
    expect(parsed.model.unknownTypes.has("e3d:SphereVisual")).toBe(false);
    expect(group.userData.demo3d.stats.pointClouds).toBe(1);
    expect(group.userData.demo3d.warnings).toEqual([]);
    expect([...(points!.geometry.getAttribute("position").array)]).toEqual([1, 2, -3, -1, 0, 2]);
    expect((points!.material as three.PointsMaterial).size).toBe(20);
    expect(sphere!.geometry.parameters.radius).toBe(0.25);
  });

  it("renders box tubes as hollow yaw-pitch-roll oriented frames", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: boxTubeXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });
    const visual = group.children[0]!;
    let tube: three.Mesh | undefined;
    visual.traverse((object) => {
      if (object.userData.demo3d?.kind === "direct-visual") {
        tube = object as three.Mesh;
      }
    });

    expect(tube).toBeDefined();
    tube!.geometry.computeBoundingBox();
    const size = tube!.geometry.boundingBox!.getSize(new three.Vector3());
    expect(size.x).toBeCloseTo(0.6, 5);
    expect(size.y).toBeCloseTo(0.1, 5);
    expect(size.z).toBeCloseTo(1, 5);

    const probe = new three.Mesh(
      tube!.geometry,
      new three.MeshBasicMaterial({ side: three.DoubleSide })
    );
    probe.updateMatrixWorld(true);
    expect(new three.Raycaster(
      new three.Vector3(0, -1, 0),
      new three.Vector3(0, 1, 0)
    ).intersectObject(probe)).toHaveLength(0);
    expect(new three.Raycaster(
      new three.Vector3(0.295, -1, 0),
      new three.Vector3(0, 1, 0)
    ).intersectObject(probe).length).toBeGreaterThan(0);

    expect(visual.rotation.order).toBe("YXZ");
    const localDepthAxis = new three.Vector3(0, 0, 1).applyQuaternion(visual.quaternion);
    expect(localDepthAxis.y).toBeCloseTo(1, 5);
  });

  it("keeps TransferStrand length horizontal under Demo3D yaw-pitch-roll", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: transferStrandXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });
    group.updateWorldMatrix(true, true);
    const size = new three.Box3().setFromObject(group.children[0]!).getSize(new three.Vector3());

    expect(size.x).toBeCloseTo(0.03, 5);
    expect(size.y).toBeCloseTo(0.078, 5);
    expect(size.z).toBeCloseTo(0.38, 5);
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

  it("renders straight and curved belts that rely on serialized Demo3D defaults", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: defaultedBeltXmlFixture }]),
      { parseXml }
    );

    const disabled = await createDemo3DThreeGroup(parsed, { three });
    const enabled = await createDemo3DThreeGroup(parsed, { three, renderProceduralBelts: true });
    const belts: three.Mesh[] = [];
    enabled.traverse((object) => {
      if (object.userData.demo3d?.kind === "procedural-belt") {
        belts.push(object as three.Mesh);
      }
    });

    expect(parsed.model.unknownTypes.has("e3d:CurveBeltConveyor")).toBe(false);
    expect(disabled.userData.demo3d.stats.proceduralBelts).toBe(0);
    expect(enabled.userData.demo3d.stats.proceduralBelts).toBe(3);
    expect(enabled.userData.demo3d.warnings).toEqual([]);
    expect(belts.map((belt) => belt.userData.demo3d.typeName)).toEqual([
      "e3d:StraightBeltConveyor",
      "e3d:CurveBeltConveyor",
      "e3d:CurveBeltConveyor"
    ]);

    for (const belt of belts) {
      belt.geometry.computeBoundingBox();
      expect(belt.geometry.boundingBox?.min.y).toBeCloseTo(-0.06);
      expect(belt.geometry.boundingBox?.max.y).toBeCloseTo(0);
    }
    expect(belts[0]?.geometry.boundingBox?.max.x).toBeCloseTo(0.6);
    expect(belts[0]?.geometry.boundingBox?.min.z).toBeCloseTo(-0.25);
    expect(belts[0]?.geometry.boundingBox?.max.z).toBeCloseTo(0.25);
    expect(belts[1]?.geometry.boundingBox?.min.z).toBeCloseTo(-1);
    expect(belts[1]?.geometry.boundingBox?.max.z).toBeCloseTo(0);
    expect(belts[2]?.geometry.boundingBox?.min.z).toBeCloseTo(0);
    expect(belts[2]?.geometry.boundingBox?.max.z).toBeCloseTo(1);
  });

  it("extrudes custom straight-belt center profiles", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: customProfileBeltXmlFixture }]),
      { parseXml }
    );
    const group = await createDemo3DThreeGroup(parsed, { three, renderProceduralBelts: true });
    let belt: three.Mesh | undefined;
    group.traverse((object) => {
      if (object.userData.demo3d?.kind === "procedural-belt") {
        belt = object as three.Mesh;
      }
    });

    expect(group.userData.demo3d.stats.proceduralBelts).toBe(1);
    expect(group.userData.demo3d.warnings).toEqual([]);
    expect(belt).toBeDefined();
    expect(belt!.geometry.boundingBox?.min.x).toBeCloseTo(0);
    expect(belt!.geometry.boundingBox?.max.x).toBeCloseTo(2);
    expect(belt!.geometry.boundingBox?.min.y).toBeCloseTo(-0.2);
    expect(belt!.geometry.boundingBox?.max.y).toBeCloseTo(0);
    expect(belt!.geometry.boundingBox?.min.z).toBeCloseTo(-0.035);
    expect(belt!.geometry.boundingBox?.max.z).toBeCloseTo(0.035);
  });

  it("renders connector-shaped injector belts and split diverter rollers", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: diverterWithInjectorBeltXmlFixture }]),
      { parseXml }
    );
    const group = await createDemo3DThreeGroup(parsed, {
      three,
      renderProceduralBelts: true,
      renderProceduralRollers: true
    });
    const rollers: three.Object3D[] = [];
    let belt: three.Mesh | undefined;
    group.traverse((object) => {
      if (object.userData.demo3d?.kind === "procedural-roller") {
        rollers.push(object);
      }
      if (
        object.userData.demo3d?.kind === "procedural-belt" &&
        object.userData.demo3d?.typeName === "e3d:InjectorBeltConveyor"
      ) {
        belt = object as three.Mesh;
      }
    });

    expect(parsed.model.unknownTypes.has("e3d:DiverterRollerConveyor")).toBe(false);
    expect(parsed.model.unknownTypes.has("e3d:InjectorBeltConveyor")).toBe(false);
    expect(group.userData.demo3d.stats.proceduralBelts).toBe(1);
    expect(group.userData.demo3d.stats.proceduralRollers).toBe(32);
    expect(group.userData.demo3d.warnings).toEqual([]);
    expect(rollers).toHaveLength(32);
    expect([...new Set(rollers.map((roller) => roller.position.z))]).toEqual([-0.125, 0.125]);
    expect(rollers[0]?.position.x).toBeCloseTo(0.024645984);
    expect(rollers[31]?.position.x).toBeCloseTo(0.76402551);
    const beltBounds = new three.Box3().setFromObject(belt!);
    expect(beltBounds.min.x).toBeCloseTo(0);
    expect(beltBounds.max.x).toBeCloseTo(1.0219203);
    expect(beltBounds.min.y).toBeCloseTo(-0.05);
    expect(beltBounds.max.y).toBeCloseTo(0);
    expect(beltBounds.min.z).toBeCloseTo(-0.27192032);
    expect(beltBounds.max.z).toBeCloseTo(0.27192032);
  });

  it("renders rack frames from serialized rack dimensions and visibility", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: liftRackXmlFixture }]),
      { parseXml }
    );
    const disabled = await createDemo3DThreeGroup(parsed, { three });
    const enabled = await createDemo3DThreeGroup(parsed, { three, renderProceduralRacks: true });
    let rack: three.Group | undefined;
    enabled.traverse((object) => {
      if (object.userData.demo3d?.kind === "procedural-rack") {
        rack = object as three.Group;
      }
    });

    expect(parsed.model.unknownTypes.has("e3d:RackVisual")).toBe(false);
    expect(disabled.userData.demo3d.stats.proceduralRacks).toBe(0);
    expect(enabled.userData.demo3d.stats.proceduralRacks).toBe(1);
    expect(enabled.userData.demo3d.warnings).toEqual([]);
    expect(rack?.children).toHaveLength(7);
    expect(rack?.userData.demo3d.framePositions).toEqual([0]);
    expect(rack?.userData.demo3d.strutHeights).toHaveLength(5);
    expect(rack?.userData.demo3d.strutHeights[0]).toBeCloseTo(0.025);
    expect(rack?.userData.demo3d.strutHeights[4]).toBeCloseTo(3.854);
    const bounds = new three.Box3().setFromObject(rack!);
    expect(bounds.min.x).toBeCloseTo(-0.025);
    expect(bounds.max.x).toBeCloseTo(0.025);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(3.879);
    expect(bounds.min.z).toBeCloseTo(-0.675);
    expect(bounds.max.z).toBeCloseTo(0.675);
    expect(((rack?.children[0] as three.Mesh).material as three.MeshStandardMaterial).color.getHex()).toBe(0xd3d3d3);
  });

  it("uses upright width when a rack serializes zero upright depth", async () => {
    const fixture = liftRackXmlFixture.replace("<UprightDepth>0.05</UprightDepth>", "<UprightDepth>0</UprightDepth>");
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: fixture }]), { parseXml });
    const group = await createDemo3DThreeGroup(parsed, { three, renderProceduralRacks: true });

    expect(group.userData.demo3d.stats.proceduralRacks).toBe(1);
    expect(group.userData.demo3d.warnings).toEqual([]);
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

  it("renders support stands whose default profiles are omitted", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: defaultedSupportStandXmlFixture }]),
      { parseXml }
    );
    const group = await createDemo3DThreeGroup(parsed, { three, renderProceduralSupportStands: true });
    let support: three.Group | undefined;
    group.traverse((object) => {
      if (object.userData.demo3d?.kind === "procedural-support-stand") {
        support = object as three.Group;
      }
    });

    expect(group.userData.demo3d.stats.proceduralSupportStands).toBe(1);
    expect(group.userData.demo3d.warnings).toEqual([]);
    expect(support?.children).toHaveLength(8);
    expect(support?.userData.demo3d).toMatchObject({
      span: 0.556,
      braceHeights: [0.5],
      approximate: true,
      defaultProfiles: true
    });
    expect(support?.userData.demo3d.supportHeight).toBeCloseTo(0.78);
    const bounds = new three.Box3().setFromObject(support!);
    expect(bounds.min.y).toBeCloseTo(-0.83);
    expect(bounds.max.y).toBeCloseTo(-0.05);
    expect(bounds.min.z).toBeCloseTo(-0.328);
    expect(bounds.max.z).toBeCloseTo(0.328);
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

  it("does not mistake curved side-guide cylinders for serialized rollers", async () => {
    const parsed = await parseDemo3D(
      createZip([{ name: "fixture.demo3d", data: curveWithSideGuideCylinderXmlFixture }]),
      { parseXml }
    );
    const group = await createDemo3DThreeGroup(parsed, { three, renderProceduralRollers: true });
    const rollers: three.Object3D[] = [];
    group.traverse((object) => {
      if (object.userData.demo3d?.kind === "procedural-roller") {
        rollers.push(object);
      }
    });

    expect(group.userData.demo3d.stats.proceduralRollers).toBe(9);
    expect(group.userData.demo3d.stats.serializedRenderables).toBe(1);
    expect(Math.min(...rollers.map((roller) => roller.position.x))).toBeGreaterThan(0.7);
    expect(Math.max(...rollers.map((roller) => roller.position.z))).toBeCloseTo(0);
    expect(Math.min(...rollers.map((roller) => roller.position.z))).toBeLessThan(-0.7);
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
    expect(Math.max(...Array.from({ length: position?.count ?? 0 }, (_, index) => position!.getZ(index))))
      .toBeLessThan(0.000001);
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

  it("draws diagnostic placeholders for missing mesh references when explicitly enabled", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: missingMeshXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three, showPlaceholders: true });
    const visual = group.children[0]!;
    const placeholder = visual.children[0]!;

    expect(group.userData.demo3d.stats.missingGeometryPlaceholders).toBe(1);
    expect(group.userData.demo3d.stats.unsupported).toBe(1);
    expect(placeholder.userData.demo3d.kind).toBe("missing-geometry-placeholder");
    expect(placeholder.userData.demo3d.meshReferenceId).toBe("missing-mesh");
  });

  it("suppresses missing mesh placeholders by default", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: missingMeshXmlFixture }]), {
      parseXml
    });

    const group = await createDemo3DThreeGroup(parsed, { three });

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

const multiMaterialMeshAspectXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <MeshLibrary><Meshes><e xsi:type="e3d:DictionaryEntry">
    <key xsi:type="e3d:MeshReference"><Id>subset-mesh</Id></key>
    <val xsi:type="e3d:Mesh"><MeshData>
      <MF xsi:type="Demo3D.Renderers.Meshes.MeshFormat">TriangleList</MF>
      <V><VF xsi:type="Demo3D.Renderers.Meshes.VertexFormat">PositionNormal</VF><D>AAAAAAAAAAAAAAAAAAAAAAAAgD8AAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAACAPwAAAAAAAIA/AAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAgD8AAAAA</D></V>
      <I><IF xsi:type="Demo3D.Renderers.Meshes.IndexFormat">UInt16</IF><D>AAABAAIAAAACAAMA</D></I>
      <A>AAE=</A>
    </MeshData></val>
  </e></Meshes></MeshLibrary>
  <C><e xsi:type="e3d:Visual"><Id>subset-visual</Id><N>Subset mesh</N><AS><E>subset-aspect</E></AS></e></C>
  <SerializedObjects><E xsi:type="e3d:MeshRendererAspect"><Id>subset-aspect</Id><Renderables><E>
    <Id>subset-renderable</Id>
    <MaterialProperties>
      <e><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-65536</Diffuse></MeshMaterial></e>
      <e><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-16711936</Diffuse></MeshMaterial></e>
    </MaterialProperties>
    <MeshReference><Id>subset-mesh</Id></MeshReference>
  </E></Renderables></E></SerializedObjects>
</e3d:Demo3DProject>`;

const disabledAspectXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:Visual"><Id>motor-left</Id><N>MotorLeft1</N><AS><E>disabled-cylinder</E></AS></e></C>
  <SerializedObjects>
    <E xsi:type="e3d:CylinderRendererAspect">
      <Id>disabled-cylinder</Id><IsEnabled>0</IsEnabled>
      <Renderables><E><Id>default-cylinder</Id><Length>1</Length><Radius>0.5</Radius><Slices>24</Slices><Angle>360</Angle>
        <MeshReference><Id>default-cylinder-template</Id></MeshReference>
      </E></Renderables>
    </E>
  </SerializedObjects>
</e3d:Demo3DProject>`;

const curveWithSideGuideCylinderXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:CurveRollerConveyor"><Id>curve-1</Id><N>A-1060</N>
    <P xsi:type="e3d:CurveRollerConveyorProperties"><Angle>-45</Angle><InnerRadius>0.825</InnerRadius>
      <Width>0.42</Width><RollerWidth>0.42</RollerWidth><RollerCount>9</RollerCount><RollerDiameter>0.05</RollerDiameter>
    </P>
    <C><e xsi:type="e3d:Visual"><Id>side-guide</Id><N>SideGuideVisual</N><AS><E>side-guide-aspect</E></AS></e></C>
  </e></C>
  <SerializedObjects><E xsi:type="e3d:CylinderRendererAspect"><Id>side-guide-aspect</Id><Renderables><E>
    <Length>0.03</Length><Radius>1.26</Radius><InnerRadius>1.245</InnerRadius><Slices>24</Slices>
    <StartAngle>-45</StartAngle><Angle>45</Angle><MeshReference><Id>side-guide-template</Id></MeshReference>
  </E></Renderables></E></SerializedObjects>
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

const pointCloudAndSphereXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <PointCloudLibrary><PointClouds>
    <e xsi:type="e3d:DictionaryEntry">
      <key xsi:type="e3d:PointCloudReference"><Id>cloud-1</Id></key>
      <val xsi:type="e3d:PointCloud">
        <Name>Scan</Name><HasColoredVertices>0</HasColoredVertices><HasNormals>0</HasNormals>
        <PointCloudPrimitives><E><Color>-16711936</Color><Points>points.bin</Points></E></PointCloudPrimitives>
      </val>
    </e>
  </PointClouds></PointCloudLibrary>
  <C>
    <e xsi:type="e3d:PointCloudVisual"><Id>cloud-visual</Id><N>Cloud</N>
      <P xsi:type="e3d:PointCloudProperties"><PointCloudRef>cloud-1</PointCloudRef><PointSize>20</PointSize></P>
    </e>
    <e xsi:type="e3d:SphereVisual"><Id>sphere-visual</Id><N>Sphere</N>
      <P xsi:type="e3d:SphereProperties"><Radius>0.25</Radius>
        <Material><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-65536</Diffuse></MeshMaterial></Material>
      </P>
    </e>
  </C>
</e3d:Demo3DProject>`;

const texturedDirectVisualXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <TextureLibrary><Textures>
    <e xsi:type="e3d:DictionaryEntry">
      <key xsi:type="e3d:TextureReference"><Id>box-texture</Id></key>
      <val xsi:type="e3d:TextureImage">
        <Name>Orientation marker</Name><Width>1</Width><Height>1</Height>
        <e3d:Image><bytes>iVBORw0KGgo=</bytes></e3d:Image>
      </val>
    </e>
  </Textures></TextureLibrary>
  <C><e xsi:type="e3d:BoxVisual">
    <Id>textured-box</Id><N>Textured box</N>
    <P xsi:type="e3d:BoxProperties">
      <Width>2</Width><Height>1</Height><Depth>0.1</Depth>
      <Material><MeshMaterial xsi:type="e3d:MeshMaterial">
        <Diffuse>-1</Diffuse><Texture><Id>box-texture</Id></Texture>
      </MeshMaterial></Material>
    </P>
  </e></C>
</e3d:Demo3DProject>`;

const boxTubeXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:BoxTubeVisual">
      <LR>-7.989673|1.6045084|-13.937014|1.5707963|-1.5707954|-3.1415925</LR>
      <Id>height-check</Id><N>A-1410</N>
      <P xsi:type="e3d:BoxTubeProperties">
        <Width>0.6</Width><Height>0.1</Height><Depth>1</Depth>
        <OuterMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-16777216</Diffuse></MeshMaterial></OuterMaterial>
      </P>
    </e>
  </C>
</e3d:Demo3DProject>`;

const transferStrandXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:Visual">
    <LR>0.07499963|-0.026000023|0.014998474|-1.570796|1.570799|3.141592</LR>
    <Id>transfer-strand</Id><N>TransferStrand</N><AS><E>transfer-strand-aspect</E></AS>
    <P xsi:type="e3d:VisualProperties"><Type>TransferStrand</Type></P>
  </e></C>
  <SerializedObjects><E xsi:type="e3d:BoxRendererAspect">
    <Id>transfer-strand-aspect</Id><Renderables><E>
      <Depth>0.078</Depth><Height>0.03</Height><Width>0.38</Width>
      <MeshReference><Id>box-template</Id></MeshReference>
    </E></Renderables>
  </E></SerializedObjects>
</e3d:Demo3DProject>`;

const hiddenLayerXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <LayerLibrary><Layers>
    <e xsi:type="e3d:DictionaryEntry"><key>Hidden</key><val xsi:type="e3d:Layer"><Name>Hidden</Name><Visible>0</Visible></val></e>
    <e xsi:type="e3d:DictionaryEntry"><key>Visible</key><val xsi:type="e3d:Layer"><Name>Visible</Name></val></e>
  </Layers></LayerLibrary>
  <C><e xsi:type="e3d:BoxVisual"><Id>hidden-parent</Id><N>Hidden parent</N>
    <P xsi:type="e3d:BoxProperties"><Layer>Hidden</Layer><Width>1</Width><Height>1</Height><Depth>1</Depth></P>
    <C>
      <e xsi:type="e3d:BoxVisual"><Id>inherited-hidden</Id><N>Inherited hidden</N><P xsi:type="e3d:BoxProperties"><Width>1</Width><Height>1</Height><Depth>1</Depth></P></e>
      <e xsi:type="e3d:BoxVisual"><Id>visible-child</Id><N>Visible child</N><P xsi:type="e3d:BoxProperties"><Layer>Visible</Layer><Width>1</Width><Height>1</Height><Depth>1</Depth></P></e>
    </C>
  </e></C>
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

const customProfileBeltXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:StraightBeltConveyor"><Id>profile-belt</Id><N>Profile Belt</N>
    <P xsi:type="e3d:StraightBeltConveyorProperties">
      <BeltLength>2</BeltLength><BeltWidth>0.07</BeltWidth><BeltDiameter>0.1</BeltDiameter>
      <CenterProfile><Name>SingleRail</Name><Anchor xsi:type="e3d:Vector2">0.07|-0.015</Anchor>
        <Polygons><e xsi:type="e3d:ExtrusionPolygon"><Points>
          <e xsi:type="e3d:Vector2">0.035|-0.015</e><e xsi:type="e3d:Vector2">0.105|-0.015</e>
          <e xsi:type="e3d:Vector2">0.105|-0.215</e><e xsi:type="e3d:Vector2">0.035|-0.215</e>
        </Points></e></Polygons>
      </CenterProfile>
      <SurfaceMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-8355712</Diffuse></MeshMaterial></SurfaceMaterial>
      <SurfaceSideMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-4144960</Diffuse></MeshMaterial></SurfaceSideMaterial>
    </P>
  </e></C>
</e3d:Demo3DProject>`;

const defaultedBeltXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:StraightBeltConveyor"><Id>straight</Id><N>Straight</N>
      <P xsi:type="e3d:StraightBeltConveyorProperties"><BeltLength>0.6</BeltLength><Length>0.6</Length>
        <SurfaceMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-8355712</Diffuse></MeshMaterial></SurfaceMaterial>
        <SurfaceSideMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-4144960</Diffuse></MeshMaterial></SurfaceSideMaterial>
      </P>
    </e>
    <e xsi:type="e3d:CurveBeltConveyor"><Id>left</Id><N>Left</N>
      <P xsi:type="e3d:CurveBeltConveyorProperties"><Angle>-90</Angle><InnerRadius>0.5</InnerRadius><Width>0.5</Width></P>
    </e>
    <e xsi:type="e3d:CurveBeltConveyor"><Id>right</Id><N>Right</N>
      <P xsi:type="e3d:CurveBeltConveyorProperties"><InnerRadius>0.5</InnerRadius><Width>0.5</Width></P>
    </e>
  </C>
</e3d:Demo3DProject>`;

const diverterWithInjectorBeltXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:DiverterRollerConveyor"><Id>divert</Id><N>Divert1</N>
    <P xsi:type="e3d:DiverterRollerConveyorProperties">
      <Length>0.7886714935302734</Length><NumRollersAcrossWidth>2</NumRollersAcrossWidth>
      <RollerDiameter>0.035</RollerDiameter><RollerPitch>0.05</RollerPitch>
      <RollerWidth>0.288325</RollerWidth><Width>0.5</Width>
      <SurfaceMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-4144960</Diffuse></MeshMaterial></SurfaceMaterial>
    </P>
    <C><e xsi:type="e3d:InjectorBeltConveyor"><Id>belt</Id><N>Belt2</N>
      <P xsi:type="e3d:InjectorBeltConveyorProperties">
        <BeltDiameter>0.05</BeltDiameter><BeltLength>0.5</BeltLength><BeltWidth>0.5</BeltWidth>
        <SurfaceMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-8355712</Diffuse></MeshMaterial></SurfaceMaterial>
        <SurfaceSideMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-4144960</Diffuse></MeshMaterial></SurfaceSideMaterial>
      </P>
      <CN>
        <e xsi:type="e3d:ConveyorConnector"><Name>Start</Name>
          <Start>0.47807968||-0.27192032</Start><End>1.0219203||0.27192032</End>
        </e>
        <e xsi:type="e3d:ConveyorConnector"><Name>End</Name><Start>||0.25</Start><End>||-0.25</End></e>
      </CN>
    </e></C>
  </e></C>
</e3d:Demo3DProject>`;

const liftRackXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:ContainerVisual"><Id>lift</Id><N>VerticalLift</N><P xsi:type="e3d:ContainerProperties" />
    <C><e xsi:type="e3d:RackVisual"><Id>rack</Id><N>FrontRack</N>
      <P xsi:type="e3d:RackProperties">
        <BayDepth>0.6</BayDepth><BayWidth>0</BayWidth><ExtensionStrutOffset>0.025</ExtensionStrutOffset>
        <FrameDepth>1.3</FrameDepth><FrameHeight>3.879</FrameHeight><InitialStrutHeight>0.025</InitialStrutHeight>
        <LastFrame><Visible>0</Visible></LastFrame><MiddleFrames><Visible>0</Visible></MiddleFrames>
        <MinFrameGap>0</MinFrameGap><NumBays>1</NumBays><StrutColor><name>LightGray</name></StrutColor>
        <StrutSpanHeight>1.2</StrutSpanHeight><StrutWidth>0.05</StrutWidth>
        <UprightColor><name>LightGray</name></UprightColor><UprightDepth>0.05</UprightDepth><UprightWidth>0.05</UprightWidth>
      </P>
    </e></C>
  </e></C>
</e3d:Demo3DProject>`;

const defaultedSupportStandXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:StraightBeltConveyor"><Id>conveyor</Id><N>Conveyor</N>
    <P xsi:type="e3d:StraightBeltConveyorProperties"><BeltLength>0.6</BeltLength></P>
    <C><e xsi:type="e3d:SupportStand"><Id>support</Id><N>StartSupport</N>
      <P xsi:type="e3d:SupportStandProperties">
        <AddCrossBraceAtHeight><e xsi:type="xsd:double">0.5</e><e xsi:type="xsd:double">1</e><e xsi:type="xsd:double">1.5</e></AddCrossBraceAtHeight>
        <ConveyorOffset>|-0.05|0.028</ConveyorOffset>
        <FloorPlateHeight>0.01</FloorPlateHeight><FootHeight>0.21</FootHeight>
        <LegMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-5658199</Diffuse></MeshMaterial></LegMaterial>
        <FootMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-13676721</Diffuse></MeshMaterial></FootMaterial>
        <FloorPlateMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-13676721</Diffuse></MeshMaterial></FloorPlateMaterial>
        <CrossBraceMaterial><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-5658199</Diffuse></MeshMaterial></CrossBraceMaterial>
      </P>
    </e></C>
  </e></C>
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
