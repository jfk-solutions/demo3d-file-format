import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import * as three from "three";
import { parseRaw3D, decodeRaw3DSkinInfluences, evaluateRaw3DLightAttenuation } from "../src/index.js";
import { createRaw3DThreeGroup, createRaw3DThreePlayback } from "../src/three/index.js";
import { createZip } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());
const bytes = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);
function fixture({ bones = 0, shader = "Default", decal = false, billboard = false, textures = false, updates = "", lights = "", scene = "", offset = 0 } = {}) {
  const boneXml = Array.from({ length: bones }, (_, i) => `<Bone Name="Bone${i}" Parent="0" SkinIndexBuffer="1" SkinWeightsVertexBuffer="1" Location="${offset} 0 0"/>`).join("");
  return createZip([
    { name: "Model.xml", data: `<Scene>${scene}<Nodes>
      <Node Index="0" Name="Driver"/>
      <Node Index="1" Name="Body" Mesh="0" Materials="0" IsDecal="${decal}" IsBillboard="${billboard}"/>
      </Nodes><Materials><Material R="1" G="1" B="1" Shader="${shader}" ${textures ? 'Texture="0" NormalTexture="0"' : ""}/></Materials>
      <Textures><Texture Path="a.png"/><Texture Path="b.png"/></Textures>
      <Meshes><Mesh VertexBuffer="0" IndexBuffers="0"><Bones>${boneXml}</Bones></Mesh></Meshes>
      <VertexBuffers><VertexBuffer Path="v.dat"><Attribute Usage="Position" Type="Vector3"/></VertexBuffer>
      <VertexBuffer Path="w.dat"><Attribute Usage="Position" Type="Single"/></VertexBuffer></VertexBuffers>
      <IndexBuffers><IndexBuffer Path="i.dat" Format="Int16"/><IndexBuffer Path="skin.dat" Format="Int16"/></IndexBuffers>
      <Lights>${lights}</Lights><Updates>${updates}</Updates></Scene>` },
    { name: "v.dat", data: bytes([1,0,0,0,1,0,0,0,1]) }, { name: "w.dat", data: bytes([1]) },
    { name: "i.dat", data: new Uint8Array(new Uint16Array([0,1,2]).buffer) },
    { name: "skin.dat", data: new Uint8Array(new Uint16Array([0]).buffer) },
    { name: "a.png", data: new Uint8Array([1]) }, { name: "b.png", data: new Uint8Array([2]) }
  ]);
}

describe("native SDK serialized feature data", () => {
  it("reads native bones, shaders, non-node channels and UI serializer names", async () => {
    const xml = readFileSync("test/fixtures/native-features.xml", "utf8");
    const parsed = await parseRaw3D(createZip([{ name: "Model.xml", data: xml }]));
    expect(parsed.model.meshes[0]!.bones[0]).toMatchObject({ name: "Arm", parentIndex: 0, skinIndexBuffer: 1, skinWeightsVertexBuffer: 2, location: [1,2,3] });
    expect(parsed.model.materials[0]!.shader).toBe("FlatText");
    expect(parsed.model.materials[0]!.transparency).toBeCloseTo(.8);
    const animation = parsed.model.animation;
    expect(animation.warnings.map(warning => warning.code)).toEqual(["RAW3D_STRING_KEYS_AMBIGUOUS"]);
    expect(animation.sampleFrame(.5).lights.get(0)).toMatchObject({ type: 1, enabled: true, attenuationRange: 7.5 });
    const end = animation.sampleFrame(1);
    expect(end.lights.get(0)).toMatchObject({ type: 2, enabled: false, materialProperties: { Diffuse: 0xffff0000 } });
    expect(end.scene).toMatchObject({ useDefaultLighting: false, ambientLightColor: [1,0,0] });
    expect(end.buttons.get(0)).toMatchObject({ name: "Run", visible: false, checked: true });
    expect(end.nodes.get(0)!.materialProperties[0]!.Texture).toBe(1);
    expect(animation.sampleFrame(0).buttons.get(0)!.visible).toBe(true);
    expect(animation.effects.tracks.find(track => track.kind === "LightType")!.xml).toBeDefined();
  });

  it("samples unambiguous UserData including a single string containing whitespace", async () => {
    const parsed = await parseRaw3D(fixture({ updates: '<UserData Node="0" Time="1" Value="hello world"/><UserData Node="1" Time="0 1" Value="idle picking"/>' }));
    expect(parsed.model.animation.sampleNode(0, 0).userData).toBeUndefined();
    expect(parsed.model.animation.sampleNode(0, 1).userData).toBe("hello world");
    expect(parsed.model.animation.sampleNode(1, 1).userData).toBe("picking");
  });

  it("steps texture references and resets both color and normal maps on backwards seeking", async () => {
    let bitmap = 0;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, marker: bitmap++ })));
    const parsed = await parseRaw3D(fixture({ textures: true, updates: '<Material Node="1" Name="Texture" Time="0 1" Value="0 1"/><Material Node="1" Name="NormalMap" Time="0 1" Value="0 1"/>' }));
    const playback = await createRaw3DThreePlayback(parsed, { three });
    const material = () => ((playback.group.getObjectByName("Body")!.children[0] as three.Mesh).material as three.MeshStandardMaterial);
    const initial = material().map!.image, normal = material().normalMap!.image;
    playback.seek(.75);expect(material().map!.image).toBe(initial);
    playback.seek(1);expect(material().map!.image).not.toBe(initial);expect(material().normalMap!.image).not.toBe(normal);
    playback.seek(0);expect(material().map!.image).toBe(initial);expect(material().normalMap!.image).toBe(normal);
    playback.dispose();
  });
});

describe("native surface and light presentation", () => {
  it("decodes packed ARGB vertex colors and the PointCloud shader without changing buffer stride", async () => {
    const data = new ArrayBuffer(32), view = new DataView(data);
    view.setFloat32(16, 1, true);view.setUint32(12, 0xffff0000, true);view.setUint32(28, 0xff00ff00, true);
    const parsed = await parseRaw3D(createZip([
      { name: "Model.xml", data: '<Scene><Nodes><Node Index="0" Mesh="0" Materials="0"/></Nodes><Materials><Material R="1" G="1" B="1" Shader="PointCloud" PointSize="3"/></Materials><Meshes><Mesh MeshType="PointList" VertexBuffer="0" IndexBuffers="0"/></Meshes><VertexBuffers><VertexBuffer Path="v"><Attribute Usage="Position" Type="Vector3"/><Attribute Usage="Color" Type="Color"/></VertexBuffer></VertexBuffers><IndexBuffers><IndexBuffer Path="i" Format="Int16"/></IndexBuffers></Scene>' },
      { name: "v", data: new Uint8Array(data) }, { name: "i", data: new Uint8Array(new Uint16Array([0,1]).buffer) }
    ]));
    expect(parsed.model.vertexBuffers[0]!.stride).toBe(16);
    const group = await createRaw3DThreeGroup(parsed, { three });
    let points: three.Points | undefined;group.traverse(object => { if (object instanceof three.Points) points = object; });
    expect(points!.geometry.getAttribute("color").getX(0)).toBe(1);
    expect(points!.geometry.getAttribute("color").getY(1)).toBe(1);
    expect(points!.material).toMatchObject({ vertexColors: true, size: 3 });
  });
  it("evaluates native distance attenuation and spot falloff independently of a renderer", async () => {
    const parsed = await parseRaw3D(fixture({ lights: '<Light Index="0" Node="0" Type="Spot" AttenuationConstant="1" AttenuationLinear="2" AttenuationQuadratic="3" AttenuationRange="5" SpotlightInnerAngle="0.4" SpotlightOuterAngle="0.8" SpotlightFalloff="2"/>' }));
    const light = parsed.model.animation.sampleFrame(0).lights.get(0)!;
    expect(evaluateRaw3DLightAttenuation(light, 2, 1)).toBeCloseTo(1/17);
    expect(evaluateRaw3DLightAttenuation(light, 6, 1)).toBe(0);
    const cosine = (Math.cos(.2)+Math.cos(.4))/2;
    expect(evaluateRaw3DLightAttenuation(light, 2, cosine)).toBeCloseTo(.25/17);
  });
  it("renders FlatText without lighting, applies decal bias, and faces billboards toward the camera", async () => {
    const parsed = await parseRaw3D(fixture({ shader: "FlatText", decal: true, billboard: true }));
    const group = await createRaw3DThreeGroup(parsed, { three });
    const drawable = group.getObjectByName("Body")!.children[0] as three.Mesh;
    expect(drawable.material).toBeInstanceOf(three.MeshBasicMaterial);
    expect(drawable.material).toMatchObject({ polygonOffset: true, depthWrite: false });
    const camera = new three.PerspectiveCamera();camera.position.set(2,3,4);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    group.rotation.y = .8;group.updateMatrixWorld(true);
    drawable.onBeforeRender({} as three.WebGLRenderer, new three.Scene(), camera, drawable.geometry, drawable.material as three.Material, null as unknown as three.Group);
    expect(Math.abs(drawable.getWorldQuaternion(new three.Quaternion()).dot(camera.quaternion))).toBeCloseTo(1);
  });

  it("applies changing light types, cones, shadows, ambient/default lighting and floor visibility", async () => {
    const parsed = await parseRaw3D(fixture({
      lights: '<Light Index="0" Node="0" Enabled="true" Type="Point" AttenuationConstant="1"/>',
      scene: '<SceneProperties ShowDefaultFloor="false"/>',
      updates: '<LightType Light="0" Time="0 1" Value="1 2"/><LightSIA Light="0" Time="0 1" Value="0.2 0.4"/><LightSOA Light="0" Time="0 1" Value="0.6 0.8"/><LightCS Light="0" Time="0 1" Value="false true"/><SceneUseDefaultLighting Time="0 1" Value="true false"/><SceneShowDefaultFloor Time="0 1" Value="false true"/><ALR Time="0 1" Value="0 1"/>'
    }));
    const playback = await createRaw3DThreePlayback(parsed, { three });
    playback.seek(1);
    let spot: three.SpotLight | undefined;
    playback.group.traverse(object => { if (object instanceof three.SpotLight) spot = object; });
    expect(spot).toBeDefined();expect(spot!.angle).toBeCloseTo(.4);expect(spot!.penumbra).toBeCloseTo(.5);expect(spot!.castShadow).toBe(true);
    expect(playback.group.children.find(child => child.userData.raw3d?.kind === "scene-floor")!.visible).toBe(true);
    expect(playback.group.children.find(child => child.userData.raw3d?.kind === "scene-default-light")!.visible).toBe(false);
    playback.seek(0);expect(playback.group.children.find(child => child.userData.raw3d?.kind === "scene-floor")!.visible).toBe(false);
    playback.dispose();
  });
});

describe("native bone buffers and skinning", () => {
  it.each([1, 5])("preserves all %i bone influences and reversibly deforms weighted vertices", async count => {
    const parsed = await parseRaw3D(fixture({ bones: count, updates: '<X Node="0" Time="0 1" Value="0 2"/>' }));
    const influences = decodeRaw3DSkinInfluences(parsed.model.meshes[0]!, parsed.model);
    expect(influences[0]).toHaveLength(count);
    expect(influences[0]!.reduce((sum, entry) => sum+entry.weight, 0)).toBeCloseTo(1);
    const playback = await createRaw3DThreePlayback(parsed, { three });
    const mesh = playback.group.getObjectByName("Body")!.children.find(child => child instanceof three.Mesh) as three.Mesh;
    expect(mesh.userData.raw3d.skinning).toBe(count <= 4 ? "gpu" : "cpu");
    const position = () => mesh.getVertexPosition(0, new three.Vector3());
    expect(position().x).toBeCloseTo(1);
    playback.seek(1);expect(position().x).toBeCloseTo(3);
    expect(mesh.getVertexPosition(1, new three.Vector3()).y).toBeCloseTo(1);
    playback.seek(0);expect(position().x).toBeCloseTo(1);
    const dispose = vi.spyOn(mesh.geometry, "dispose");
    playback.dispose();expect(dispose).toHaveBeenCalledOnce();
  });

  it("combines native bind offsets with animated driver rotations", async () => {
    const parsed = await parseRaw3D(fixture({ bones: 1, offset: -1, updates: `<RZ Node="0" Time="0 1" Value="0 ${Math.PI/2}"/>` }));
    const playback = await createRaw3DThreePlayback(parsed, { three });
    const mesh = playback.group.getObjectByName("Body")!.children.find(child => child instanceof three.SkinnedMesh) as three.SkinnedMesh;
    playback.seek(1);const point = mesh.getVertexPosition(0, new three.Vector3());
    expect(point.length()).toBeCloseTo(0);
    playback.dispose();
  });
});
