import type * as Three from "three";
import {
  Demo3DMaterial,
  Demo3DMesh,
  Demo3DPackage,
  Demo3DProject,
  Demo3DVisual
} from "../model.js";
import { Demo3DBinaryBlock, Demo3DXmlElement } from "../xml.js";

export type ThreeModule = typeof Three;

export interface Demo3DThreeWarning {
  readonly code: string;
  readonly message: string;
  readonly sourceId?: string;
  readonly sourceType?: string;
  readonly xmlPath?: string;
}

export interface Demo3DThreeRendererOptions {
  readonly three?: ThreeModule;
  readonly loadThree?: () => Promise<ThreeModule>;
  readonly showPlaceholders?: boolean;
  readonly includeUnsupported?: boolean;
  readonly includeSerializedRenderables?: boolean;
  readonly maxSerializedRenderables?: number;
  readonly onWarning?: (warning: Demo3DThreeWarning) => void;
}

export interface Demo3DThreeStats {
  groups: number;
  meshes: number;
  geometries: number;
  materials: number;
  serializedRenderables: number;
  unsupported: number;
}

export interface Demo3DThreeScene {
  readonly three: ThreeModule;
  readonly scene: Three.Scene;
  readonly group: Three.Group;
  readonly stats: Demo3DThreeStats;
  readonly warnings: readonly Demo3DThreeWarning[];
}

interface RendererState {
  readonly three: ThreeModule;
  readonly project: Demo3DProject;
  readonly options: Demo3DThreeRendererOptions;
  readonly warnings: Demo3DThreeWarning[];
  readonly meshById: Map<string, Demo3DMesh>;
  readonly serializedObjectById: Map<string, Demo3DXmlElement>;
  readonly geometryCache: Map<string, Three.BufferGeometry>;
  readonly primitiveGeometryCache: Map<string, Three.BufferGeometry>;
  readonly materialCache: Map<string, Three.Material>;
  readonly defaultMaterial: Three.Material;
  readonly stats: Demo3DThreeStats;
}

export async function createDemo3DThreeScene(
  parsed: Demo3DPackage | Demo3DProject,
  options: Demo3DThreeRendererOptions = {}
): Promise<Demo3DThreeScene> {
  const three = await resolveThree(options);
  const group = await createDemo3DThreeGroup(parsed, { ...options, three });
  const scene = new three.Scene();
  scene.name = "Demo3D Scene";
  scene.add(group);

  return {
    three,
    scene,
    group,
    stats: group.userData.demo3d?.stats as Demo3DThreeStats,
    warnings: group.userData.demo3d?.warnings as readonly Demo3DThreeWarning[]
  };
}

export async function createDemo3DThreeGroup(
  parsed: Demo3DPackage | Demo3DProject,
  options: Demo3DThreeRendererOptions = {}
): Promise<Three.Group> {
  const three = await resolveThree(options);
  const project = parsed instanceof Demo3DPackage ? parsed.model : parsed;
  const state = createState(three, project, options);
  const root = new three.Group();
  root.name = "Demo3D";

  for (const visual of project.visuals) {
    root.add(createVisualObject(visual, state));
  }

  if (options.includeSerializedRenderables === true) {
    const serialized = createSerializedRenderableGroup(state);
    if (serialized.children.length > 0) {
      root.add(serialized);
    }
  }

  root.userData.demo3d = {
    kind: "package",
    stats: state.stats,
    warnings: state.warnings
  };

  return root;
}

export function decodeDemo3DThreeGeometry(mesh: Demo3DMesh, three: ThreeModule): Three.BufferGeometry {
  if (mesh.meshFormat !== "TriangleList") {
    throw new Error(`Unsupported Demo3D mesh format: ${mesh.meshFormat ?? "unknown"}`);
  }
  if (!mesh.vertices) {
    throw new Error(`Demo3D mesh ${mesh.id ?? "(unknown)"} has no vertex buffer.`);
  }

  const vertexFormat = mesh.vertexFormat ?? "unknown";
  const layout = vertexLayout(vertexFormat);
  const vertexBytes = mesh.vertices.toUint8Array();
  if (vertexBytes.length % layout.stride !== 0) {
    throw new Error(
      `Demo3D mesh ${mesh.id ?? "(unknown)"} vertex buffer size ${vertexBytes.length} is not divisible by ${layout.stride}.`
    );
  }

  const vertexCount = vertexBytes.length / layout.stride;
  const view = new DataView(vertexBytes.buffer, vertexBytes.byteOffset, vertexBytes.byteLength);
  const positions = new Float32Array(vertexCount * 3);
  const normals = layout.normalOffset === undefined ? undefined : new Float32Array(vertexCount * 3);
  const uvs = layout.uvOffset === undefined ? undefined : new Float32Array(vertexCount * 2);

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const base = vertexIndex * layout.stride;
    positions[vertexIndex * 3] = view.getFloat32(base, true);
    positions[vertexIndex * 3 + 1] = view.getFloat32(base + 4, true);
    positions[vertexIndex * 3 + 2] = view.getFloat32(base + 8, true);

    if (normals && layout.normalOffset !== undefined) {
      normals[vertexIndex * 3] = view.getFloat32(base + layout.normalOffset, true);
      normals[vertexIndex * 3 + 1] = view.getFloat32(base + layout.normalOffset + 4, true);
      normals[vertexIndex * 3 + 2] = view.getFloat32(base + layout.normalOffset + 8, true);
    }

    if (uvs && layout.uvOffset !== undefined) {
      uvs[vertexIndex * 2] = view.getFloat32(base + layout.uvOffset, true);
      uvs[vertexIndex * 2 + 1] = view.getFloat32(base + layout.uvOffset + 4, true);
    }
  }

  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
  if (normals) {
    geometry.setAttribute("normal", new three.BufferAttribute(normals, 3));
  }
  if (uvs) {
    geometry.setAttribute("uv", new three.BufferAttribute(uvs, 2));
  }

  if (mesh.indices) {
    geometry.setIndex(new three.BufferAttribute(readIndexBuffer(mesh.indices, mesh.indexFormat), 1));
  }

  if (!normals) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createDemo3DThreeMaterial(
  material: Demo3DMaterial | undefined,
  three: ThreeModule
): Three.Material {
  const diffuse = material?.diffuse;
  const color = diffuse === undefined ? 0x9aa0a6 : demo3dColorToHex(diffuse);
  const opacity = diffuse === undefined ? 1 : demo3dColorToOpacity(diffuse);
  return new three.MeshStandardMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    roughness: 0.72,
    metalness: 0.05
  });
}

async function resolveThree(options: Demo3DThreeRendererOptions): Promise<ThreeModule> {
  if (options.three) {
    return options.three;
  }

  if (options.loadThree) {
    return options.loadThree();
  }

  return import("three");
}

function createState(
  three: ThreeModule,
  project: Demo3DProject,
  options: Demo3DThreeRendererOptions
): RendererState {
  return {
    three,
    project,
    options,
    warnings: [],
    meshById: new Map(project.meshes.flatMap((mesh) => (mesh.id ? [[mesh.id, mesh] as const] : []))),
    serializedObjectById: indexSerializedObjects(project),
    geometryCache: new Map(),
    primitiveGeometryCache: new Map(),
    materialCache: new Map(),
    defaultMaterial: createDemo3DThreeMaterial(undefined, three),
    stats: {
      groups: 0,
      meshes: 0,
      geometries: 0,
      materials: 1,
      serializedRenderables: 0,
      unsupported: 0
    }
  };
}

function createVisualObject(visual: Demo3DVisual, state: RendererState): Three.Object3D {
  const refs = findMeshReferenceIds(visual.xml);
  const meshes: Three.Object3D[] = [];
  for (const ref of refs) {
    const mesh = createMeshObject(ref, visual, visual.materials[0], state);
    if (mesh) {
      meshes.push(mesh);
    }
  }
  const aspectRenderableObjects = createAspectRenderableObjects(visual, state);
  meshes.push(...aspectRenderableObjects);

  let object: Three.Object3D;

  if (meshes.length === 1 && visual.children.length === 0 && aspectRenderableObjects.length === 0) {
    object = meshes[0];
  } else {
    const group = new state.three.Group();
    for (const mesh of meshes) {
      group.add(mesh);
    }
    object = group;
    state.stats.groups += 1;
  }

  object.name = visual.displayName ?? visual.id ?? visual.typeName;
  applyDemo3DTransform(object, visual.xml.textOf("LR"));
  object.userData.demo3d = {
    kind: "visual",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    localTransform: visual.localTransform,
    localTransformText: visual.xml.textOf("LR")
  };

  for (const child of visual.children) {
    object.add(createVisualObject(child, state));
  }

  return object;
}

function createAspectRenderableObjects(visual: Demo3DVisual, state: RendererState): Three.Object3D[] {
  const objects: Three.Object3D[] = [];
  for (const aspect of findVisualAspects(visual, state)) {
    const renderables = aspect.child("Renderables");
    if (!renderables) {
      continue;
    }

    for (const renderable of renderables.children) {
      const meshIds = findMeshReferenceIds(renderable);
      for (const meshId of meshIds) {
        const material = firstMaterial(renderable) ?? visual.materials[0];
        const mesh = state.meshById.has(meshId)
          ? createMeshObject(meshId, renderable, material, state)
          : createPrimitiveRenderableObject(aspect, renderable, meshId, material, state) ??
            createMeshObject(meshId, renderable, material, state);
        if (!mesh) {
          continue;
        }

        applyRenderableTransform(mesh, renderable);
        mesh.name = visual.displayName ? `${visual.displayName} ${mesh.name}` : mesh.name;
        mesh.userData.demo3d = {
          ...mesh.userData.demo3d,
          kind: "renderable",
          visualId: visual.id,
          visualName: visual.displayName,
          aspectId: aspect.textOf("Id"),
          aspectType: aspect.xsiType,
          renderableId: renderable.textOf("Id"),
          renderablePath: renderable.path
        };
        objects.push(mesh);
        state.stats.serializedRenderables += 1;
      }
    }
  }
  return objects;
}

function createMeshObject(
  meshId: string,
  source: Demo3DVisual | Demo3DXmlElement,
  material: Demo3DMaterial | undefined,
  state: RendererState
): Three.Mesh | undefined {
  const mesh = state.meshById.get(meshId);
  const sourceId = source instanceof Demo3DVisual ? source.id : source.textOf("Id");
  const sourceType = source instanceof Demo3DVisual ? source.typeName : source.xsiType ?? source.localName;
  const xmlPath = source instanceof Demo3DVisual ? source.xml.path : source.path;

  if (!mesh) {
    warn(state, {
      code: "DEMO3D_THREE_MISSING_MESH",
      message: `Mesh reference ${meshId} does not exist in the mesh library.`,
      sourceId,
      sourceType,
      xmlPath
    });
    return undefined;
  }

  const geometry = getGeometry(mesh, state);
  if (!geometry) {
    return state.options.showPlaceholders ? createPlaceholderMesh(sourceId ?? meshId, state) : undefined;
  }

  const object = new state.three.Mesh(geometry, getMaterial(material, state));
  object.name = source instanceof Demo3DVisual ? source.displayName ?? meshId : meshId;
  object.userData.demo3d = {
    kind: "mesh",
    meshId,
    sourceId,
    sourceType,
    xmlPath
  };
  state.stats.meshes += 1;
  return object;
}

function createPrimitiveRenderableObject(
  aspect: Demo3DXmlElement,
  renderable: Demo3DXmlElement,
  meshReferenceId: string,
  material: Demo3DMaterial | undefined,
  state: RendererState
): Three.Mesh | undefined {
  const geometry = getPrimitiveGeometry(aspect, renderable, state);
  if (!geometry) {
    return undefined;
  }

  const object = new state.three.Mesh(geometry, getMaterial(material, state));
  object.name = renderable.textOf("Id") ?? aspect.xsiType ?? meshReferenceId;
  object.userData.demo3d = {
    kind: "primitive-renderable",
    meshReferenceId,
    sourceId: renderable.textOf("Id"),
    sourceType: aspect.xsiType,
    xmlPath: renderable.path
  };
  state.stats.meshes += 1;
  return object;
}

function getGeometry(mesh: Demo3DMesh, state: RendererState): Three.BufferGeometry | undefined {
  const key = mesh.id ?? mesh.xml.path;
  const cached = state.geometryCache.get(key);
  if (cached) {
    return cached;
  }

  try {
    const geometry = decodeDemo3DThreeGeometry(mesh, state.three);
    state.geometryCache.set(key, geometry);
    state.stats.geometries += 1;
    return geometry;
  } catch (error) {
    warn(state, {
      code: "DEMO3D_THREE_UNSUPPORTED_GEOMETRY",
      message: error instanceof Error ? error.message : String(error),
      sourceId: mesh.id,
      sourceType: mesh.typeName,
      xmlPath: mesh.xml.path
    });
    return undefined;
  }
}

function getPrimitiveGeometry(
  aspect: Demo3DXmlElement,
  renderable: Demo3DXmlElement,
  state: RendererState
): Three.BufferGeometry | undefined {
  const type = aspect.xsiType;
  const key = primitiveGeometryKey(type, renderable);
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  let geometry: Three.BufferGeometry | undefined;
  if (type === "e3d:CylinderRendererAspect") {
    const radius = numberChild(renderable, "Radius", 0.5);
    const radiusRatio = numberChild(renderable, "RadiusRatio", 1);
    const coneRatio = numberChild(renderable, "ConeRatio", 1);
    const length = numberChild(renderable, "Length", 1);
    const slices = Math.max(3, Math.round(numberChild(renderable, "Slices", 16)));
    const startAngle = degreesToRadians(numberChild(renderable, "StartAngle", 0));
    const angle = degreesToRadians(numberChild(renderable, "Angle", 360));
    geometry = new state.three.CylinderGeometry(
      radius * radiusRatio,
      radius * coneRatio,
      length,
      slices,
      1,
      false,
      startAngle,
      angle
    );
  } else if (type === "e3d:BoxRendererAspect") {
    geometry = new state.three.BoxGeometry(
      numberChild(renderable, "Width", 1),
      numberChild(renderable, "Height", 1),
      numberChild(renderable, "Depth", 1)
    );
  } else if (type === "e3d:ContainerRendererAspect") {
    geometry = new state.three.BoxGeometry(
      numberChild(renderable, "Width", 1),
      numberChild(renderable, "Height", 1),
      numberChild(renderable, "Depth", 1)
    );
  }

  if (!geometry) {
    return undefined;
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function primitiveGeometryKey(type: string | null, renderable: Demo3DXmlElement): string {
  const fields = [
    "Angle",
    "ConeRatio",
    "Depth",
    "Height",
    "Length",
    "Radius",
    "RadiusRatio",
    "Slices",
    "StartAngle",
    "Width"
  ];
  return `primitive:${type ?? "unknown"}:${fields.map((field) => renderable.textOf(field) ?? "").join("|")}`;
}

function getMaterial(material: Demo3DMaterial | undefined, state: RendererState): Three.Material {
  if (!material) {
    return state.defaultMaterial;
  }

  const key = String(material.diffuse ?? "default");
  const cached = state.materialCache.get(key);
  if (cached) {
    return cached;
  }

  const created = createDemo3DThreeMaterial(material, state.three);
  state.materialCache.set(key, created);
  state.stats.materials += 1;
  return created;
}

function indexSerializedObjects(project: Demo3DProject): Map<string, Demo3DXmlElement> {
  const indexed = new Map<string, Demo3DXmlElement>();
  const serializedObjects = project.root.child("SerializedObjects");
  if (!serializedObjects) {
    return indexed;
  }

  for (const item of serializedObjects.children) {
    const id = item.textOf("Id");
    if (id) {
      indexed.set(id, item);
    }
  }
  return indexed;
}

function findVisualAspects(visual: Demo3DVisual, state: RendererState): Demo3DXmlElement[] {
  const aspects = visual.xml.child("AS");
  if (!aspects) {
    return [];
  }

  const found: Demo3DXmlElement[] = [];
  for (const entry of aspects.children) {
    const id = entry.text;
    if (!id) {
      continue;
    }

    const aspect = state.serializedObjectById.get(id);
    if (aspect) {
      found.push(aspect);
    } else if (state.options.includeUnsupported) {
      warn(state, {
        code: "DEMO3D_THREE_MISSING_ASPECT",
        message: `Visual aspect ${id} does not exist in SerializedObjects.`,
        sourceId: visual.id,
        sourceType: visual.typeName,
        xmlPath: visual.xml.path
      });
    }
  }
  return found;
}

function createSerializedRenderableGroup(state: RendererState): Three.Group {
  const group = new state.three.Group();
  group.name = "Demo3D Unlinked Serialized Renderables";
  group.userData.demo3d = {
    kind: "unlinked-serialized-renderables",
    note: "Opt-in fallback for raw renderables that were not placed through visual aspect links."
  };

  const serializedObjects = state.project.root.child("SerializedObjects");
  if (!serializedObjects) {
    return group;
  }

  let index = 0;
  const max = state.options.maxSerializedRenderables ?? Number.POSITIVE_INFINITY;
  for (const item of serializedObjects.children) {
    const renderables = item.child("Renderables");
    if (!renderables) {
      continue;
    }

    for (const renderable of renderables.children) {
      if (index >= max) {
        warn(state, {
          code: "DEMO3D_THREE_RENDERABLE_LIMIT",
          message: `Stopped serialized renderable preview at ${max} objects.`,
          xmlPath: serializedObjects.path
        });
        return group;
      }

      const meshIds = findMeshReferenceIds(renderable);
      for (const meshId of meshIds) {
        const material = firstMaterial(renderable);
        const mesh = createMeshObject(meshId, renderable, material, state);
        if (!mesh) {
          continue;
        }

        applyRenderableTransform(mesh, renderable);
        positionSerializedPreviewMesh(mesh, index);
        group.add(mesh);
        state.stats.serializedRenderables += 1;
        index += 1;
      }
    }
  }

  return group;
}

function positionSerializedPreviewMesh(mesh: Three.Mesh, index: number): void {
  const columns = 30;
  const cellSize = 2.4;
  const targetSize = 1.65;
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox;
  if (!bounds) {
    mesh.position.set((index % columns) * cellSize, 0, Math.floor(index / columns) * cellSize);
    return;
  }

  const size = mesh.position.clone();
  const center = mesh.position.clone();
  bounds.getSize(size);
  bounds.getCenter(center);
  const maxSize = Math.max(size.x, size.y, size.z, 0.001);
  const scale = targetSize / maxSize;
  const gridX = (index % columns) * cellSize;
  const gridZ = Math.floor(index / columns) * cellSize;

  mesh.scale.setScalar(scale);
  mesh.position.set(gridX - center.x * scale, -center.y * scale, gridZ - center.z * scale);
}

function createPlaceholderMesh(name: string, state: RendererState): Three.Mesh {
  const geometry = new state.three.BoxGeometry(0.25, 0.25, 0.25);
  const mesh = new state.three.Mesh(geometry, state.defaultMaterial);
  mesh.name = `${name} placeholder`;
  mesh.userData.demo3d = { kind: "placeholder", sourceId: name };
  state.stats.meshes += 1;
  state.stats.geometries += 1;
  return mesh;
}

function applyRenderableTransform(object: Three.Object3D, renderable: Demo3DXmlElement): void {
  applyDemo3DTransform(object, renderable.textOf("LR"));
  const scale = parsePipeNumbers(renderable.textOf("Scale"));
  if (scale.length > 0) {
    object.scale.set(scale[0] ?? 1, scale[1] ?? scale[0] ?? 1, scale[2] ?? scale[0] ?? 1);
  }
}

function findMeshReferenceIds(root: Demo3DXmlElement): string[] {
  const ids = new Set<string>();
  visit(root, (node) => {
    if (node.localName === "MeshReference" || node.localName === "Mesh" || node.xsiType === "e3d:MeshReference") {
      const id = node.textOf("Id");
      if (id) {
        ids.add(id);
      }
    }
  });
  return [...ids];
}

function firstMaterial(root: Demo3DXmlElement): Demo3DMaterial | undefined {
  let found: Demo3DMaterial | undefined;
  visit(root, (node) => {
    if (!found && node.xsiType === "e3d:MeshMaterial") {
      found = new Demo3DMaterial(node.xsiType, node);
    }
  });
  return found;
}

function visit(root: Demo3DXmlElement, visitor: (node: Demo3DXmlElement) => void): void {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    visitor(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }
}

function vertexLayout(vertexFormat: string): { stride: number; normalOffset?: number; uvOffset?: number } {
  switch (vertexFormat) {
    case "Position":
      return { stride: 12 };
    case "PositionNormal":
      return { stride: 24, normalOffset: 12 };
    case "PositionNormalTexture":
      return { stride: 32, normalOffset: 12, uvOffset: 24 };
    default:
      throw new Error(`Unsupported Demo3D vertex format: ${vertexFormat}`);
  }
}

function readIndexBuffer(indices: Demo3DBinaryBlock, indexFormat: string | undefined): Uint16Array | Uint32Array {
  const bytes = indices.toUint8Array();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (indexFormat === "UInt16") {
    const out = new Uint16Array(bytes.length / 2);
    for (let index = 0; index < out.length; index += 1) {
      out[index] = view.getUint16(index * 2, true);
    }
    return out;
  }

  if (indexFormat === "UInt32") {
    const out = new Uint32Array(bytes.length / 4);
    for (let index = 0; index < out.length; index += 1) {
      out[index] = view.getUint32(index * 4, true);
    }
    return out;
  }

  throw new Error(`Unsupported Demo3D index format: ${indexFormat ?? "unknown"}`);
}

function demo3dColorToHex(color: number): number {
  const unsigned = color >>> 0;
  const red = (unsigned >>> 16) & 0xff;
  const green = (unsigned >>> 8) & 0xff;
  const blue = unsigned & 0xff;
  return (red << 16) | (green << 8) | blue;
}

function demo3dColorToOpacity(color: number): number {
  const alpha = (color >>> 24) & 0xff;
  return alpha === 0 ? 1 : alpha / 255;
}

function applyDemo3DTransform(object: Three.Object3D, transformText: string | undefined): void {
  const values = parsePipeNumbers(transformText);
  if (values.length === 0) {
    return;
  }

  object.position.set(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
  object.rotation.set(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0);
}

function parsePipeNumbers(value: string | undefined): Array<number | undefined> {
  if (!value) {
    return [];
  }

  return value.split("|").map((part) => {
    const trimmed = part.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  });
}

function numberChild(element: Demo3DXmlElement, localName: string, fallback: number): number {
  const value = element.textOf(localName);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function warn(state: RendererState, warning: Demo3DThreeWarning): void {
  state.stats.unsupported += 1;
  state.warnings.push(warning);
  state.options.onWarning?.(warning);
}

function isObject3D(value: Three.Object3D | undefined): value is Three.Object3D {
  return value !== undefined;
}
