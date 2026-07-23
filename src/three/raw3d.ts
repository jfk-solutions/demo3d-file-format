import type * as Three from "three";
import {
  Raw3DMaterial,
  Raw3DMesh,
  Raw3DPackage,
  Raw3DProject,
  type Raw3DNode,
  type Raw3DTexture
} from "../raw3d.js";

export type Raw3DThreeModule = typeof Three;

export interface Raw3DThreeWarning {
  readonly code: string;
  readonly message: string;
  readonly nodeIndex?: number;
  readonly meshIndex?: number;
  readonly path?: string;
}

export interface Raw3DThreeOptions {
  readonly three?: Raw3DThreeModule;
  readonly loadThree?: () => Promise<Raw3DThreeModule>;
  readonly onWarning?: (warning: Raw3DThreeWarning) => void;
}

export interface Raw3DThreeStats {
  nodes: number;
  meshes: number;
  geometries: number;
  materials: number;
  textures: number;
  textObjects: number;
  lights: number;
  missingResources: number;
}

export interface Raw3DThreeScene {
  readonly three: Raw3DThreeModule;
  readonly scene: Three.Scene;
  readonly group: Three.Group;
  readonly stats: Raw3DThreeStats;
  readonly warnings: readonly Raw3DThreeWarning[];
}

export async function createRaw3DThreeScene(
  parsed: Raw3DPackage | Raw3DProject,
  options: Raw3DThreeOptions = {}
): Promise<Raw3DThreeScene> {
  const three = await resolveThree(options);
  const group = await createRaw3DThreeGroup(parsed, { ...options, three });
  const scene = new three.Scene();
  scene.name = "RAW3D Scene";
  scene.add(group);
  return {
    three,
    scene,
    group,
    stats: group.userData.raw3d.stats as Raw3DThreeStats,
    warnings: group.userData.raw3d.warnings as readonly Raw3DThreeWarning[]
  };
}

export async function createRaw3DThreeGroup(
  parsed: Raw3DPackage | Raw3DProject,
  options: Raw3DThreeOptions = {}
): Promise<Three.Group> {
  const three = await resolveThree(options);
  const project = parsed instanceof Raw3DPackage ? parsed.model : parsed;
  const warnings: Raw3DThreeWarning[] = [];
  const stats: Raw3DThreeStats = {
    nodes: project.nodes.length,
    meshes: 0,
    geometries: 0,
    materials: project.materials.length,
    textures: 0,
    textObjects: project.textObjects.length,
    lights: 0,
    missingResources: 0
  };
  const warn = (warning: Raw3DThreeWarning): void => {
    warnings.push(warning);
    if (warning.code.includes("MISSING")) {
      stats.missingResources += 1;
    }
    options.onWarning?.(warning);
  };
  const textures = await loadTextures(project, three, stats, warn);
  const materials = project.materials.map((material) => createMaterial(material, textures, three));
  const defaultMaterial = new three.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 });
  const geometryCache = new Map<number, Three.BufferGeometry>();
  const objects = new Map<number, Three.Object3D>();
  const root = new three.Group();
  root.name = "RAW3D";

  for (const node of project.nodes) {
    const object = new three.Group();
    object.name = node.name;
    applyTransform(object, node);
    const text = node.textIndex === undefined ? undefined : project.textObjects[node.textIndex];
    object.userData.raw3d = {
      kind: "node",
      index: node.index,
      meshIndex: node.meshIndex,
      layerIndex: node.layerIndex,
      textIndex: node.textIndex,
      text: text ? {
        value: text.value,
        size: text.size,
        materialIndex: text.materialIndex,
        verticalAlign: text.verticalAlign,
        startPosition: text.startPosition,
        endPosition: text.endPosition
      } : undefined,
      interactionMode: node.interactionMode,
      customAttributes: Object.fromEntries(node.customAttributes)
    };
    objects.set(node.index, object);

    if (node.meshIndex !== undefined) {
      const sourceMesh = project.meshes[node.meshIndex];
      if (!sourceMesh) {
        warn({
          code: "RAW3D_MESH_MISSING",
          message: `Node ${node.index} references missing mesh ${node.meshIndex}.`,
          nodeIndex: node.index,
          meshIndex: node.meshIndex
        });
      } else {
        let geometry = geometryCache.get(node.meshIndex);
        if (!geometry) {
          try {
            geometry = decodeRaw3DThreeGeometry(sourceMesh, project, three);
            geometryCache.set(node.meshIndex, geometry);
            stats.geometries += 1;
          } catch (cause) {
            warn({
              code: "RAW3D_GEOMETRY_UNSUPPORTED",
              message: `Could not decode mesh ${node.meshIndex}: ${errorMessage(cause)}`,
              nodeIndex: node.index,
              meshIndex: node.meshIndex
            });
          }
        }
        if (geometry) {
          const nodeMaterials = resolveNodeMaterials(node, sourceMesh, project, materials, defaultMaterial);
          const drawable = createDrawable(sourceMesh, geometry, nodeMaterials, three);
          drawable.name = `${node.name} ${sourceMesh.meshType}`;
          drawable.castShadow = node.castsShadow && drawable instanceof three.Mesh;
          drawable.receiveShadow = drawable instanceof three.Mesh;
          drawable.userData.raw3d = {
            kind: primitiveKind(sourceMesh.meshType),
            nodeIndex: node.index,
            meshIndex: node.meshIndex,
            meshType: sourceMesh.meshType
          };
          object.add(drawable);
          stats.meshes += 1;
        }
      }
    }
  }

  for (const source of project.lights) {
    if (!source.enabled) {
      continue;
    }
    const parent = source.nodeIndex === undefined ? undefined : objects.get(source.nodeIndex);
    if (!parent) {
      warn({
        code: "RAW3D_LIGHT_NODE_MISSING",
        message: `Light references missing node ${String(source.nodeIndex)}.`,
        nodeIndex: source.nodeIndex
      });
      continue;
    }
    const material = source.materialIndex === undefined ? undefined : project.materials[source.materialIndex];
    const color = material
      ? new three.Color(clamp01(material.red), clamp01(material.green), clamp01(material.blue))
      : new three.Color(0xffffff);
    let light: Three.Light;
    switch (source.type.toLowerCase()) {
      case "ambient":
        light = new three.AmbientLight(color, 1);
        break;
      case "point":
        light = new three.PointLight(color, 1, 0, 2);
        break;
      case "spot":
        light = new three.SpotLight(color, 1);
        break;
      default: {
        const directional = new three.DirectionalLight(color, 1);
        directional.target.position.set(0, 0, -1);
        parent.add(directional.target);
        light = directional;
        break;
      }
    }
    light.name = `${parent.name} ${source.type} light`;
    light.userData.raw3d = {
      kind: "light",
      nodeIndex: source.nodeIndex,
      materialIndex: source.materialIndex,
      type: source.type,
      attenuationConstant: source.attenuationConstant,
      attenuationLinear: source.attenuationLinear,
      attenuationQuadratic: source.attenuationQuadratic
    };
    parent.add(light);
    stats.lights += 1;
  }

  for (const node of project.nodes) {
    const object = objects.get(node.index);
    if (!object) {
      continue;
    }
    const parent = node.parentIndex === undefined ? undefined : objects.get(node.parentIndex);
    if (parent && parent !== object && !isDescendantOf(parent, object)) {
      parent.add(object);
    } else {
      root.add(object);
      if (node.parentIndex !== undefined && !parent) {
        warn({
          code: "RAW3D_PARENT_MISSING",
          message: `Node ${node.index} references missing parent ${node.parentIndex}.`,
          nodeIndex: node.index
        });
      }
    }
  }

  root.userData.raw3d = { kind: "package", stats, warnings };
  // Match the metadata shape used by the Demo3D adapter so generic viewers can
  // display stats without special-casing the property name.
  root.userData.demo3d = { kind: "raw3d-package", stats, warnings };
  return root;
}

export function decodeRaw3DThreeGeometry(
  mesh: Raw3DMesh,
  project: Raw3DProject,
  three: Raw3DThreeModule
): Three.BufferGeometry {
  const vertexBuffer = project.vertexBuffers[mesh.vertexBufferIndex];
  if (!vertexBuffer?.data) {
    throw new Error(`vertex buffer ${mesh.vertexBufferIndex} is missing`);
  }
  if (vertexBuffer.stride <= 0 || vertexBuffer.data.byteLength % vertexBuffer.stride !== 0) {
    throw new Error(
      `vertex buffer ${mesh.vertexBufferIndex} size ${vertexBuffer.data.byteLength} is not divisible by stride ${vertexBuffer.stride}`
    );
  }

  const vertexCount = vertexBuffer.data.byteLength / vertexBuffer.stride;
  const view = new DataView(
    vertexBuffer.data.buffer,
    vertexBuffer.data.byteOffset,
    vertexBuffer.data.byteLength
  );
  const geometry = new three.BufferGeometry();
  for (const sourceAttribute of vertexBuffer.attributes) {
    const name = threeAttributeName(sourceAttribute.usage);
    if (!name) {
      continue;
    }
    const values = new Float32Array(vertexCount * sourceAttribute.componentCount);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const base = vertex * vertexBuffer.stride + sourceAttribute.offset;
      for (let component = 0; component < sourceAttribute.componentCount; component += 1) {
        let value = view.getFloat32(base + component * 4, true);
        if ((name === "position" || name === "normal" || name === "tangent") && component === 2) {
          value = -value;
        }
        values[vertex * sourceAttribute.componentCount + component] = value;
      }
    }
    geometry.setAttribute(name, new three.BufferAttribute(values, sourceAttribute.componentCount));
  }
  if (!geometry.getAttribute("position")) {
    throw new Error(`vertex buffer ${mesh.vertexBufferIndex} has no position attribute`);
  }

  const indexArrays: Array<Uint16Array | Uint32Array> = [];
  let totalIndexCount = 0;
  for (const indexBufferIndex of mesh.indexBufferIndices) {
    const indexBuffer = project.indexBuffers[indexBufferIndex];
    if (!indexBuffer?.data) {
      throw new Error(`index buffer ${indexBufferIndex} is missing`);
    }
    const elementSize = /32/i.test(indexBuffer.format) ? 4 : 2;
    if (indexBuffer.data.byteLength % elementSize !== 0) {
      throw new Error(
        `index buffer ${indexBufferIndex} (${indexBuffer.format}) has invalid byte length ${indexBuffer.data.byteLength}`
      );
    }
    const count = indexBuffer.data.byteLength / elementSize;
    const indices = elementSize === 4 ? new Uint32Array(count) : new Uint16Array(count);
    const indexView = new DataView(indexBuffer.data.buffer, indexBuffer.data.byteOffset, indexBuffer.data.byteLength);
    for (let offset = 0; offset < count; offset += 1) {
      indices[offset] = elementSize === 4
        ? indexView.getUint32(offset * 4, true)
        : indexView.getUint16(offset * 2, true);
    }
    if (isTriangleList(mesh.meshType)) {
      for (let offset = 0; offset + 2 < indices.length; offset += 3) {
        const second = indices[offset + 1]!;
        indices[offset + 1] = indices[offset + 2]!;
        indices[offset + 2] = second;
      }
    }
    indexArrays.push(indices);
    totalIndexCount += indices.length;
  }

  if (indexArrays.length > 0) {
    const combined = vertexCount > 0xffff ? new Uint32Array(totalIndexCount) : new Uint16Array(totalIndexCount);
    let offset = 0;
    for (let groupIndex = 0; groupIndex < indexArrays.length; groupIndex += 1) {
      const indices = indexArrays[groupIndex]!;
      combined.set(indices, offset);
      geometry.addGroup(offset, indices.length, groupIndex);
      offset += indices.length;
    }
    geometry.setIndex(new three.BufferAttribute(combined, 1));
  }
  if (isTriangleList(mesh.meshType) && !geometry.getAttribute("normal")) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createDrawable(
  mesh: Raw3DMesh,
  geometry: Three.BufferGeometry,
  materials: readonly Three.Material[],
  three: Raw3DThreeModule
): Three.Object3D {
  const material = materials[0] ?? new three.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 });
  switch (mesh.meshType.toLowerCase()) {
    case "linelist": {
      const lineMaterials = materials.map((source) => toLineMaterial(source, three));
      return new three.LineSegments(geometry, lineMaterials.length === 1 ? lineMaterials[0]! : lineMaterials);
    }
    case "pointlist": {
      const pointMaterials = materials.map((source) => toPointMaterial(source, three));
      return new three.Points(geometry, pointMaterials.length === 1 ? pointMaterials[0]! : pointMaterials);
    }
    default:
      return new three.Mesh(geometry, materials.length === 1 ? material : [...materials]);
  }
}

function toLineMaterial(material: Three.Material, three: Raw3DThreeModule): Three.LineBasicMaterial {
  const source = material as Three.MeshStandardMaterial;
  return new three.LineBasicMaterial({
    color: source.color,
    opacity: source.opacity,
    transparent: source.transparent,
    depthWrite: source.depthWrite
  });
}

function toPointMaterial(material: Three.Material, three: Raw3DThreeModule): Three.PointsMaterial {
  const source = material as Three.MeshStandardMaterial;
  return new three.PointsMaterial({
    color: source.color,
    opacity: source.opacity,
    transparent: source.transparent,
    depthWrite: source.depthWrite,
    size: 1,
    sizeAttenuation: true
  });
}

function isTriangleList(meshType: string): boolean {
  return meshType.toLowerCase() === "trianglelist";
}

function primitiveKind(meshType: string): "mesh" | "lines" | "points" {
  switch (meshType.toLowerCase()) {
    case "linelist": return "lines";
    case "pointlist": return "points";
    default: return "mesh";
  }
}

function resolveNodeMaterials(
  node: Raw3DNode,
  mesh: Raw3DMesh,
  project: Raw3DProject,
  materials: readonly Three.Material[],
  fallback: Three.Material
): Three.Material[] {
  const layerMaterial = node.layerIndex === undefined
    ? undefined
    : project.layers[node.layerIndex]?.materialIndex;
  const count = Math.max(mesh.indexBufferIndices.length, 1);
  const resolved: Three.Material[] = [];
  for (let index = 0; index < count; index += 1) {
    const materialIndex = node.materialIndices[index] ?? node.materialIndices[0] ?? layerMaterial;
    resolved.push(materialIndex === undefined ? fallback : (materials[materialIndex] ?? fallback));
  }
  return resolved;
}

async function loadTextures(
  project: Raw3DProject,
  three: Raw3DThreeModule,
  stats: Raw3DThreeStats,
  warn: (warning: Raw3DThreeWarning) => void
): Promise<Map<string, Three.Texture>> {
  const wanted = new Map<string, { texture: Raw3DTexture; color: boolean }>();
  for (const material of project.materials) {
    if (material.textureIndex !== undefined && project.textures[material.textureIndex]) {
      wanted.set(`${material.textureIndex}:color`, { texture: project.textures[material.textureIndex]!, color: true });
    }
    if (material.normalTextureIndex !== undefined && project.textures[material.normalTextureIndex]) {
      wanted.set(`${material.normalTextureIndex}:normal`, { texture: project.textures[material.normalTextureIndex]!, color: false });
    }
  }

  const loaded = new Map<string, Three.Texture>();
  await Promise.all([...wanted].map(async ([key, item]) => {
    if (!item.texture.data) {
      warn({
        code: "RAW3D_TEXTURE_MISSING",
        message: `Texture resource "${item.texture.path}" is missing.`,
        path: item.texture.path
      });
      return;
    }
    if (typeof createImageBitmap !== "function") {
      return;
    }
    try {
      const bitmap = await createImageBitmap(new Blob([item.texture.data as unknown as BlobPart]));
      const texture = new three.Texture(bitmap);
      texture.name = item.texture.path;
      texture.colorSpace = item.color ? three.SRGBColorSpace : three.NoColorSpace;
      // RAW3D exports V=0 at the top of the image. Keep the decoded bitmap in
      // its original orientation and disable Three's default Y flip.
      texture.flipY = false;
      texture.needsUpdate = true;
      loaded.set(key, texture);
      stats.textures += 1;
    } catch (cause) {
      warn({
        code: "RAW3D_TEXTURE_DECODE_FAILED",
        message: `Could not decode texture "${item.texture.path}": ${errorMessage(cause)}`,
        path: item.texture.path
      });
    }
  }));
  return loaded;
}

function createMaterial(
  source: Raw3DMaterial,
  textures: ReadonlyMap<string, Three.Texture>,
  three: Raw3DThreeModule
): Three.Material {
  const opacity = 1 - clamp01(source.transparency);
  const sharedMap = source.textureIndex === undefined ? undefined : textures.get(`${source.textureIndex}:color`);
  const sharedNormalMap = source.normalTextureIndex === undefined
    ? undefined
    : textures.get(`${source.normalTextureIndex}:normal`);
  const map = sharedMap?.clone();
  const normalMap = sharedNormalMap?.clone();
  if (map && (source.scaleU !== 1 || source.scaleV !== 1)) {
    map.wrapS = three.RepeatWrapping;
    map.wrapT = three.RepeatWrapping;
    map.repeat.set(source.scaleU, source.scaleV);
  }
  const parameters: Three.MeshStandardMaterialParameters = {
    color: new three.Color(clamp01(source.red), clamp01(source.green), clamp01(source.blue)),
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    roughness: 0.9 - clamp01(source.reflectivity) * 0.75,
    metalness: 0.05
  };
  if (map) {
    parameters.map = map;
  }
  if (normalMap) {
    parameters.normalMap = normalMap;
    parameters.normalScale = new three.Vector2(source.normalScale, source.normalScale);
  }
  return new three.MeshStandardMaterial(parameters);
}

function applyTransform(object: Three.Object3D, node: Raw3DNode): void {
  object.position.set(node.location[0] ?? 0, node.location[1] ?? 0, -(node.location[2] ?? 0));
  object.rotation.set(
    -(node.rotation[0] ?? 0),
    -(node.rotation[1] ?? 0),
    node.rotation[2] ?? 0,
    "YXZ"
  );
  object.scale.set(node.scale[0] ?? 1, node.scale[1] ?? 1, node.scale[2] ?? 1);
}

function threeAttributeName(usage: string): string | undefined {
  switch (usage.toLowerCase()) {
    case "position": return "position";
    case "normal": return "normal";
    case "texture": return "uv";
    case "tangent": return "tangent";
    case "color": return "color";
    default: return undefined;
  }
}

function isDescendantOf(candidate: Three.Object3D, parent: Three.Object3D): boolean {
  for (let current: Three.Object3D | null = candidate.parent; current; current = current.parent) {
    if (current === parent) {
      return true;
    }
  }
  return false;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function resolveThree(options: Raw3DThreeOptions): Promise<Raw3DThreeModule> {
  if (options.three) {
    return options.three;
  }
  if (options.loadThree) {
    return options.loadThree();
  }
  return import("three");
}
