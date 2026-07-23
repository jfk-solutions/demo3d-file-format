import { describe, expect, it } from "vitest";
import * as three from "three";
import {
  applyDemo3DThreeRenderMode,
  type Demo3DThreeRendererInstance
} from "../src/three/index.js";

describe("Three render modes", () => {
  it("keeps the standard mode lightweight", () => {
    const { renderer, scene, object } = fixture();
    const result = applyDemo3DThreeRenderMode({
      three,
      renderer,
      scene,
      object,
      mode: "standard"
    });

    expect(renderer.shadowMap.enabled).toBe(false);
    expect(result.ground).toBeUndefined();
    expect(result.lighting.children.some((child) => child instanceof three.DirectionalLight)).toBe(true);
  });

  it("adds soft shadows, a ground plane, and restores state when disposed", () => {
    const { renderer, scene, object, mesh } = fixture();
    const originalToneMapping = renderer.toneMapping;
    const result = applyDemo3DThreeRenderMode({
      three,
      renderer,
      scene,
      object,
      mode: "enhanced",
      shadowMapSize: 1024
    });

    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(three.PCFSoftShadowMap);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    expect(result.ground?.receiveShadow).toBe(true);
    expect(scene.getObjectByName("Demo3D Shadow Ground")).toBe(result.ground);
    const key = result.lighting.getObjectByName("Demo3D Key Light") as three.DirectionalLight;
    expect(key.castShadow).toBe(true);
    expect(key.shadow.mapSize.x).toBe(1024);

    result.dispose();

    expect(renderer.shadowMap.enabled).toBe(false);
    expect(renderer.toneMapping).toBe(originalToneMapping);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(scene.getObjectByName("Demo3D Shadow Ground")).toBeUndefined();
  });
});

function fixture(): {
  renderer: Demo3DThreeRendererInstance;
  scene: three.Scene;
  object: three.Group;
  mesh: three.Mesh;
} {
  const renderer = {
    outputColorSpace: three.LinearSRGBColorSpace,
    toneMapping: three.NoToneMapping,
    toneMappingExposure: 1,
    shadowMap: {
      enabled: false,
      type: three.BasicShadowMap
    }
  } as unknown as Demo3DThreeRendererInstance;
  const scene = new three.Scene();
  const object = new three.Group();
  const mesh = new three.Mesh(
    new three.BoxGeometry(2, 2, 2),
    new three.MeshStandardMaterial({ color: 0xffffff })
  );
  object.add(mesh);
  scene.add(object);
  return { renderer, scene, object, mesh };
}
