import * as GPU from "three/webgpu";
import { nodes, type Expression } from "./tsl.js";
import type { Raw3DLightState } from "../raw3d-effects.js";
import { registerRaw3DNodeBackend } from "./backend.js";
import { configureNodeRelief } from "./webgpu-relief.js";

class NativePoint extends GPU.PointLight {}
class NativeSpot extends GPU.SpotLight {}
const { uniform, vec3, float, lightTargetDirection } = nodes;
const parameters = (light: GPU.Light): Expression => {
  const value = new GPU.Vector4();
  return uniform(value).onRenderUpdate(() => {
    const state = light.userData.raw3d.parameters as Raw3DLightState;
    return value.set(state.attenuationConstant, state.attenuationLinear, state.attenuationQuadratic, state.attenuationRange);
  });
};
const attenuation = (distance: Expression, coefficients: Expression): Expression => {
  const denominator = coefficients.x.add(distance.mul(coefficients.y)).add(distance.mul(distance).mul(coefficients.z)).max(.000001);
  return coefficients.w.greaterThan(0).and(distance.greaterThan(coefficients.w)).select(float(0), denominator.reciprocal());
};
class NativePointNode extends GPU.PointLightNode {
  static get type() { return "Raw3DPointLightNode"; }
  override setupDirect(builder: GPU.NodeBuilder) {
    const vector = vec3(this.getLightVector(builder));
    const color = vec3((this as unknown as { colorNode: GPU.Node }).colorNode);
    return { lightDirection: vector.normalize() as unknown as GPU.Node, lightColor: color.mul(attenuation(vector.length(), parameters(this.light!))) as unknown as GPU.Node };
  }
}
class NativeSpotNode extends GPU.SpotLightNode {
  static get type() { return "Raw3DSpotLightNode"; }
  override setupDirect(builder: GPU.NodeBuilder) {
    const vector = vec3(this.getLightVector(builder)), direction = vector.normalize();
    const cone = new GPU.Vector3();
    const shape = uniform(cone).onRenderUpdate(() => {
      const state = this.light!.userData.raw3d.parameters as Raw3DLightState;
      return cone.set(Math.cos(state.spotlightInnerAngle/2), Math.cos(state.spotlightOuterAngle/2), Math.max(.000001, state.spotlightFalloff));
    });
    const cosine = direction.dot(lightTargetDirection(this.light!));
    const factor = cosine.sub(shape.y).div(shape.x.sub(shape.y).max(.000001)).clamp(0,1);
    const angular = cosine.lessThan(shape.y).select(float(0), factor.pow(shape.z));
    return { lightDirection: direction as unknown as GPU.Node, lightColor: vec3(this.colorNode).mul(angular).mul(attenuation(vector.length(), parameters(this.light!))) as unknown as GPU.Node };
  }
}
const configured = new WeakSet<GPU.WebGPURenderer>();
export function configure(renderer: GPU.WebGPURenderer, module: typeof GPU): void {
  if (!configured.has(renderer)) {
    const library = renderer.library as unknown as { addLight(node: typeof GPU.PointLightNode | typeof GPU.SpotLightNode, light: typeof GPU.PointLight | typeof GPU.SpotLight): void };
    library.addLight(NativePointNode, NativePoint);
    library.addLight(NativeSpotNode, NativeSpot);
    configured.add(renderer);
  }
  registerRaw3DNodeBackend(module, {
    point: () => new NativePoint(), spot: () => new NativeSpot(),
    standard: parameters => new GPU.MeshStandardNodeMaterial(parameters) as unknown as GPU.MeshStandardMaterial,
    configure: configureNodeRelief
  });
}
