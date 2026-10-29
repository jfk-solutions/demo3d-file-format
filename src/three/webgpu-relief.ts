import type * as Three from "three";
import * as GPU from "three/webgpu";
import { nodes } from "./tsl.js";
const { Fn, Loop, If, Break, float, vec3, uniform, uv, texture, positionView, positionViewDirection, normalMap } = nodes;

interface ReliefNodes {
  map: Three.Texture | null; normal: Three.Texture;
  color: GPU.MeshStandardNodeMaterial["colorNode"];
  opacity: GPU.MeshStandardNodeMaterial["opacityNode"];
  normalNode: GPU.MeshStandardNodeMaterial["normalNode"];
}
const configured = new WeakMap<Three.Material, ReliefNodes>();

export function configureNodeRelief(source: Three.Material): void {
  if (!(source instanceof GPU.MeshStandardNodeMaterial) || !source.normalMap) return;
  const material = source;
  let cached = configured.get(material);
  if (!cached || cached.map !== material.map || cached.normal !== material.normalMap) {
    const normal = material.normalMap!;
    const channel = (material.userData.raw3DHeightChannel ?? "a") as "r" | "g" | "b" | "a";
    if (!["r","g","b","a"].includes(channel)) throw new Error("A relief height channel must be r, g, b or a.");
    const depth = uniform(0).onRenderUpdate(() => Number(material.userData.raw3dNormalDepth ?? 0));
    const matrix = uniform(new GPU.Matrix3()).onRenderUpdate(() => { normal.updateMatrix();return normal.matrix; });
    const initial = matrix.mul(vec3(uv(), 1)).xy;
    // Derive an unperturbed cotangent frame; a material normal here would recurse
    // through the normal texture's own displaced UV expression.
    const dx = positionView.dFdx(), dy = positionView.dFdy(), ux = initial.dFdx(), uy = initial.dFdy();
    const tangent = dx.mul(uy.y).sub(dy.mul(ux.y)).normalize();
    const bitangent = dy.mul(ux.x).sub(dx.mul(uy.x)).normalize();
    const direction = vec3(positionViewDirection.dot(tangent), positionViewDirection.dot(bitangent), positionViewDirection.dot(dx.cross(dy).normalize()));
    const displaced = Fn(() => {
      const current = initial.toVar(), previous = initial.toVar();
      const layer = float(0).toVar(), prior = float(0).toVar();
      const ray = direction.xy.div(direction.z.abs().max(.05)).mul(depth);
      const step = ray.div(32);
      Loop(32, () => {
        const height = float(1).sub(texture(normal, current).level(0)[channel]);
        If(layer.greaterThanEqual(height), () => { Break(); });
        previous.assign(current);prior.assign(layer);current.subAssign(step);layer.addAssign(1/32);
      });
      Loop(5, () => {
        const mid = current.add(previous).mul(.5), middle = layer.add(prior).mul(.5);
        const height = float(1).sub(texture(normal, mid).level(0)[channel]);
        If(middle.lessThan(height), () => { previous.assign(mid);prior.assign(middle); }).Else(() => { current.assign(mid);layer.assign(middle); });
      });
      return current.add(previous).mul(.5);
    })();
    const coordinates = depth.abs().lessThan(.000001).select(initial, displaced);
    const color = uniform(material.color).onRenderUpdate(() => material.color);
    const opacity = uniform(material.opacity).onRenderUpdate(() => material.opacity);
    const normalScale = uniform(material.normalScale).onRenderUpdate(() => material.normalScale);
    const created: ReliefNodes = {
      map: material.map, normal,
      color: (material.map ? texture(material.map, coordinates).rgb.mul(color) : color) as unknown as ReliefNodes["color"],
      opacity: (material.map ? texture(material.map, coordinates).a.mul(opacity) : opacity) as unknown as ReliefNodes["opacity"],
      normalNode: normalMap(texture(normal, coordinates), normalScale) as unknown as ReliefNodes["normalNode"]
    };
    configured.set(material, created);cached = created;
  }
  material.colorNode = cached.color;material.opacityNode = cached.opacity;material.normalNode = cached.normalNode;
}
