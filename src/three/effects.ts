import type * as Three from "three";
import type { Raw3DEffectState } from "../raw3d-effects.js";
import type { Raw3DProject } from "../raw3d.js";
import type { Raw3DThreeModule } from "./raw3d.js";
import { configureRaw3DLightMaterial } from "./native-lighting.js";

const billboardState = new WeakMap<Three.Object3D, { rotation: Three.Quaternion; callback: Three.Object3D["onBeforeRender"] }>();

export function configureRaw3DDrawable(object: Three.Object3D, billboard: boolean, decal: boolean, three: Raw3DThreeModule): void {
  if (billboard && !billboardState.has(object)) {
    const saved = { rotation: object.quaternion.clone(), callback: object.onBeforeRender };
    billboardState.set(object, saved);
    const cameraRotation = new three.Quaternion(), parentRotation = new three.Quaternion();
    object.onBeforeRender = function(...args) {
      saved.callback.apply(this, args);
      const camera = args[2];
      camera.getWorldQuaternion(cameraRotation);
      this.parent?.getWorldQuaternion(parentRotation);
      this.quaternion.copy(parentRotation.invert()).multiply(cameraRotation);
      this.updateMatrixWorld(true);
    };
  } else if (!billboard && billboardState.has(object)) {
    const saved = billboardState.get(object)!;
    object.quaternion.copy(saved.rotation);object.onBeforeRender = saved.callback;billboardState.delete(object);
  }
  object.renderOrder = decal ? 1 : 0;
  const drawable = object as Three.Mesh;
  if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
    material.polygonOffset = decal;material.polygonOffsetFactor = decal ? -1 : 0;material.polygonOffsetUnits = decal ? -1 : 0;
    if (decal) material.depthWrite = false;
    configureRaw3DLightMaterial(material, three);
  }
}

export function applyRaw3DThreeEffects(group: Three.Group, frame: Raw3DEffectState, project: Raw3DProject, three: Raw3DThreeModule): void {
  const sources = new Map(project.lights.map((source, index) => [source.index ?? index, source]));
  const lights: Three.Light[] = [];
  group.traverse(object => { if (object.userData.raw3d?.kind === "light") lights.push(object as Three.Light); });
  for (let light of lights) {
    const index = light.userData.raw3d.index as number, state = frame.lights.get(index), source = sources.get(index);
    if (!state || !source) continue;
    const wanted = state.type === 1 ? "PointLight" : state.type === 2 ? "SpotLight" : "DirectionalLight";
    if (light.type !== wanted && light.type !== "AmbientLight") {
      const parent = light.parent!;
      const previous = light as Three.DirectionalLight;
      previous.target?.removeFromParent();previous.shadow?.dispose();
      const replacement = state.type === 1 ? new three.PointLight() : state.type === 2 ? new three.SpotLight() : new three.DirectionalLight();
      replacement.userData = light.userData;replacement.name = light.name;parent.remove(light);parent.add(replacement);light = replacement;
    }
    light.visible = state.enabled;
    const material = source.materialIndex === undefined ? undefined : project.materials[source.materialIndex];
    if (material) light.color.setRGB(material.red, material.green, material.blue);
    if (state.materialProperties.Diffuse !== undefined) light.color.setHex(state.materialProperties.Diffuse & 0xffffff, three.SRGBColorSpace);
    if (light instanceof three.PointLight || light instanceof three.SpotLight || light instanceof three.DirectionalLight) light.castShadow = state.castsShadows;
    if (light instanceof three.PointLight || light instanceof three.SpotLight) { light.distance = Math.max(0, state.attenuationRange);light.decay = 0; }
    if (light instanceof three.SpotLight) {
      light.angle = Math.max(.00001, Math.min(Math.PI/2, state.spotlightOuterAngle/2));
      light.penumbra = state.spotlightOuterAngle > 0 ? Math.max(0, Math.min(1, 1-state.spotlightInnerAngle/state.spotlightOuterAngle)) : 0;
    }
    if (light instanceof three.SpotLight || light instanceof three.DirectionalLight) {
      light.target.position.set(0,0,-1);light.parent!.add(light.target);
    }
    light.userData.raw3d.parameters = state;
  }
  const hasSceneState = project.sceneProperties !== undefined || project.animation.effects.tracks.some(track => track.target === "scene");
  if (hasSceneState) {
    let ambient = group.children.find(object => object.userData.raw3d?.kind === "scene-ambient") as Three.AmbientLight | undefined;
    if (!ambient) { ambient = new three.AmbientLight();ambient.userData.raw3d = { kind: "scene-ambient" };group.add(ambient); }
    ambient.color.setRGB(...frame.scene.ambientLightColor);
    let key = group.children.find(object => object.userData.raw3d?.kind === "scene-default-light") as Three.DirectionalLight | undefined;
    if (!key) { key = new three.DirectionalLight(0xffffff, 1);key.position.set(3,5,4);key.userData.raw3d = { kind: "scene-default-light" };group.add(key); }
    key.visible = frame.scene.useDefaultLighting;
    let floor = group.children.find(object => object.userData.raw3d?.kind === "scene-floor") as Three.Mesh | undefined;
    if (!floor && frame.scene.showDefaultFloor) {
      const bounds = new three.Box3().setFromObject(group), size = bounds.getSize(new three.Vector3());
      const extent = Math.max(size.x, size.z, 1)*1.2;
      floor = new three.Mesh(new three.PlaneGeometry(extent, extent), new three.MeshStandardMaterial({ color: 0x777777, roughness: 1, side: three.DoubleSide }));
      floor.userData.raw3d = { kind: "scene-floor" };
      const origin = project.sceneProperties?.floorOrigin ?? [];
      const normal = project.sceneProperties?.floorNormal ?? [];
      floor.position.set(origin[0] ?? 0, origin[1] ?? 0, -(origin[2] ?? 0));
      const direction = new three.Vector3(normal[0] ?? 0, normal[1] ?? 1, -(normal[2] ?? 0));
      if (direction.lengthSq() < 1e-12) throw new Error("RAW3D floor normal must be nonzero.");
      direction.normalize();
      const center = bounds.isEmpty() ? floor.position.clone() : bounds.getCenter(new three.Vector3());
      center.addScaledVector(direction, -center.clone().sub(floor.position).dot(direction));floor.position.copy(center);
      floor.quaternion.setFromUnitVectors(new three.Vector3(0,0,1), direction);
      floor.receiveShadow = true;configureRaw3DLightMaterial(floor.material as Three.Material, three);group.add(floor);
    }
    if (floor) floor.visible = frame.scene.showDefaultFloor;
  }
  group.updateMatrixWorld(true);
}
