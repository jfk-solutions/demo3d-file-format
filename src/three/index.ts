import type * as Three from "three";
import {
  Demo3DMaterial,
  Demo3DMesh,
  Demo3DPackage,
  Demo3DProject,
  Demo3DResource,
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
  readonly renderText?: boolean;
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
  textures: number;
  textVisuals: number;
  drawingBlocks: number;
  lines: number;
  directVisuals: number;
  imageVisuals: number;
  lights: number;
  missingGeometryPlaceholders: number;
  serializedRenderables: number;
  unsupported: number;
}

interface Demo3DTextureImage {
  readonly id: string;
  readonly name?: string;
  readonly base64: string;
  readonly mimeType: string;
  readonly width?: number;
  readonly height?: number;
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
  readonly textureImageById: Map<string, Demo3DTextureImage>;
  readonly drawingBlockById: Map<string, Demo3DXmlElement>;
  readonly bufferByName: Map<string, Uint8Array>;
  readonly geometryCache: Map<string, Three.BufferGeometry>;
  readonly primitiveGeometryCache: Map<string, Three.BufferGeometry>;
  readonly lineGeometryCache: Map<string, Three.BufferGeometry>;
  readonly materialCache: Map<string, Three.Material>;
  readonly textureCache: Map<string, Three.Texture>;
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
  const state = createState(three, project, options, parsed instanceof Demo3DPackage ? parsed.buffers : []);
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
  options: Demo3DThreeRendererOptions,
  buffers: readonly Demo3DResource[]
): RendererState {
  return {
    three,
    project,
    options,
    warnings: [],
    meshById: new Map(project.meshes.flatMap((mesh) => (mesh.id ? [[mesh.id, mesh] as const] : []))),
    serializedObjectById: indexSerializedObjects(project),
    textureImageById: indexTextureImages(project),
    drawingBlockById: indexDrawingBlocks(project),
    bufferByName: indexBuffers(buffers),
    geometryCache: new Map(),
    primitiveGeometryCache: new Map(),
    lineGeometryCache: new Map(),
    materialCache: new Map(),
    textureCache: new Map(),
    defaultMaterial: createDemo3DThreeMaterial(undefined, three),
    stats: {
      groups: 0,
      meshes: 0,
      geometries: 0,
      materials: 1,
      textures: 0,
      textVisuals: 0,
      drawingBlocks: 0,
      lines: 0,
      directVisuals: 0,
      imageVisuals: 0,
      lights: 0,
      missingGeometryPlaceholders: 0,
      serializedRenderables: 0,
      unsupported: 0
    }
  };
}

function createVisualObject(visual: Demo3DVisual, state: RendererState): Three.Object3D {
  const refs = findMeshReferenceIds(visual.xml);
  const meshes: Three.Object3D[] = [];
  const textObjects: Three.Object3D[] = [];
  const drawingBlockObjects: Three.Object3D[] = [];
  const directVisualObjects: Three.Object3D[] = [];
  const placeholderObjects: Three.Object3D[] = [];
  const textObject = createTextVisualObject(visual, state);
  if (textObject) {
    textObjects.push(textObject);
    meshes.push(textObject);
  }
  const drawingBlockObject = createDrawingBlockVisualObject(visual, state);
  if (drawingBlockObject) {
    drawingBlockObjects.push(drawingBlockObject);
    meshes.push(drawingBlockObject);
  }
  const directVisualObject = createDirectVisualObject(visual, state);
  if (directVisualObject) {
    directVisualObjects.push(directVisualObject);
    meshes.push(directVisualObject);
  }

  for (const ref of refs) {
    const mesh = createMeshObject(ref, visual, visual.materials[0], state);
    if (mesh) {
      if (mesh.userData.demo3d?.kind === "missing-geometry-placeholder") {
        placeholderObjects.push(mesh);
      }
      meshes.push(mesh);
    }
  }
  const aspectRenderableObjects = createAspectRenderableObjects(visual, state);
  meshes.push(...aspectRenderableObjects);

  let object: Three.Object3D;

  if (
    meshes.length === 1 &&
    visual.children.length === 0 &&
    aspectRenderableObjects.length === 0 &&
    textObjects.length === 0 &&
    drawingBlockObjects.length === 0 &&
    directVisualObjects.length === 0 &&
    placeholderObjects.length === 0
  ) {
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
  applyDemo3DScale(object, visual.properties?.textOf("Scale"));
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
        const existingDemo3D = mesh.userData.demo3d ?? {};
        mesh.userData.demo3d = {
          ...existingDemo3D,
          kind: existingDemo3D.kind === "missing-geometry-placeholder" ? existingDemo3D.kind : "renderable",
          renderableKind: "renderable",
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

function createTextVisualObject(visual: Demo3DVisual, state: RendererState): Three.Mesh | undefined {
  if (state.options.renderText === false || visual.typeName !== "e3d:TextVisual") {
    return undefined;
  }

  const properties = visual.properties;
  if (!properties) {
    return undefined;
  }

  const text = properties?.textOf("Text");
  if (!text) {
    return undefined;
  }

  const material = firstMaterial(visual.xml);
  const color = demo3dColorToHex(material?.diffuse ?? -1);
  const lineHeight = numberChild(properties, "LineHeight", 0.05);
  const bold = properties?.textOf("Bold") === "1" || properties?.textOf("Bold")?.toLowerCase() === "true";
  const textMesh = canUseCanvas()
    ? createCanvasTextMesh(text, lineHeight, color, bold, state)
    : createFallbackTextMesh(text, lineHeight, material, state);

  textMesh.name = visual.displayName ?? text;
  textMesh.userData.demo3d = {
    kind: "text",
    id: visual.id,
    text,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    lineHeight,
    fontFamily: properties?.textOf("FontFamily"),
    horizontalAlign: properties?.textOf("HorizontalAlign"),
    verticalAlign: properties?.textOf("VerticalAlign")
  };
  state.stats.meshes += 1;
  state.stats.textVisuals += 1;
  return textMesh;
}

function createDrawingBlockVisualObject(visual: Demo3DVisual, state: RendererState): Three.Object3D | undefined {
  if (visual.typeName !== "e3d:PrimitivesVisual") {
    return undefined;
  }

  const blockId = visual.properties?.textOf("DrawingBlockRef");
  if (!blockId) {
    return undefined;
  }

  const geometry = getDrawingBlockGeometry(blockId, state);
  if (!geometry) {
    return undefined;
  }

  const material = getLineMaterial(firstMaterial(visual.xml) ?? visual.materials[0], state);
  const object = new state.three.LineSegments(geometry, material);
  object.name = visual.displayName ?? blockId;
  object.userData.demo3d = {
    kind: "drawing-block",
    id: visual.id,
    blockId,
    typeName: visual.typeName,
    xmlPath: visual.xml.path
  };
  state.stats.drawingBlocks += 1;
  state.stats.lines += geometry.getAttribute("position").count / 2;
  return object;
}

function createDirectVisualObject(visual: Demo3DVisual, state: RendererState): Three.Object3D | undefined {
  if (!isRenderableVisualVisible(visual)) {
    return undefined;
  }

  if (visual.typeName === "e3d:LightVisual") {
    return createLightObject(visual, state);
  }

  if (visual.typeName === "e3d:ImportedImageVisual") {
    return createImportedImageObject(visual, state);
  }

  const geometry = getDirectVisualGeometry(visual, state);
  if (!geometry) {
    return undefined;
  }

  const object = new state.three.Mesh(geometry, getMaterial(primaryMaterial(visual), state));
  object.name = visual.displayName ?? visual.id ?? visual.typeName;
  object.userData.demo3d = {
    kind: "direct-visual",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path
  };
  state.stats.meshes += 1;
  state.stats.directVisuals += 1;
  return object;
}

function createImportedImageObject(visual: Demo3DVisual, state: RendererState): Three.Mesh | undefined {
  const properties = visual.properties;
  if (!properties) {
    return undefined;
  }

  const width = numberChild(properties, "WidthScale", 1);
  const height = numberChild(properties, "HeightScale", 1);
  const geometry = new state.three.PlaneGeometry(width, height);
  const material = getImageMaterial(primaryMaterial(visual), state);
  const object = new state.three.Mesh(geometry, material);
  object.name = visual.displayName ?? visual.id ?? visual.typeName;
  object.userData.demo3d = {
    kind: "image",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path
  };
  state.stats.geometries += 1;
  state.stats.meshes += 1;
  state.stats.imageVisuals += 1;
  return object;
}

function createLightObject(visual: Demo3DVisual, state: RendererState): Three.Object3D | undefined {
  const properties = visual.properties;
  const color = demo3dColorToHex(numberChildOptional(properties, "Diffuse") ?? -1);
  const lightType = properties?.textOf("LightType") ?? "Directional";
  const light =
    lightType === "Point"
      ? new state.three.PointLight(color, 1.4)
      : new state.three.DirectionalLight(color, 1.4);
  light.name = visual.displayName ?? visual.id ?? visual.typeName;
  light.userData.demo3d = {
    kind: "light",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    lightType,
    xmlPath: visual.xml.path
  };
  state.stats.lights += 1;
  return light;
}

function getDirectVisualGeometry(visual: Demo3DVisual, state: RendererState): Three.BufferGeometry | undefined {
  const properties = visual.properties;
  if (!properties) {
    return undefined;
  }

  const key = `direct:${visual.typeName}:${[
    properties.textOf("Angle") ?? "",
    properties.textOf("Depth") ?? "",
    properties.textOf("Height") ?? "",
    properties.textOf("Length") ?? "",
    properties.textOf("Radius") ?? "",
    properties.textOf("StartAngle") ?? "",
    properties.textOf("Width") ?? ""
  ].join("|")}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  let geometry: Three.BufferGeometry | undefined;
  if (visual.typeName === "e3d:BoxVisual" || visual.typeName === "e3d:BoxTubeVisual") {
    geometry = new state.three.BoxGeometry(
      numberChild(properties, "Width", 1),
      numberChild(properties, "Height", 1),
      numberChild(properties, "Depth", 1)
    );
  } else if (visual.typeName === "e3d:CylinderVisual") {
    geometry = new state.three.CylinderGeometry(
      numberChild(properties, "Radius", 0.5),
      numberChild(properties, "Radius", 0.5),
      numberChild(properties, "Length", 1),
      32,
      1,
      false,
      degreesToRadians(numberChild(properties, "StartAngle", 0)),
      degreesToRadians(numberChild(properties, "Angle", 360))
    );
  } else if (visual.typeName === "e3d:WedgeVisual") {
    geometry = createWedgeGeometry(
      numberChild(properties, "Width", 1),
      numberChild(properties, "Height", 1),
      numberChild(properties, "Length", 1),
      state
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

function createWedgeGeometry(
  width: number,
  height: number,
  length: number,
  state: RendererState
): Three.BufferGeometry {
  const x = width / 2;
  const y = height / 2;
  const z = length / 2;
  const vertices = new Float32Array([
    -x, -y, -z,
    x, -y, -z,
    -x, -y, z,
    x, -y, z,
    -x, y, -z,
    x, y, -z
  ]);
  const indices = [0, 1, 2, 1, 3, 2, 0, 4, 1, 1, 4, 5, 0, 2, 4, 1, 5, 3, 2, 3, 4, 3, 5, 4];
  const geometry = new state.three.BufferGeometry();
  geometry.setAttribute("position", new state.three.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function getDrawingBlockGeometry(blockId: string, state: RendererState): Three.BufferGeometry | undefined {
  const cached = state.lineGeometryCache.get(blockId);
  if (cached) {
    return cached;
  }

  const block = state.drawingBlockById.get(blockId);
  const brep = block?.child("BREP");
  if (!block) {
    return undefined;
  }

  const positions: number[] = [];
  if (brep) {
    for (const entity of brep.children) {
      const points = parseBrepPoints(entity.textOf("C"));
      if (points.length < 2) {
        continue;
      }

      if (entity.xsiType === "Demo3D.BREP.Line") {
        pushLineSegment(positions, points[0], points[1]);
      } else if (entity.xsiType === "Demo3D.BREP.Curve") {
        for (let index = 1; index < points.length; index += 1) {
          pushLineSegment(positions, points[index - 1], points[index]);
        }
      }
    }
  }

  if (positions.length === 0) {
    for (const name of block.childrenNamed("Name")) {
      const buffer = state.bufferByName.get(name.text.toLowerCase());
      if (buffer) {
        pushFloat32LineSegments(positions, buffer);
      }
    }
  }

  if (positions.length === 0) {
    return undefined;
  }

  const geometry = new state.three.BufferGeometry();
  geometry.setAttribute("position", new state.three.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.lineGeometryCache.set(blockId, geometry);
  state.stats.geometries += 1;
  return geometry;
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
    return state.options.showPlaceholders === false
      ? undefined
      : createPlaceholderMesh(sourceId ?? meshId, meshId, material, state);
  }

  const geometry = getGeometry(mesh, state);
  if (!geometry) {
    return state.options.showPlaceholders === false
      ? undefined
      : createPlaceholderMesh(sourceId ?? meshId, meshId, material, state);
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

  const textureReference = material.textureReference;
  const key = `${String(material.diffuse ?? "default")}:${textureReference ?? ""}`;
  const cached = state.materialCache.get(key);
  if (cached) {
    return cached;
  }

  const created = createDemo3DThreeMaterial(material, state.three);
  const texture = textureReference ? getTexture(textureReference, state) : undefined;
  if (texture && "map" in created) {
    (created as Three.MeshStandardMaterial).map = texture;
    created.needsUpdate = true;
  }
  state.materialCache.set(key, created);
  state.stats.materials += 1;
  return created;
}

function getImageMaterial(material: Demo3DMaterial | undefined, state: RendererState): Three.Material {
  const diffuse = material?.diffuse;
  const textureReference = material?.textureReference;
  const texture = textureReference ? getTexture(textureReference, state) : undefined;
  const key = `image:${String(diffuse ?? "default")}:${textureReference ?? ""}`;
  const cached = state.materialCache.get(key);
  if (cached) {
    return cached;
  }

  const parameters: Three.MeshBasicMaterialParameters = {
    color: diffuse === undefined ? 0xffffff : demo3dColorToHex(diffuse),
    transparent: texture !== undefined || demo3dColorToOpacity(diffuse ?? 0xffffffff) < 1,
    opacity: diffuse === undefined ? 1 : demo3dColorToOpacity(diffuse),
    side: state.three.DoubleSide
  };
  if (texture) {
    parameters.map = texture;
  }

  const created = new state.three.MeshBasicMaterial(parameters);
  state.materialCache.set(key, created);
  state.stats.materials += 1;
  return created;
}

function primaryMaterial(visual: Demo3DVisual): Demo3DMaterial | undefined {
  const materialNode =
    visual.properties?.child("Material") ??
    visual.properties?.child("OuterMaterial") ??
    visual.properties?.child("SurfaceMaterial") ??
    visual.properties ??
    visual.xml;
  return firstMaterial(materialNode) ?? visual.materials[0];
}

function getTexture(textureReference: string, state: RendererState): Three.Texture | undefined {
  const cached = state.textureCache.get(textureReference);
  if (cached) {
    return cached;
  }

  const image = state.textureImageById.get(textureReference);
  if (!image || typeof state.three.TextureLoader !== "function" || typeof document !== "object") {
    return undefined;
  }

  const texture = new state.three.TextureLoader().load(`data:${image.mimeType};base64,${image.base64}`);
  if ("SRGBColorSpace" in state.three) {
    texture.colorSpace = state.three.SRGBColorSpace;
  }
  texture.name = image.name ?? image.id;
  texture.flipY = false;
  state.textureCache.set(textureReference, texture);
  state.stats.textures += 1;
  return texture;
}

function createCanvasTextMesh(
  text: string,
  lineHeight: number,
  color: number,
  bold: boolean,
  state: RendererState
): Three.Mesh {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return createFallbackTextMesh(text, lineHeight, undefined, state);
  }

  const fontSize = 64;
  const padding = 12;
  context.font = `${bold ? "700 " : ""}${fontSize}px sans-serif`;
  const metrics = context.measureText(text);
  canvas.width = Math.max(16, Math.ceil(metrics.width + padding * 2));
  canvas.height = fontSize + padding * 2;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `${bold ? "700 " : ""}${fontSize}px sans-serif`;
  context.textBaseline = "middle";
  context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.fillText(text, padding, canvas.height / 2);

  const texture = new state.three.CanvasTexture(canvas);
  if ("SRGBColorSpace" in state.three) {
    texture.colorSpace = state.three.SRGBColorSpace;
  }
  texture.needsUpdate = true;
  state.stats.textures += 1;

  const aspect = canvas.width / canvas.height;
  const geometry = new state.three.PlaneGeometry(Math.max(lineHeight * aspect, lineHeight), lineHeight);
  const material = new state.three.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: state.three.DoubleSide,
    depthWrite: false
  });
  state.stats.geometries += 1;
  state.stats.materials += 1;
  return new state.three.Mesh(geometry, material);
}

function createFallbackTextMesh(
  text: string,
  lineHeight: number,
  material: Demo3DMaterial | undefined,
  state: RendererState
): Three.Mesh {
  const geometry = new state.three.PlaneGeometry(Math.max(text.length * lineHeight * 0.6, lineHeight), lineHeight);
  const mesh = new state.three.Mesh(geometry, getMaterial(material, state));
  state.stats.geometries += 1;
  return mesh;
}

function getLineMaterial(material: Demo3DMaterial | undefined, state: RendererState): Three.Material {
  const color = material?.diffuse === undefined ? 0x202124 : demo3dColorToHex(material.diffuse);
  const key = `line:${color}`;
  const cached = state.materialCache.get(key);
  if (cached) {
    return cached;
  }

  const created = new state.three.LineBasicMaterial({ color });
  state.materialCache.set(key, created);
  state.stats.materials += 1;
  return created;
}

function parseBrepPoints(value: string | undefined): Array<[number, number, number]> {
  if (!value) {
    return [];
  }

  return value
    .split("|")
    .map((point) => point.trim())
    .filter(Boolean)
    .map((point) => {
      const values = point
        .split(/\s+/)
        .map((part) => Number.parseFloat(part))
        .filter((part) => Number.isFinite(part));
      return values.length >= 3 ? ([values[0], values[1], values[2]] as [number, number, number]) : undefined;
    })
    .filter((point): point is [number, number, number] => point !== undefined);
}

function pushLineSegment(
  positions: number[],
  start: readonly [number, number, number],
  end: readonly [number, number, number]
): void {
  positions.push(start[0], start[1], start[2], end[0], end[1], end[2]);
}

function pushFloat32LineSegments(positions: number[], buffer: Uint8Array): void {
  if (buffer.byteLength < 24) {
    return;
  }

  const lineByteLength = Math.floor(buffer.byteLength / 24) * 24;
  const view = new DataView(buffer.buffer, buffer.byteOffset, lineByteLength);
  for (let offset = 0; offset < lineByteLength; offset += 24) {
    const values = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
      view.getFloat32(offset + 12, true),
      view.getFloat32(offset + 16, true),
      view.getFloat32(offset + 20, true)
    ];

    if (values.every((value) => Number.isFinite(value))) {
      positions.push(...values);
    }
  }
}

function canUseCanvas(): boolean {
  return typeof document === "object" && typeof document.createElement === "function";
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

function indexTextureImages(project: Demo3DProject): Map<string, Demo3DTextureImage> {
  const indexed = new Map<string, Demo3DTextureImage>();
  const textures = project.root.child("TextureLibrary")?.child("Textures");
  if (!textures) {
    return indexed;
  }

  for (const entry of textures.children) {
    const id = entry.child("key")?.textOf("Id") ?? entry.child("key")?.text;
    const value = entry.child("val");
    const bytes = value?.child("Image")?.child("bytes")?.text;
    if (!id || !bytes) {
      continue;
    }

    indexed.set(id, {
      id,
      name: value?.textOf("Name"),
      base64: bytes,
      mimeType: imageMimeType(bytes),
      width: numberChildOptional(value, "Width"),
      height: numberChildOptional(value, "Height")
    });
  }

  return indexed;
}

function indexDrawingBlocks(project: Demo3DProject): Map<string, Demo3DXmlElement> {
  const indexed = new Map<string, Demo3DXmlElement>();
  const blocks = project.root.child("DrawingBlockLibrary")?.child("Blocks");
  if (!blocks) {
    return indexed;
  }

  for (const entry of blocks.children) {
    const id = entry.child("key")?.text;
    const value = entry.child("val");
    if (id && value) {
      indexed.set(id, value);
    }
  }

  return indexed;
}

function indexBuffers(buffers: readonly Demo3DResource[]): Map<string, Uint8Array> {
  const indexed = new Map<string, Uint8Array>();
  for (const buffer of buffers) {
    if (!buffer.data) {
      continue;
    }

    const name = buffer.path.split("/").pop();
    if (name) {
      indexed.set(name.toLowerCase(), buffer.data);
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

function createPlaceholderMesh(
  name: string,
  meshReferenceId: string,
  material: Demo3DMaterial | undefined,
  state: RendererState
): Three.Mesh {
  const geometry = new state.three.BoxGeometry(0.25, 0.25, 0.25);
  const mesh = new state.three.Mesh(geometry, getMaterial(material, state));
  mesh.name = `${name} missing geometry`;
  mesh.userData.demo3d = {
    kind: "missing-geometry-placeholder",
    sourceId: name,
    meshReferenceId
  };
  state.stats.meshes += 1;
  state.stats.geometries += 1;
  state.stats.missingGeometryPlaceholders += 1;
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

function applyDemo3DScale(object: Three.Object3D, scaleText: string | undefined): void {
  const values = parsePipeNumbers(scaleText);
  if (values.length === 0) {
    return;
  }

  object.scale.set(
    object.scale.x * (values[0] ?? 1),
    object.scale.y * (values[1] ?? 1),
    object.scale.z * (values[2] ?? 1)
  );
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

function numberChildOptional(element: Demo3DXmlElement | undefined, localName: string): number | undefined {
  const value = element?.textOf(localName);
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRenderableVisualVisible(visual: Demo3DVisual): boolean {
  const visible = visual.properties?.textOf("Visible");
  return visible === undefined || !(visible === "0" || visible.toLowerCase() === "false");
}

function imageMimeType(base64: string): string {
  if (base64.startsWith("iVBORw0KGgo")) {
    return "image/png";
  }

  if (base64.startsWith("/9j/")) {
    return "image/jpeg";
  }

  if (base64.startsWith("R0lGOD")) {
    return "image/gif";
  }

  return "application/octet-stream";
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
