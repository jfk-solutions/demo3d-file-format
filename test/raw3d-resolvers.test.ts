import { describe, expect, it, vi } from "vitest";
import * as three from "three";
import { parseRaw3D } from "../src/index.js";
import { createRaw3DThreePlayback } from "../src/three/index.js";
import { createZip } from "./helpers.js";

const strings = (update: string) => createZip([{ name: "Model.xml", data: `<Scene><Nodes><Node Index="0"/></Nodes><Updates>${update}</Updates></Scene>` }]);
const streamFixture = () => createZip([
  { name: "Model.xml", data: '<Scene><Nodes><Node Index="0" Mesh="0" Materials="0"/></Nodes><Materials><Material R="1" G="1" B="1" StreamableTexture="7"/></Materials><StreamableTextures><StreamableTexture Index="7" Name="Camera" Path="camera.png" Width="1" Height="1"/></StreamableTextures><Meshes><Mesh VertexBuffer="0" IndexBuffers="0"/></Meshes><VertexBuffers><VertexBuffer Path="v"><Attribute Usage="Position" Type="Vector3"/></VertexBuffer></VertexBuffers><IndexBuffers><IndexBuffer Path="i" Format="Int16"/></IndexBuffers></Scene>' },
  { name: "v", data: new Uint8Array(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer) },
  { name: "i", data: new Uint8Array(new Uint16Array([0,1,2]).buffer) }
]);

describe("lossless string key sources", () => {
  it("uses authoritative sidecar keys without guessing native boundaries", async () => {
    const resolver = vi.fn(() => ["hello world", ""]);
    const parsed = await parseRaw3D(strings('<UserData Node="0" Time="0 1" Value="hello world "/>'), { resolveStringKeys: resolver });
    expect(parsed.model.animation.sampleNode(0,0).userData).toBe("hello world");
    expect(parsed.model.animation.sampleNode(0,1).userData).toBe("");
    expect(parsed.model.animation.warnings).toEqual([]);
    expect(resolver.mock.calls[0]).toBeDefined();
  });
  it("accepts explicit arrays and JSON encoding including spaces, empty strings and Unicode", async () => {
    const explicit = await parseRaw3D(strings('<UserData Node="0" Time="0 1"><Values><Value></Value><Value>Grüße 世界</Value></Values></UserData>'));
    expect(explicit.model.animation.sampleNode(0,0).userData).toBe("");
    expect(explicit.model.animation.sampleNode(0,1).userData).toBe("Grüße 世界");
    const json = await parseRaw3D(strings('<UserData Node="0" Time="0 1" ValueEncoding="json" Value="[&quot;one two&quot;,&quot;three four&quot;]"/>'));
    expect(json.model.animation.sampleNode(0,1).userData).toBe("three four");
  });
  it("rejects resolver output with wrong lengths or non-string values", async () => {
    const parsed = await parseRaw3D(strings('<UserData Node="0" Time="0 1" Value="a b"/>'), { resolveStringKeys: () => ["only one"] });
    expect(() => parsed.model.animation).toThrow(/string keys/);
  });
});

describe("external resources and time-indexed texture providers", () => {
  it("loads missing resources explicitly while retaining stream descriptors", async () => {
    const resolver = vi.fn((path: string) => path === "camera.png" ? new Uint8Array([1,2,3]) : undefined);
    const parsed = await parseRaw3D(streamFixture(), { resolveResource: resolver });
    expect(parsed.model.streamableTextures[0]).toMatchObject({ index: 7, name: "Camera", width: 1, height: 1, data: new Uint8Array([1,2,3]) });
    expect(resolver).toHaveBeenCalledExactlyOnceWith("camera.png");
  });
  it("resolves reversible frames without disposing caller-owned textures", async () => {
    const textures = [0,1].map(value => new three.DataTexture(new Uint8Array([value,0,0,255]),1,1));
    const dispose = textures.map(texture => vi.spyOn(texture,"dispose"));
    const parsed = await parseRaw3D(streamFixture());
    const playback = await createRaw3DThreePlayback(parsed, { three, resolveStreamTexture: ({time,source}) => {
      expect(source?.name).toBe("Camera");return textures[Math.min(1, Math.floor(time))];
    } });
    const image = () => ((playback.group.children[0]!.children[0] as three.Mesh).material as three.MeshStandardMaterial).map!.image;
    expect(image()).toBe(textures[0]!.image);
    await playback.seekAsync(1);expect(image()).toBe(textures[1]!.image);
    await playback.seekAsync(0);expect(image()).toBe(textures[0]!.image);
    playback.dispose();for (const spy of dispose) expect(spy).not.toHaveBeenCalled();
    for (const texture of textures) texture.dispose();
  });
  it("cancels stale frame requests and never overwrites a newer seek", async () => {
    const texture = new three.DataTexture(new Uint8Array([1,2,3,255]),1,1);
    let release: ((texture: three.Texture) => void) | undefined, oldSignal: AbortSignal | undefined;
    const parsed = await parseRaw3D(streamFixture());
    const playback = await createRaw3DThreePlayback(parsed, { three, resolveStreamTexture: ({time,signal}) => {
      if (time === 1) { oldSignal=signal;return new Promise<three.Texture>(resolve => {release=resolve;}); }
      return texture;
    } });
    const old = playback.seekAsync(1);
    expect(await playback.seekAsync(2)).toBe(true);expect(oldSignal!.aborted).toBe(true);
    release!(texture);expect(await old).toBe(false);
    playback.dispose();texture.dispose();
  });
  it("clears an unavailable frame instead of keeping a future image on a backward seek", async () => {
    const texture = new three.DataTexture(new Uint8Array([1,2,3,255]),1,1);
    const parsed = await parseRaw3D(streamFixture());
    const playback = await createRaw3DThreePlayback(parsed, { three, resolveStreamTexture: ({time}) => time === 1 ? undefined : texture });
    await playback.seekAsync(1);
    const material = (playback.group.children[0]!.children[0] as three.Mesh).material as three.MeshStandardMaterial;
    expect(material.map).toBeNull();
    expect(playback.group.userData.raw3d.warnings.some((warning: {code:string}) => warning.code === "RAW3D_STREAM_TEXTURE_UNAVAILABLE")).toBe(true);
    playback.dispose();texture.dispose();
  });
});
