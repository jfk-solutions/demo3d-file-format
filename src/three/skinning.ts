import type * as Three from "three";
import type { Raw3DProject } from "../raw3d.js";
import { decodeRaw3DSkinInfluences } from "../raw3d-skinning.js";
import type { Raw3DThreeModule } from "./raw3d.js";

export interface Raw3DThreeSkinBinding {
  readonly drawable: Three.Mesh;
  update(): void;
  dispose(): void;
}

/** Native bone Parent references a scene node; Location/Rotation supply its mesh bind offset. */
export function bindRaw3DThreeSkin(
  original: Three.Mesh, meshIndex: number, project: Raw3DProject,
  nodes: ReadonlyMap<number, Three.Object3D>, three: Raw3DThreeModule
): Raw3DThreeSkinBinding {
  const mesh = project.meshes[meshIndex]!;
  const influences = decodeRaw3DSkinInfluences(mesh, project);
  for (const source of mesh.bones) if (source.parentIndex >= 0 && !nodes.has(source.parentIndex)) throw new Error(`Missing RAW3D bone node ${source.parentIndex}.`);
  const geometry = original.geometry.clone();
  const owner = original.parent!;
  const bones = mesh.bones.map(source => {
    const parent = source.parentIndex < 0 ? owner : nodes.get(source.parentIndex);
    if (!parent) throw new Error(`Missing RAW3D bone node ${source.parentIndex}.`);
    const bone = new three.Bone();bone.name = source.name;
    bone.position.set(source.location[0] ?? 0, source.location[1] ?? 0, -(source.location[2] ?? 0));
    bone.rotation.set(-(source.rotation[0] ?? 0), -(source.rotation[1] ?? 0), source.rotation[2] ?? 0, "YXZ");
    parent.add(bone);return bone;
  });
  // An identity influence preserves vertices that the file leaves unweighted.
  const identity = new three.Bone();identity.name = "RAW3D unweighted vertices";owner.add(identity);
  const allBones = [...bones, identity];
  const gpu = allBones.length <= 65536 && influences.every(weights => weights.length <= 4);
  let drawable: Three.Mesh, skeleton: Three.Skeleton | undefined;
  if (gpu) {
    const indices = new Uint16Array(influences.length*4), weights = new Float32Array(influences.length*4);
    influences.forEach((entries, vertex) => {
      if (!entries.length) { indices[vertex*4] = bones.length;weights[vertex*4] = 1; }
      entries.forEach((entry, slot) => { indices[vertex*4+slot] = entry.boneIndex;weights[vertex*4+slot] = entry.weight; });
    });
    geometry.setAttribute("skinIndex", new three.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new three.Float32BufferAttribute(weights, 4));
    const skinned = new three.SkinnedMesh(geometry, original.material);
    skeleton = new three.Skeleton(allBones, allBones.map(() => new three.Matrix4()));
    skinned.bind(skeleton, new three.Matrix4());drawable = skinned;
  } else drawable = new three.Mesh(geometry, original.material);
  drawable.name = original.name;drawable.userData = original.userData;
  drawable.visible = original.visible;drawable.castShadow = original.castShadow;drawable.receiveShadow = original.receiveShadow;
  drawable.frustumCulled = false;
  drawable.userData.raw3d.skinning = gpu ? "gpu" : "cpu";
  owner.remove(original);owner.add(drawable);
  const point = new three.Vector3(), sum = new three.Vector3(), inverse = new three.Matrix4();
  const matrices = bones.map(() => new three.Matrix4()), normals = bones.map(() => new three.Matrix3());
  const update = () => {
    if (skeleton) { skeleton.update();return; }
    // Preserve every influence when a file exceeds the four GPU attribute slots.
    inverse.copy(drawable.matrixWorld).invert();
    bones.forEach((bone, index) => { matrices[index]!.multiplyMatrices(inverse, bone.matrixWorld);normals[index]!.getNormalMatrix(matrices[index]!); });
    for (const name of ["position", "normal", "tangent"]) {
      const source = original.geometry.getAttribute(name), target = geometry.getAttribute(name);
      if (!source || !target) continue;
      influences.forEach((weights, vertex) => {
        if (!weights.length) return;
        sum.set(0,0,0);
        for (const influence of weights) {
          point.fromBufferAttribute(source as Three.BufferAttribute, vertex);
          if (name === "position") point.applyMatrix4(matrices[influence.boneIndex]!);
          else point.applyMatrix3(normals[influence.boneIndex]!);
          sum.addScaledVector(point, influence.weight);
        }
        if (name !== "position") sum.normalize();
        target.setXYZ(vertex, sum.x, sum.y, sum.z);
      });
      target.needsUpdate = true;
    }
  };
  return { drawable, update, dispose() { skeleton?.dispose();geometry.dispose();for (const bone of allBones) bone.removeFromParent(); } };
}
