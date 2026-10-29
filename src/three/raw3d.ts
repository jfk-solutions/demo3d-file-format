import type * as Three from "three";
import type { Raw3DAnimation, Raw3DNodeState } from "../raw3d-animation.js";
import { bindRaw3DThreeSkin, type Raw3DThreeSkinBinding } from "./skinning.js";
import { applyRaw3DThreeEffects, configureRaw3DDrawable } from "./effects.js";
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
  /** Render CAD drawing blocks and dimension annotations. Disabled by default. */
  readonly showAnnotations?: boolean;
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
  return (await buildRaw3DThreeGroup(parsed, options)).group;
}

async function buildRaw3DThreeGroup(parsed: Raw3DPackage | Raw3DProject, options: Raw3DThreeOptions) {
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
  if ("WebGPURenderer" in three && project.lights.some(light => /^(point|spot|1|2)$/i.test(light.type))) warn({ code: "RAW3D_LIGHT_BACKEND_APPROXIMATION", message: "Native attenuation and cone falloff use WebGL shader hooks. WebGPU uses the standard Three.js light approximation; select WebGL for native light coefficients." });
  for (const material of project.materials) if (material.normalTextureIndex !== undefined && material.normalDepth !== 0) warn({ code: "RAW3D_RELIEF_MAPPING_UNSUPPORTED", message: "Native normal depth is preserved, but parallax/relief shading is not implemented." });
  const materials = project.materials.map((material) => createMaterial(material, textures, three));
  const defaultMaterial = new three.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 });
  const geometryCache = new Map<number, Three.BufferGeometry>();
  const objects = new Map<number, Three.Object3D>();
  const sourceNodes = new Map(project.nodes.map((node) => [node.index, node]));
  const root = new three.Group();
  root.name = "RAW3D";

  for (const node of project.nodes) {
    const annotationHidden = !options.showAnnotations && isAnnotationNode(node, sourceNodes);
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
      annotationHidden,
      customAttributes: Object.fromEntries(node.customAttributes)
    };
    objects.set(node.index, object);

    if (!annotationHidden && node.meshIndex !== undefined) {
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
          drawable.visible = node.visible;
          drawable.receiveShadow = drawable instanceof three.Mesh;
          drawable.userData.raw3d = {
            kind: primitiveKind(sourceMesh.meshType),
            nodeIndex: node.index,
            meshIndex: node.meshIndex,
            meshType: sourceMesh.meshType,
            sourceVisible: node.visible
          };
          object.add(drawable);
          stats.meshes += 1;
        }
      }
    }
    if (!annotationHidden && text) {
      const textMaterialIndex = text.materialIndex ?? node.materialIndices[0];
      const sourceMaterial = textMaterialIndex === undefined ? undefined : project.materials[textMaterialIndex];
      const sprite = createTextSprite(text, sourceMaterial, three);
      if (sprite) {
        sprite.name = `${node.name} Text`;
        sprite.visible = node.visible;
        sprite.userData.raw3d = { kind: "text", nodeIndex: node.index, textIndex: node.textIndex, sourceVisible: node.visible };
        object.add(sprite);
      }
    }
  }

  for (const [sourceIndex, source] of project.lights.entries()) {
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
    light.visible = source.enabled;
    light.userData.raw3d = {
      kind: "light",
      index: source.index ?? sourceIndex,
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
  const skinBindings = new Map<Three.Object3D, Raw3DThreeSkinBinding>();
  for (const node of project.nodes) {
    const owner = objects.get(node.index)!;
    const drawable = owner.children.find(child => child instanceof three.Mesh) as Three.Mesh | undefined;
    if (drawable && node.meshIndex !== undefined && project.meshes[node.meshIndex]?.bones.length) {
      const binding = bindRaw3DThreeSkin(drawable, node.meshIndex, project, objects, three);
      skinBindings.set(binding.drawable, binding);
    }
    for (const child of owner.children) if (["mesh", "lines", "points"].includes(child.userData.raw3d?.kind)) configureRaw3DDrawable(child, node.isBillboard, node.isDecal, three);
  }
  root.updateMatrixWorld(true);
  for (const binding of skinBindings.values()) binding.update();
  applyRaw3DThreeEffects(root, project.animation.effects.sample(0), project, three);
  return { group: root, three, project, objects, materials, textures, geometryCache, defaultMaterial, skinBindings };
}

export interface Raw3DThreePlayback {
  readonly group: Three.Group;
  readonly animation: Raw3DAnimation;
  readonly duration: number;
  readonly state: ReturnType<Raw3DAnimation["sampleFrame"]>;
  /** Apply an absolute simulation time. The host owns play/pause and its clock. */
  seek(time: number): void;
  /** Release this playback's resources. The caller may then remove the group. */
  dispose(): void;
}

/** Optional Three.js binding. Animation data and interpolation live in the core. */
export async function createRaw3DThreePlayback(
  parsed: Raw3DPackage | Raw3DProject, options: Raw3DThreeOptions = {}
): Promise<Raw3DThreePlayback> {
  const project = parsed instanceof Raw3DPackage ? parsed.model : parsed;
  const animation = project.animation;
  const resources = await buildRaw3DThreeGroup(parsed, options);
  const { group, three, objects, materials, geometryCache, defaultMaterial, skinBindings } = resources;
  let frame = animation.sampleFrame(0);
  for (const warning of animation.warnings) {
    const item = { code: warning.code, message: warning.message };
    group.userData.raw3d.warnings.push(item);options.onWarning?.(item);
  }
  const variants = new Map<string, { base: Three.Material; material: Three.Material; map?: Three.Texture; normalMap?: Three.Texture }>();
  const ownedMaterials = new Set<Three.Material>([...materials, defaultMaterial]);
  const ownedTextures = new Set(resources.textures.values());
  const capture = () => group.traverse(object => {
    const drawable = object as Three.Mesh;
    if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
      ownedMaterials.add(material);
      const map = (material as Three.MeshStandardMaterial).map;
      if (map) ownedTextures.add(map);
    }
  });
  capture();
  let disposed = false;
  const palette = (node: Raw3DNode, state: Raw3DNodeState, mesh: Raw3DMesh): Three.Material[] => {
    const layerMaterial = state.layerIndex === undefined ? undefined : project.layers[state.layerIndex]?.materialIndex;
    return Array.from({ length: Math.max(1, mesh.indexBufferIndices.length) }, (_, slot) => {
      const index = node.materialIndices[slot] ?? node.materialIndices[0] ?? layerMaterial;
      const base = (index === undefined ? defaultMaterial : materials[index] ?? defaultMaterial) as Three.MeshStandardMaterial;
      const values = state.materialProperties[slot] ?? {};
      const key = `${node.index}:${slot}:${index ?? -1}:${values.Texture ?? "base"}:${values.NormalMap ?? values.NormalTexture ?? "base"}`;
      let entry = variants.get(key);
      if (!entry) {
        const material = base.clone();
        const mapSource = values.Texture === undefined ? base.map : values.Texture < 0 ? null : resources.textures.get(`${values.Texture}:color`);
        const normalIndex = values.NormalMap ?? values.NormalTexture;
        const normalSource = normalIndex === undefined ? base.normalMap : normalIndex < 0 ? null : resources.textures.get(`${normalIndex}:normal`);
        if ((values.Texture !== undefined && values.Texture >= 0 && !mapSource) || (normalIndex !== undefined && normalIndex >= 0 && !normalSource)) throw new Error("An animated RAW3D texture resource could not be loaded.");
        entry = { base, material, map: mapSource?.clone(), normalMap: normalSource?.clone() };
        variants.set(key, entry);ownedMaterials.add(material);
        if (entry.map) ownedTextures.add(entry.map);
        if (entry.normalMap) ownedTextures.add(entry.normalMap);
      }
      const material = entry.material as Three.MeshStandardMaterial;
      const wasTransparent = material.transparent;
      material.copy(base);
      material.map = entry.map ?? null;material.normalMap = entry.normalMap ?? null;
      if (values.Diffuse !== undefined) {
        material.color.setHex(values.Diffuse & 0xffffff, three.SRGBColorSpace);
        material.opacity = (values.Diffuse >>> 24) / 255;
      }
      if (values.Transparency !== undefined) material.opacity = 1-values.Transparency;
      if (values.Reflectivity !== undefined) material.roughness = .9-clamp01(values.Reflectivity)*.75;
      if (values.Luminosity !== undefined && material.emissive) material.emissive.copy(material.color).multiplyScalar(values.Luminosity);
      if (values.NormalScale !== undefined && material.normalScale) material.normalScale.setScalar(values.NormalScale);
      if (values.NormalDepth !== undefined) material.userData.raw3dNormalDepth = values.NormalDepth;
      for (const texture of [material.map, material.normalMap]) {
        if (!texture) continue;
        texture.offset.set(values.U ?? base.map?.offset.x ?? 0, values.V ?? base.map?.offset.y ?? 0);
        texture.repeat.set(values.ScaleU ?? base.map?.repeat.x ?? 1, values.ScaleV ?? base.map?.repeat.y ?? 1);
        if (values.U !== undefined) texture.offset.x = values.U;
        if (values.V !== undefined) texture.offset.y = values.V;
        if (values.ScaleU !== undefined) texture.repeat.x = values.ScaleU;
        if (values.ScaleV !== undefined) texture.repeat.y = values.ScaleV;
        if (values.U !== undefined || values.V !== undefined) texture.wrapS = texture.wrapT = three.RepeatWrapping;
      }
      material.transparent = material.opacity < 1 || base.transparent;material.depthWrite = base.depthWrite && !material.transparent;
      if (wasTransparent !== material.transparent) material.needsUpdate = true;
      return material;
    });
  };
  const seek = (time: number) => {
    if (disposed) throw new Error("RAW3D playback has been disposed.");
    frame = animation.sampleFrame(time);
    const states = frame.nodes;
    // Detach first so valid hierarchy changes do not depend on source node order.
    for (const object of objects.values()) group.add(object);
    for (const node of project.nodes) {
      const object = objects.get(node.index)!, state = states.get(node.index)!;
      object.position.set(state.location[0], state.location[1], -state.location[2]);
      object.quaternion.set(-state.quaternion[0], -state.quaternion[1], state.quaternion[2], state.quaternion[3]);
      object.scale.set(...state.scale);object.visible = !state.deleted;
      object.userData.raw3d.layerIndex = state.layerIndex;
      object.userData.raw3d.interactionMode = state.interactionMode;
      object.userData.raw3d.highlight = state.highlight;
      object.userData.raw3d.userData = state.userData;
      object.userData.raw3d.clientOwner = state.clientOwner;
      object.userData.raw3d.hasBeenOptimized = state.hasBeenOptimized;
      const parent = state.parentIndex === undefined ? undefined : objects.get(state.parentIndex);
      if (parent && parent !== object && !isDescendantOf(parent, object)) parent.add(object);
      else if (state.parentIndex !== undefined) throw new Error(`Invalid animated parent ${state.parentIndex} for RAW3D node ${node.index}.`);
      let drawable = object.children.find(child => ["mesh", "lines", "points"].includes(child.userData.raw3d?.kind)) as Three.Mesh | Three.LineSegments | Three.Points | undefined;
      const mesh = state.meshIndex === undefined ? undefined : project.meshes[state.meshIndex];
      if (state.meshIndex !== undefined && !mesh) throw new Error(`Missing animated RAW3D mesh ${state.meshIndex}.`);
      if (mesh && !object.userData.raw3d.annotationHidden) {
        if (!geometryCache.has(state.meshIndex!)) geometryCache.set(state.meshIndex!, decodeRaw3DThreeGeometry(mesh, project, three));
        if (!drawable || drawable.userData.raw3d.meshType !== mesh.meshType || (drawable.userData.raw3d.meshIndex !== state.meshIndex && (skinBindings.has(drawable) || mesh.bones.length > 0))) {
          if (drawable) { object.remove(drawable);skinBindings.get(drawable)?.dispose();skinBindings.delete(drawable); }
          drawable = createDrawable(mesh, geometryCache.get(state.meshIndex!)!, [defaultMaterial], three) as Three.Mesh | Three.LineSegments | Three.Points;
          drawable.userData.raw3d = { kind: primitiveKind(mesh.meshType), nodeIndex: node.index, meshType: mesh.meshType };
          drawable.castShadow = node.castsShadow && drawable instanceof three.Mesh;
          object.add(drawable);
          if (mesh.bones.length && drawable instanceof three.Mesh) {
            const binding = bindRaw3DThreeSkin(drawable, state.meshIndex!, project, objects, three);
            drawable = binding.drawable;skinBindings.set(drawable, binding);
          }
          // The line/point factory creates topology-specific materials.
          for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) ownedMaterials.add(material);
        }
        if (!skinBindings.has(drawable)) drawable.geometry = geometryCache.get(state.meshIndex!)!;
        drawable.userData.raw3d.meshIndex = state.meshIndex;
        const selected = palette(node, state, mesh);
        if (drawable instanceof three.Mesh) drawable.material = selected.length === 1 ? selected[0]! : selected;
        else {
          const current = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
          // Keep topology-specific materials instead of assigning mesh shaders to lines/points.
          const adjusted = selected.map((source, slot) => {
            const material = current[slot] ?? (drawable instanceof three.Points ? toPointMaterial(source, three) : toLineMaterial(source, three));
            ownedMaterials.add(material);
            const target = material as Three.PointsMaterial, original = source as Three.MeshStandardMaterial;
            target.color.copy(original.color);target.opacity = original.opacity;target.transparent = original.transparent;target.depthWrite = original.depthWrite;
            target.needsUpdate = true;
            if (drawable instanceof three.Points) target.size = state.materialProperties[slot]?.PointSize ?? project.materials[node.materialIndices[slot] ?? node.materialIndices[0] ?? (state.layerIndex === undefined ? -1 : project.layers[state.layerIndex]?.materialIndex ?? -1)]?.pointSize ?? 1;
            return material;
          });
          drawable.material = adjusted.length === 1 ? adjusted[0]! : adjusted;
        }
        configureRaw3DDrawable(drawable, state.isBillboard, state.isDecal, three);
      }
      if (drawable) {
        drawable.visible = state.visible && !!mesh && !object.userData.raw3d.annotationHidden;
        drawable.userData.raw3d.sourceVisible = drawable.visible;
      }
      for (const child of object.children) if (child.userData.raw3d?.kind === "text") {
        child.visible = state.visible && !object.userData.raw3d.annotationHidden;
        child.userData.raw3d.sourceVisible = child.visible;
      }
    }
    // Retain only geometry currently used by nodes; decoded mesh samples are recreatable.
    const used = new Set([...states.values()].map(state => state.meshIndex));
    for (const [index, geometry] of geometryCache) if (!used.has(index)) { geometry.dispose();geometryCache.delete(index); }
    group.updateMatrixWorld(true);
    for (const binding of skinBindings.values()) binding.update();
    applyRaw3DThreeEffects(group, frame, project, three);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const binding of skinBindings.values()) binding.dispose();skinBindings.clear();
    for (const geometry of geometryCache.values()) geometry.dispose();
    group.traverse(object => { if (object.userData.raw3d?.kind === "scene-floor") (object as Three.Mesh).geometry.dispose(); });
    capture();
    for (const material of ownedMaterials) {
      const source = material as Three.MeshStandardMaterial;
      if (source.map) ownedTextures.add(source.map);
      if (source.normalMap) ownedTextures.add(source.normalMap);
    }
    for (const material of ownedMaterials) material.dispose();
    for (const texture of ownedTextures) texture.dispose();
    group.clear();variants.clear();geometryCache.clear();
  };
  try { seek(0); } catch (error) { dispose();throw error; }
  return { group, animation, duration: animation.duration, get state() { return frame; }, seek, dispose };
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
        let value: number;
        if (/^Color$/i.test(sourceAttribute.type)) {
          const packed = view.getUint32(base, true);
          value = ((packed >>> [16,8,0,24][component]!) & 255)/255;
        } else if (/^Byte4$/i.test(sourceAttribute.type)) value = view.getUint8(base+component);
        else if (/^(?:Normalized)?Short[24]$/i.test(sourceAttribute.type)) {
          value = view.getInt16(base+component*2, true);
          if (/^Normalized/i.test(sourceAttribute.type)) value = Math.max(-1, value/32767);
        } else value = view.getFloat32(base + component * 4, true);
        if ((name === "position" || name === "normal" || name === "tangent") && component === 2) {
          value = -value;
        }
        if (name === "tangent" && component === 3) value = -value;
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
    size: source.userData.raw3dPointSize ?? 1,
    vertexColors: /^(pointcloud|1)$/i.test(source.userData.raw3dShader ?? ""),
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

function isAnnotationNode(
  node: Raw3DNode,
  nodes: ReadonlyMap<number, Raw3DNode>
): boolean {
  for (let current: Raw3DNode | undefined = node; current; current = current.parentIndex === undefined
    ? undefined
    : nodes.get(current.parentIndex)) {
    if (/^(DrawingBlock|Dimension)/i.test(current.name)) {
      return true;
    }
  }
  return false;
}

function createTextSprite(
  text: Raw3DProject["textObjects"][number],
  sourceMaterial: Raw3DMaterial | undefined,
  three: Raw3DThreeModule
): Three.Sprite | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const lines = text.value.replace(/\r\n?/g, "\n").split("\n");
  const fontSize = 100;
  const lineHeight = 120;
  const padding = 20;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }
  context.font = `${fontSize}px ${text.fontFamily || "Arial"}`;
  const width = Math.max(1, ...lines.map((line) => context.measureText(line).width));
  canvas.width = Math.ceil(width + padding * 2);
  canvas.height = Math.max(1, lines.length * lineHeight + padding * 2);
  const drawContext = canvas.getContext("2d");
  if (!drawContext) {
    return undefined;
  }
  drawContext.font = `${fontSize}px ${text.fontFamily || "Arial"}`;
  drawContext.textAlign = "center";
  drawContext.textBaseline = "middle";
  const color = sourceMaterial
    ? `rgb(${Math.round(clamp01(sourceMaterial.red) * 255)}, ${Math.round(clamp01(sourceMaterial.green) * 255)}, ${Math.round(clamp01(sourceMaterial.blue) * 255)})`
    : "rgb(0, 0, 0)";
  drawContext.fillStyle = color;
  lines.forEach((line, index) => {
    drawContext.fillText(line, canvas.width / 2, padding + lineHeight * (index + 0.5));
  });
  const opacity = sourceMaterial ? 1 - clamp01(sourceMaterial.transparency) : 1;
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  const sprite = new three.Sprite(new three.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    // Labels share planes with their dimension geometry. Draw them as a readable
    // annotation layer instead of letting those lines occlude the canvas.
    depthTest: false,
    depthWrite: false
  }));
  sprite.renderOrder = 1;
  const scale = Math.max(text.size, 0.001) / fontSize;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  return sprite;
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
  for (const update of project.root.child("Updates")?.children ?? []) {
    if (update.localName !== "Material") continue;
    const name = update.attributes.find(attribute => attribute.localName === "Name")?.value;
    if (!["Texture", "NormalMap", "NormalTexture"].includes(name ?? "")) continue;
    const value = update.attributes.find(attribute => attribute.localName === "Value")?.value ?? "";
    for (const token of value.trim().split(/\s+/)) {
      const index = Number(token), texture = project.textures[index];
      if (texture) { const color = name === "Texture";wanted.set(`${index}:${color ? "color" : "normal"}`, { texture, color }); }
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
  for (const texture of [map, normalMap]) {
    if (!texture) continue;
    if (source.scaleU !== 1 || source.scaleV !== 1 || source.offsetU !== 0 || source.offsetV !== 0) texture.wrapS = texture.wrapT = three.RepeatWrapping;
    texture.repeat.set(source.scaleU, source.scaleV);
    texture.offset.set(source.offsetU, source.offsetV);
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
  let result: Three.MeshStandardMaterial | Three.MeshBasicMaterial;
  switch (source.shader.toLowerCase()) {
    case "flattext": case "2": result = new three.MeshBasicMaterial({ color: parameters.color, map: map ?? null, opacity, transparent: opacity < 1 || !!map, depthWrite: opacity >= 1, side: three.DoubleSide });break;
    case "default": case "0": case "pointcloud": case "1": result = new three.MeshStandardMaterial(parameters);break;
    default: throw new Error(`Unsupported RAW3D material shader ${source.shader}.`);
  }
  result.userData.raw3dShader = source.shader;
  result.userData.raw3dPointSize = source.pointSize;
  result.userData.raw3dNormalDepth = source.normalDepth;
  if (result instanceof three.MeshStandardMaterial) result.emissive.copy(result.color).multiplyScalar(source.luminosity);
  return result;
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
