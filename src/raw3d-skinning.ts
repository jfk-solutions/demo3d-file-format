import type { Raw3DMesh, Raw3DProject } from "./raw3d.js";

export interface Raw3DSkinInfluence { readonly boneIndex: number; readonly weight: number }

/** Decode the native per-bone vertex-index and float-weight buffers without a renderer. */
export function decodeRaw3DSkinInfluences(mesh: Raw3DMesh, project: Raw3DProject): readonly (readonly Raw3DSkinInfluence[])[] {
  const vertexBuffer = project.vertexBuffers[mesh.vertexBufferIndex];
  if (!vertexBuffer?.data || vertexBuffer.stride <= 0 || vertexBuffer.data.byteLength % vertexBuffer.stride) throw new Error("Invalid RAW3D skinned vertex buffer.");
  const count = vertexBuffer.data.byteLength / vertexBuffer.stride;
  const result: Raw3DSkinInfluence[][] = Array.from({ length: count }, () => []);
  mesh.bones.forEach((bone, boneIndex) => {
    if (bone.skinIndexBuffer < 0 && bone.skinWeightsVertexBuffer < 0) return;
    const indices = project.indexBuffers[bone.skinIndexBuffer], weights = project.vertexBuffers[bone.skinWeightsVertexBuffer];
    if (!indices?.data || !weights?.data) throw new Error(`Missing RAW3D skin buffers for bone ${boneIndex}.`);
    const elementSize = /32/i.test(indices.format) ? 4 : 2;
    if (indices.data.byteLength % elementSize) throw new Error(`Invalid RAW3D skin index buffer for bone ${boneIndex}.`);
    const length = indices.data.byteLength/elementSize;
    const stride = weights.data.byteLength === length*4 ? 4 : weights.stride;
    if (stride < 4 || weights.data.byteLength !== length*stride) throw new Error(`Invalid RAW3D skin weight buffer for bone ${boneIndex}.`);
    const indexView = new DataView(indices.data.buffer, indices.data.byteOffset, indices.data.byteLength);
    const weightView = new DataView(weights.data.buffer, weights.data.byteOffset, weights.data.byteLength);
    for (let index = 0; index < length; index++) {
      const vertex = elementSize === 4 ? indexView.getUint32(index*4, true) : indexView.getUint16(index*2, true);
      const weight = weightView.getFloat32(index*stride, true);
      if (vertex >= count || !Number.isFinite(weight) || weight < 0) throw new Error(`Invalid RAW3D skin influence for bone ${boneIndex}.`);
      if (weight > 0) result[vertex]!.push({ boneIndex, weight });
    }
  });
  return result.map(influences => {
    const sum = influences.reduce((total, influence) => total+influence.weight, 0);
    return influences.map(influence => ({ boneIndex: influence.boneIndex, weight: influence.weight/sum }));
  });
}
