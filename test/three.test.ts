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
  });

  it("converts Demo3D diffuse colors into Three materials", async () => {
    const parsed = await parseDemo3D(createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture }]), { parseXml });
    const material = createDemo3DThreeMaterial(parsed.model.visuals[0]!.materials[0], three);

    expect(material.type).toBe("MeshStandardMaterial");
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
    expect(visual.position.toArray()).toEqual([1, 2, 3]);
    expect(visual.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(renderable.userData.demo3d.aspectType).toBe("e3d:CylinderRendererAspect");
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
