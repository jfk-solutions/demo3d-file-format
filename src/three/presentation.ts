import type * as Three from "three";
import type { Demo3DThreeRendererInstance, Demo3DThreeModule } from "./renderer.js";

export type Demo3DThreeRenderMode = "standard" | "enhanced";

export interface Demo3DThreeRenderModeOptions {
  readonly three: Demo3DThreeModule;
  readonly renderer: Demo3DThreeRendererInstance;
  readonly scene: Three.Scene;
  readonly object: Three.Object3D;
  readonly mode?: Demo3DThreeRenderMode;
  /** Optional display bounds, useful when a scene contains distant outliers. */
  readonly bounds?: Three.Box3;
  /** Shadow texture size used by the enhanced mode. Defaults to 2048. */
  readonly shadowMapSize?: number;
  /** Adds a matte floor below the model in enhanced mode. Defaults to true. */
  readonly ground?: boolean;
  readonly groundColor?: Three.ColorRepresentation;
}

export interface Demo3DThreeRenderModeResult {
  readonly mode: Demo3DThreeRenderMode;
  readonly lighting: Three.Group;
  readonly ground?: Three.Mesh;
  /** Removes objects created by the mode and restores renderer/object settings. */
  dispose(): void;
}

/**
 * Applies a complete presentation preset to an already-created Demo3D or RAW3D
 * Three.js object. The enhanced mode adds soft directional shadows, a contact
 * floor, and more dimensional key/fill lighting.
 */
export function applyDemo3DThreeRenderMode(
  options: Demo3DThreeRenderModeOptions
): Demo3DThreeRenderModeResult {
  const { three, renderer, scene, object } = options;
  const mode = options.mode ?? "standard";
  const enhanced = mode === "enhanced";
  const previousRenderer = {
    outputColorSpace: renderer.outputColorSpace,
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
    shadowMapEnabled: renderer.shadowMap.enabled,
    shadowMapType: renderer.shadowMap.type
  };

  renderer.outputColorSpace = three.SRGBColorSpace;
  renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.toneMappingExposure = enhanced ? 1.15 : 1.1;
  renderer.shadowMap.enabled = enhanced;
  if (enhanced) {
    renderer.shadowMap.type = three.PCFSoftShadowMap;
  }

  const bounds = presentationBounds(object, options.bounds, three);
  const center = bounds.getCenter(new three.Vector3());
  const size = bounds.getSize(new three.Vector3());
  const radius = Math.max(size.length() * 0.5, 1);
  const lighting = new three.Group();
  lighting.name = `Demo3D ${enhanced ? "Enhanced" : "Standard"} Lighting`;

  const hemisphere = new three.HemisphereLight(
    enhanced ? 0xeaf7ff : 0xeaf6ff,
    enhanced ? 0x17252b : 0x18272d,
    enhanced ? 1.25 : 1.65
  );
  hemisphere.name = "Demo3D Hemisphere Light";
  lighting.add(hemisphere);

  const key = new three.DirectionalLight(0xffffff, enhanced ? 3.0 : 2.1);
  key.name = "Demo3D Key Light";
  key.position.copy(center).add(new three.Vector3(radius * 0.9, radius * 1.4, radius * 0.75));
  key.target.position.copy(center);
  lighting.add(key, key.target);

  let ground: Three.Mesh | undefined;
  const objectShadowStates: Array<{
    object: Three.Object3D;
    castShadow: boolean;
    receiveShadow: boolean;
  }> = [];

  if (enhanced) {
    key.castShadow = true;
    const shadowSpan = radius * 1.15;
    const shadowMapSize = clampShadowMapSize(options.shadowMapSize);
    key.shadow.camera.left = -shadowSpan;
    key.shadow.camera.right = shadowSpan;
    key.shadow.camera.top = shadowSpan;
    key.shadow.camera.bottom = -shadowSpan;
    key.shadow.camera.near = Math.max(radius * 0.02, 0.01);
    key.shadow.camera.far = radius * 5;
    key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = radius * 0.0004;

    const fill = new three.DirectionalLight(0x9fc7e2, 0.65);
    fill.name = "Demo3D Fill Light";
    fill.position.copy(center).add(new three.Vector3(-radius, radius * 0.55, -radius * 0.8));
    fill.target.position.copy(center);
    lighting.add(fill, fill.target);

    object.traverse((child) => {
      const mesh = child as Three.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      objectShadowStates.push({
        object: child,
        castShadow: child.castShadow,
        receiveShadow: child.receiveShadow
      });
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const castsOpaqueShadow = materials.some((material) => material.visible && material.opacity >= 0.99);
      child.castShadow = castsOpaqueShadow;
      child.receiveShadow = castsOpaqueShadow;
    });

    if (options.ground !== false && !bounds.isEmpty()) {
      const horizontalSize = Math.max(size.x, size.z, radius, 1) * 2.4;
      const geometry = new three.PlaneGeometry(horizontalSize, horizontalSize);
      const material = new three.MeshStandardMaterial({
        color: options.groundColor ?? 0x294854,
        roughness: 1,
        metalness: 0
      });
      ground = new three.Mesh(geometry, material);
      ground.name = "Demo3D Shadow Ground";
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(center.x, bounds.min.y - Math.max(radius * 0.002, 0.002), center.z);
      ground.receiveShadow = true;
      scene.add(ground);
    }
  }

  scene.add(lighting);
  let disposed = false;

  return {
    mode,
    lighting,
    ground,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      scene.remove(lighting);
      if (enhanced) {
        key.shadow.dispose();
      }
      if (ground) {
        scene.remove(ground);
        ground.geometry.dispose();
        const materials = Array.isArray(ground.material) ? ground.material : [ground.material];
        for (const material of materials) {
          material.dispose();
        }
      }
      for (const state of objectShadowStates) {
        state.object.castShadow = state.castShadow;
        state.object.receiveShadow = state.receiveShadow;
      }
      renderer.outputColorSpace = previousRenderer.outputColorSpace;
      renderer.toneMapping = previousRenderer.toneMapping;
      renderer.toneMappingExposure = previousRenderer.toneMappingExposure;
      renderer.shadowMap.enabled = previousRenderer.shadowMapEnabled;
      renderer.shadowMap.type = previousRenderer.shadowMapType;
    }
  };
}

function presentationBounds(
  object: Three.Object3D,
  supplied: Three.Box3 | undefined,
  three: Demo3DThreeModule
): Three.Box3 {
  const bounds = supplied?.clone() ?? new three.Box3().setFromObject(object);
  if (!bounds.isEmpty()) {
    return bounds;
  }
  return new three.Box3(
    new three.Vector3(-0.5, -0.5, -0.5),
    new three.Vector3(0.5, 0.5, 0.5)
  );
}

function clampShadowMapSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 2048;
  }
  return Math.max(256, Math.min(4096, Math.round(value)));
}
