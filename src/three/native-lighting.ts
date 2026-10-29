import type * as Three from "three";
import type { Raw3DLightState } from "../raw3d-effects.js";
import type { Raw3DThreeModule } from "./raw3d.js";

const configured = new WeakSet<Three.Material>();
interface LightFrame {
  frame: number; scene: Three.Scene; camera: Three.Camera;
  points: Three.Vector4[]; pointFlags: number[]; spots: Three.Vector4[]; cones: Three.Vector4[];
}
const frames = new WeakMap<Three.WebGLRenderer, LightFrame>();

/** Public WebGL shader hooks adapt native constant/linear/quadratic attenuation. */
export function configureRaw3DLightMaterial(material: Three.Material, three: Raw3DThreeModule): void {
  if (configured.has(material) || !(material instanceof three.MeshStandardMaterial)) return;
  configured.add(material);
  const point = { value: [] as Three.Vector4[] }, pointNative = { value: [] as number[] };
  const spot = { value: [] as Three.Vector4[] }, cone = { value: [] as Three.Vector4[] };
  const compile = material.onBeforeCompile, render = material.onBeforeRender;
  material.customProgramCacheKey = () => "raw3d-native-lighting-v1";
  material.onBeforeRender = function(...args) {
    render.apply(this, args);
    const [renderer, scene, camera] = args;
    if ("isWebGPURenderer" in renderer) return;
    const cached = frames.get(renderer);
    if (cached?.frame === renderer.info.render.frame && cached.scene === scene && cached.camera === camera) {
      point.value = cached.points;pointNative.value = cached.pointFlags;spot.value = cached.spots;cone.value = cached.cones;return;
    }
    const lights: Array<Three.PointLight | Three.SpotLight> = [];
    scene.traverseVisible(object => {
      if ((object instanceof three.PointLight || object instanceof three.SpotLight) && object.layers.test(camera.layers)) lights.push(object);
    });
    // Keep the same light order as Three.js, including shadow/map priorities.
    const priority = (light: Three.PointLight | Three.SpotLight) => (light.castShadow ? 2 : 0) + (light instanceof three.SpotLight && light.map ? 1 : 0);
    lights.sort((a,b) => priority(b)-priority(a));
    point.value = [];pointNative.value = [];spot.value = [];cone.value = [];
    for (const light of lights) {
      const state = light.userData.raw3d?.parameters as Raw3DLightState | undefined;
      const vector = state ? new three.Vector4(state.attenuationConstant, state.attenuationLinear, state.attenuationQuadratic, state.attenuationRange) : new three.Vector4();
      if (light instanceof three.PointLight) { point.value.push(vector);pointNative.value.push(state ? 1 : 0); }
      else { spot.value.push(vector);cone.value.push(state ? new three.Vector4(Math.cos(state.spotlightInnerAngle/2), Math.cos(state.spotlightOuterAngle/2), state.spotlightFalloff, 1) : new three.Vector4()); }
    }
    frames.set(renderer, { frame: renderer.info.render.frame, scene, camera, points: point.value, pointFlags: pointNative.value, spots: spot.value, cones: cone.value });
  };
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    Object.assign(shader.uniforms, { raw3DPoint: point, raw3DPointNative: pointNative, raw3DSpot: spot, raw3DCone: cone });
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_pars_begin>", `#include <lights_pars_begin>
      float raw3DFalloff(float distance, vec4 coefficients) {
        if (coefficients.w > 0.0 && distance > coefficients.w) return 0.0;
        return 1.0 / max(0.000001, coefficients.x + distance*coefficients.y + distance*distance*coefficients.z);
      }
      #if NUM_POINT_LIGHTS > 0
      uniform vec4 raw3DPoint[NUM_POINT_LIGHTS];
      uniform float raw3DPointNative[NUM_POINT_LIGHTS];
      #endif
      #if NUM_SPOT_LIGHTS > 0
      uniform vec4 raw3DSpot[NUM_SPOT_LIGHTS];
      uniform vec4 raw3DCone[NUM_SPOT_LIGHTS];
      #endif
    `);
    let fragment = three.ShaderChunk.lights_fragment_begin;
    fragment = fragment.replace("getPointLightInfo( pointLight, geometryPosition, directLight );", `getPointLightInfo( pointLight, geometryPosition, directLight );
      if (raw3DPointNative[ i ] > 0.5) {
        directLight.color = pointLight.color * raw3DFalloff(length(pointLight.position - geometryPosition), raw3DPoint[ i ]);
        directLight.visible = any(greaterThan(directLight.color, vec3(0.0)));
      }`);
    fragment = fragment.replace("getSpotLightInfo( spotLight, geometryPosition, directLight );", `getSpotLightInfo( spotLight, geometryPosition, directLight );
      if (raw3DCone[ i ].w > 0.5) {
        float cosine = dot(directLight.direction, spotLight.direction);
        float width = raw3DCone[ i ].x - raw3DCone[ i ].y;
        float factor = width > 0.000001 ? clamp((cosine - raw3DCone[ i ].y)/width, 0.0, 1.0) : step(raw3DCone[ i ].y, cosine);
        float angular = cosine < raw3DCone[ i ].y ? 0.0 : pow(factor, max(0.000001, raw3DCone[ i ].z));
        directLight.color = spotLight.color * angular * raw3DFalloff(length(spotLight.position-geometryPosition), raw3DSpot[ i ]);
        directLight.visible = any(greaterThan(directLight.color, vec3(0.0)));
      }`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_begin>", fragment);
  };
}
