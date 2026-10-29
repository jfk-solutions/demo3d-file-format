import type * as Three from "three";
import type * as GPU from "three/webgpu";

export interface Raw3DNodeBackend {
  point(): Three.PointLight;
  spot(): Three.SpotLight;
  standard(parameters: Three.MeshStandardMaterialParameters): Three.MeshStandardMaterial;
  configure(material: Three.Material): void;
}
const backends = new WeakMap<object, Raw3DNodeBackend>();
export function registerRaw3DNodeBackend(module: object, backend: Raw3DNodeBackend): void { backends.set(module, backend); }
export function raw3DNodeBackend(module: object): Raw3DNodeBackend | undefined { return backends.get(module); }

/** Call before building RAW3D groups when using a manually created node renderer. */
export async function configureRaw3DWebGPURenderer(renderer: GPU.WebGPURenderer, module?: typeof GPU): Promise<void> {
  const implementation = await import("./webgpu-native.js");
  implementation.configure(renderer, module ?? await import("three/webgpu"));
}
