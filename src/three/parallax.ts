import type * as Three from "three";
import type { Raw3DThreeModule } from "./raw3d.js";

const configured = new WeakSet<Three.Material>();

/** Layered height ray-marching with binary refinement; height is packed in the normal image. */
export function configureRaw3DRelief(source: Three.Material, three: Raw3DThreeModule): void {
  if (!(source instanceof three.MeshStandardMaterial) || configured.has(source) || !source.normalMap) return;
  const material = source;
  configured.add(material);
  const channel = String(material.userData.raw3DHeightChannel ?? "a");
  if (!["r", "g", "b", "a"].includes(channel)) throw new Error("A relief height channel must be r, g, b or a.");
  const depth = { value: Number(material.userData.raw3dNormalDepth ?? 0) };
  const height = { value: material.normalMap };
  const compile = material.onBeforeCompile, render = material.onBeforeRender, cacheKey = material.customProgramCacheKey;
  const previousKey = cacheKey.call(material);
  material.customProgramCacheKey = () => `${previousKey}:raw3d-relief-${channel}`;
  material.onBeforeRender = function(...args) {
    render.apply(this, args);depth.value = Number(material.userData.raw3dNormalDepth ?? 0);height.value = material.normalMap;
  };
  material.onBeforeCompile = function(shader, renderer) {
    compile.call(this, shader, renderer);
    Object.assign(shader.uniforms, { raw3DReliefDepth: depth, raw3DReliefHeight: height });
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      uniform float raw3DReliefDepth;
      uniform sampler2D raw3DReliefHeight;
      vec2 raw3DRelief(vec2 initial, vec3 viewDirection, vec3 position) {
        if (abs(raw3DReliefDepth) < 0.000001) return initial;
        vec3 dx = dFdx(position), dy = dFdy(position);
        vec2 ux = dFdx(initial), uy = dFdy(initial);
        vec3 tangent = normalize(dx * uy.y - dy * ux.y);
        vec3 bitangent = normalize(dy * ux.x - dx * uy.x);
        vec3 normal = normalize(cross(dx, dy));
        vec3 ray = vec3(dot(viewDirection, tangent), dot(viewDirection, bitangent), dot(viewDirection, normal));
        vec2 stepUV = ray.xy / max(abs(ray.z), 0.05) * raw3DReliefDepth / 32.0;
        vec2 current = initial, previous = initial;
        float layer = 0.0, prior = 0.0;
        for (int layerIndex = 0; layerIndex < 32; layerIndex++) {
          float surface = 1.0 - textureLod(raw3DReliefHeight, current, 0.0).${channel};
          if (layer >= surface) break;
          previous = current;prior = layer;current -= stepUV;layer += 1.0/32.0;
        }
        for (int refinement = 0; refinement < 5; refinement++) {
          vec2 middle = (current+previous)*0.5;
          float middleDepth = (layer+prior)*0.5;
          float surface = 1.0 - textureLod(raw3DReliefHeight, middle, 0.0).${channel};
          if (middleDepth < surface) { previous = middle;prior = middleDepth; }
          else { current = middle;layer = middleDepth; }
        }
        return (current+previous)*0.5;
      }
    `);
    let map = three.ShaderChunk.map_fragment.replace(/\bvMapUv\b/g, "( vMapUv + raw3DReliefOffset )");
    map = `vec2 raw3DReliefOffset = vec2(0.0);
      #ifdef USE_NORMALMAP
      raw3DReliefOffset = raw3DRelief(vNormalMapUv, normalize(vViewPosition), -vViewPosition) - vNormalMapUv;
      #endif
      ${map}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", map);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", three.ShaderChunk.normal_fragment_maps.replace(/\bvNormalMapUv\b/g, "( vNormalMapUv + raw3DReliefOffset )"));
  };
}
