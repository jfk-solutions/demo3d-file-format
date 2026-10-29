import { describe, expect, it, vi } from "vitest";
import * as three from "three";
import { build } from "esbuild";
import { parseRaw3D, interpolateRaw3DDualQuaternion, raw3DQuaternionFromRotation } from "../src/index.js";
import { createRaw3DThreePlayback, createRaw3DThreeGroup } from "../src/three/index.js";
import { createZip } from "./helpers.js";

function fixture(updates = "", attributes = "") {
  const vertices = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
  return createZip([
    { name: "Model.xml", data: `<Scene><Nodes>
      <Node Index="0" Name="Structural root" Visible="false"/>
      <Node Index="1" Name="Moving" Parent="0" Mesh="0" Layer="0" ${attributes}/>
      <Node Index="2" Name="Other" Parent="0" Mesh="0" Materials="0"/>
      </Nodes><Layers><Layer Name="Red" Material="0"/><Layer Name="Blue" Material="1"/></Layers>
      <Materials><Material R="1" G="0" B="0"/><Material R="0" G="0" B="1"/></Materials>
      <Meshes><Mesh VertexBuffer="0" IndexBuffers="0"/><Mesh VertexBuffer="1" IndexBuffers="0"/></Meshes>
      <VertexBuffers><VertexBuffer Path="v0.dat"><Attribute Usage="Position" Type="Vector3"/></VertexBuffer>
      <VertexBuffer Path="v1.dat"><Attribute Usage="Position" Type="Vector3"/></VertexBuffer></VertexBuffers>
      <IndexBuffers><IndexBuffer Path="i0.dat" Format="Int16"/></IndexBuffers>
      <Updates>${updates}</Updates></Scene>` },
    { name: "v0.dat", data: new Uint8Array(vertices.buffer) },
    { name: "v1.dat", data: new Uint8Array(new Float32Array([0,0,0, 2,0,0, 0,2,0]).buffer) },
    { name: "i0.dat", data: new Uint8Array(new Uint16Array([0,1,2]).buffer) }
  ]);
}
const track = (kind: string, times: string, values: string, attributes = "") => `<${kind} Node="1" Time="${times}" Value="${values}" ${attributes}/>`;

describe("renderer-independent RAW3D animation", () => {
  it("keeps the parser entry free of Three.js and renderer modules", async () => {
    const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, metafile: true, platform: "browser" });
    expect(Object.keys(bundle.metafile!.inputs).filter(path => /(?:node_modules\/three|src\/three\/)/.test(path.replaceAll("\\", "/")))).toEqual([]);
  });

  it("samples step/linear interpolation modes and restores earlier states", async () => {
    const parsed = await parseRaw3D(fixture(track("X", "0 2", "0 10") + track("InterpolationMode", "0 1", "1 2")));
    expect(parsed.model.animation).toBe(parsed.model.animation);
    const animation = parsed.model.animation;
    expect(animation.sampleNode(1, .5).location[0]).toBe(0);
    expect(animation.sampleNode(1, 1.5).location[0]).toBeCloseTo(7.5);
    expect(animation.sampleNode(1, .5).location[0]).toBe(0);
    expect(animation.duration).toBe(2);
  });

  it("uses the last duplicate key and preserves pre-birth defaults", async () => {
    const parsed = await parseRaw3D(fixture(track("Visible", "1 1 2", "false true false") + track("X", "1 1 2", "3 4 8")));
    expect(parsed.model.animation.sampleNode(1, 0).location[0]).toBe(0);
    expect(parsed.model.animation.sampleNode(1, 1).location[0]).toBe(4);
    expect(parsed.model.animation.sampleNode(1, 1.5).location[0]).toBe(6);
    expect(parsed.model.animation.sampleNode(1, 1).visible).toBe(true);
    expect(parsed.model.animation.sampleNode(1, 2).visible).toBe(false);
  });

  it("preserves unknown channel XML and its clip duration with a warning", async () => {
    const parsed = await parseRaw3D(fixture(track("FutureProperty", "0 8", "alpha beta")));
    expect(parsed.model.animation.duration).toBe(8);
    expect(parsed.model.animation.warnings[0]?.xml.localName).toBe("FutureProperty");
  });

  it("exposes native node metadata without executing it", async () => {
    const parsed = await parseRaw3D(fixture(track("InteractionMode", "0 1", "0 8") + track("Highlight", "0 1", "0 2"), 'Visible="false" IsDecal="true" UserData="example" ClientOwner="owner"'));
    expect(parsed.model.nodes[1]).toMatchObject({ visible: false, isDecal: true, userData: "example", clientOwner: "owner" });
    expect(parsed.model.animation.sampleNode(1, 1)).toMatchObject({ interactionMode: 8, highlight: 2 });
  });

  it("exposes scene and material properties that were previously only XML", async () => {
    const parsed = await parseRaw3D(createZip([{ name: "Model.xml", data: `<Scene>
      <SceneProperties ShowDefaultFloor="false" UseDefaultLighting="false" AmbientLightColor="0.1 0.2 0.3" Quality="2"/>
      <Materials><Material Luminosity="0.5" U="0.2" V="0.3" PointSize="4"/></Materials></Scene>` }]));
    expect(parsed.model.sceneProperties).toMatchObject({ showDefaultFloor: false, useDefaultLighting: false, allowTeleportOnDefaultFloor: true, ambientLightColor: [.1,.2,.3], quality: 2 });
    expect(parsed.model.materials[0]).toMatchObject({ luminosity: .5, offsetU: .2, offsetV: .3, pointSize: 4 });
  });

  it.each([
    track("X", "0 1", "0 NaN"), track("X", "1 0", "0 1"), track("Visible", "0", "maybe"),
    track("X", "0 1", "0"), track("InterpolationMode", "0", "99"), track("Layer", "0", "1.5")
  ])("rejects malformed tracks rather than silently corrupting playback", async xml => {
    const parsed = await parseRaw3D(fixture(xml));
    expect(() => parsed.model.animation).toThrow();
  });
});

describe("independent dual-quaternion interpolation", () => {
  const identity = [0,0,0,1] as const;
  it("handles pure translation and antipodal quaternion representations", () => {
    const result = interpolateRaw3DDualQuaternion({ position: [0,0,0], quaternion: identity }, { position: [4,2,-6], quaternion: [0,0,0,-1] }, .25);
    expect(result.position).toEqual([1,.5,-1.5]);
    expect(result.quaternion).toEqual(identity);
  });
  it("follows a rigid pivot arc instead of independently blending translation", () => {
    const start = { position: [0,0,0] as const, quaternion: identity };
    const end = { position: [2,0,0] as const, quaternion: [0,0,1,0] as const };
    for (const t of [0, .1, .25, .5, .75, 1]) {
      const result = interpolateRaw3DDualQuaternion(start, end, t);
      const angle = 2*Math.atan2(t, 1-t);
      expect(result.position[0]).toBeCloseTo(1-Math.cos(angle));
      expect(result.position[1]).toBeCloseTo(-Math.sin(angle));
      expect(Math.hypot(...result.quaternion)).toBeCloseTo(1);
    }
  });
  it("uses coupled rigid interpolation for native mode 3 and keeps scale separate", async () => {
    const parsed = await parseRaw3D(fixture(track("X", "0 2", "0 2") + track("RZ", "0 2", `0 ${Math.PI}`) + track("SX", "0 2", "1 3"), 'InterpolationMode="3"'));
    const state = parsed.model.animation.sampleNode(1, 1);
    expect(state.location[0]).toBeCloseTo(1);expect(state.location[1]).toBeCloseTo(-1);
    expect(state.quaternion[2]).toBeCloseTo(Math.SQRT1_2);expect(state.scale[0]).toBeCloseTo(2);
    expect(raw3DQuaternionFromRotation([0, 0, Math.PI])[2]).toBeCloseTo(1);
  });
});

describe("optional Three.js playback", () => {
  it("applies layer materials, visibility, mesh/parent/deletion changes and reversible seeking", async () => {
    const updates = track("Layer", "0 1", "0 1") + track("Mesh", "0 1", "0 1") + track("Parent", "0 1", "0 2") + track("Delete", "0 2", "false true");
    const parsed = await parseRaw3D(fixture(updates));
    const playback = await createRaw3DThreePlayback(parsed, { three });
    const moving = playback.group.getObjectByName("Moving")!;
    const drawable = () => moving.children.find(child => child instanceof three.Mesh) as three.Mesh;
    expect(moving.parent?.name).toBe("Structural root");
    expect(moving.parent?.visible).toBe(true);
    expect((drawable().material as three.MeshStandardMaterial).color.r).toBe(1);
    playback.seek(1);
    expect(moving.parent?.name).toBe("Other");
    expect((drawable().material as three.MeshStandardMaterial).color.b).toBe(1);
    expect(drawable().geometry.getAttribute("position").getX(1)).toBe(2);
    playback.seek(2);expect(moving.visible).toBe(false);
    playback.seek(0);
    expect(moving.visible).toBe(true);expect(moving.parent?.name).toBe("Structural root");
    expect((drawable().material as three.MeshStandardMaterial).color.r).toBe(1);
    expect(drawable().geometry.getAttribute("position").getX(1)).toBe(1);
    const disposed = vi.spyOn(drawable().geometry, "dispose");
    playback.dispose();playback.dispose();expect(disposed).toHaveBeenCalledOnce();
    expect(() => playback.seek(0)).toThrow(/disposed/);
  });

  it("does not leak material changes between nodes sharing source materials", async () => {
    const parsed = await parseRaw3D(fixture(track("Material", "0 1", "FFFF0000 FF00FF00", 'Name="Diffuse" Index="0"')));
    const playback = await createRaw3DThreePlayback(parsed, { three });
    const color = (name: string) => ((playback.group.getObjectByName(name)!.children[0] as three.Mesh).material as three.MeshStandardMaterial).color;
    playback.seek(1);expect(color("Moving").g).toBe(1);expect(color("Other").r).toBe(1);
    playback.seek(0);expect(color("Moving").r).toBe(1);
    playback.dispose();
  });

  it("applies static visibility only to a node's drawable, preserving structural children", async () => {
    const parsed = await parseRaw3D(fixture("", 'Visible="false"'));
    const group = await createRaw3DThreeGroup(parsed, { three });
    const moving = group.getObjectByName("Moving")!;
    expect(moving.visible).toBe(true);expect(moving.children[0]!.visible).toBe(false);
    expect(group.getObjectByName("Other")!.children[0]!.visible).toBe(true);
  });
});
