import type * as Three from "three";
import {
  Demo3DConveyorSideProperties,
  Demo3DDimensionAspect,
  Demo3DDimensionPoint,
  Demo3DExtrusionPolygon,
  Demo3DExtrusionProfile,
  Demo3DMaterial,
  Demo3DMesh,
  Demo3DPackage,
  Demo3DPointCloud,
  Demo3DProject,
  Demo3DPhotoEye,
  Demo3DResource,
  Demo3DSupportStand,
  Demo3DVisual
} from "../model.js";
import { Demo3DBinaryBlock, Demo3DXmlElement } from "../xml.js";

export {
  createRaw3DThreeGroup,
  createRaw3DThreeScene,
  decodeRaw3DThreeGeometry,
  type Raw3DThreeModule,
  type Raw3DThreeOptions,
  type Raw3DThreeScene,
  type Raw3DThreeStats,
  type Raw3DThreeWarning
} from "./raw3d.js";

export {
  createDemo3DThreeRenderer,
  type Demo3DThreeCanvasRendererOptions,
  type Demo3DThreeModule,
  type Demo3DThreeRendererInstance,
  type Demo3DThreeRendererFallback,
  type Demo3DThreeRendererResult,
  type Demo3DThreeRenderBackend,
  type Demo3DThreeWebGPUModule
} from "./renderer.js";

export {
  applyDemo3DThreeRenderMode,
  type Demo3DThreeRenderMode,
  type Demo3DThreeRenderModeOptions,
  type Demo3DThreeRenderModeResult
} from "./presentation.js";

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
  readonly renderProceduralBelts?: boolean;
  readonly renderProceduralRacks?: boolean;
  readonly renderProceduralSupportStands?: boolean;
  readonly renderProceduralConveyorSides?: boolean;
  readonly renderProceduralPhotoEyes?: boolean;
  readonly renderProceduralRollers?: boolean;
  readonly renderProceduralMotors?: boolean;
  readonly renderDimensions?: boolean;
  readonly includeHiddenLayers?: boolean;
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
  proceduralBelts: number;
  proceduralRacks: number;
  proceduralSupportStands: number;
  proceduralConveyorSides: number;
  proceduralPhotoEyes: number;
  proceduralRollers: number;
  proceduralMotors: number;
  dimensions: number;
  unreconstructedProceduralVisuals: number;
  imageVisuals: number;
  lights: number;
  pointClouds: number;
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
  readonly containsAlpha: boolean;
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
  readonly pointCloudById: Map<string, Demo3DPointCloud>;
  readonly serializedObjectById: Map<string, Demo3DXmlElement>;
  readonly textureImageById: Map<string, Demo3DTextureImage>;
  readonly drawingBlockById: Map<string, Demo3DXmlElement>;
  readonly bufferByName: Map<string, Uint8Array>;
  readonly geometryCache: Map<string, Three.BufferGeometry>;
  readonly primitiveGeometryCache: Map<string, Three.BufferGeometry>;
  readonly lineGeometryCache: Map<string, Three.BufferGeometry>;
  readonly materialCache: Map<string, Three.Material>;
  readonly textureCache: Map<string, Three.Texture>;
  readonly visualObjectById: Map<string, Three.Object3D>;
  readonly layerVisibilityByName: ReadonlyMap<string, boolean>;
  readonly renderableObjectTrees: WeakSet<Three.Object3D>;
  readonly warnedGeneratedTypes: Set<string>;
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

  if (options.renderDimensions === true) {
    root.updateWorldMatrix(true, true);
    const dimensions = createDimensionGroup(state);
    if (dimensions.children.length > 0) {
      root.add(dimensions);
    }
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
  addMeshSubsetGroups(geometry, mesh);

  convertTriangleGeometryToThreeCoordinates(geometry);
  if (!normals) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addMeshSubsetGroups(geometry: Three.BufferGeometry, mesh: Demo3DMesh): void {
  const subsets = mesh.auxiliary?.toUint8Array();
  const drawCount = geometry.getIndex()?.count ?? geometry.getAttribute("position").count;
  const faceCount = Math.floor(drawCount / 3);
  if (!subsets || subsets.length !== faceCount || faceCount === 0) {
    return;
  }

  let runStart = 0;
  let materialIndex = subsets[0] ?? 0;
  for (let face = 1; face <= faceCount; face += 1) {
    const nextMaterialIndex = face < faceCount ? subsets[face] : undefined;
    if (face < faceCount && nextMaterialIndex === materialIndex) {
      continue;
    }
    geometry.addGroup(runStart * 3, (face - runStart) * 3, materialIndex);
    runStart = face;
    materialIndex = nextMaterialIndex ?? 0;
  }
}

export function createDemo3DThreeMaterial(
  material: Demo3DMaterial | undefined,
  three: ThreeModule
): Three.Material {
  const diffuse = material?.diffuse;
  const color = diffuse === undefined ? 0x9aa0a6 : demo3dColorToHex(diffuse);
  const opacity = demo3dMaterialOpacity(material);
  const reflectivity = clamp01(material?.reflectivity ?? 0);
  return new three.MeshStandardMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    roughness: 0.9 - reflectivity * 0.75,
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
    pointCloudById: new Map(project.pointClouds.flatMap((pointCloud) =>
      pointCloud.id ? [[pointCloud.id, pointCloud] as const] : []
    )),
    serializedObjectById: indexSerializedObjects(project),
    textureImageById: indexTextureImages(project),
    drawingBlockById: indexDrawingBlocks(project),
    bufferByName: indexBuffers(buffers),
    geometryCache: new Map(),
    primitiveGeometryCache: new Map(),
    lineGeometryCache: new Map(),
    materialCache: new Map(),
    textureCache: new Map(),
    visualObjectById: new Map(),
    layerVisibilityByName: new Map(project.layers.map((layer) => [layer.name, layer.visible])),
    renderableObjectTrees: new WeakSet(),
    warnedGeneratedTypes: new Set(),
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
      proceduralBelts: 0,
      proceduralRacks: 0,
      proceduralSupportStands: 0,
      proceduralConveyorSides: 0,
      proceduralPhotoEyes: 0,
      proceduralRollers: 0,
      proceduralMotors: 0,
      dimensions: 0,
      unreconstructedProceduralVisuals: 0,
      imageVisuals: 0,
      lights: 0,
      pointClouds: 0,
      missingGeometryPlaceholders: 0,
      serializedRenderables: 0,
      unsupported: 0
    }
  };
}

function createVisualObject(
  visual: Demo3DVisual,
  state: RendererState,
  inheritedLayer?: string,
  parentVisual?: Demo3DVisual
): Three.Object3D {
  const layer = visual.layer ?? inheritedLayer;
  const renderCurrent = isRenderableVisualVisible(visual) && isLayerVisible(layer, state);
  const refs = renderCurrent ? findVisualMeshReferenceIds(visual.xml) : [];
  const meshes: Three.Object3D[] = [];
  const textObjects: Three.Object3D[] = [];
  const drawingBlockObjects: Three.Object3D[] = [];
  const directVisualObjects: Three.Object3D[] = [];
  const placeholderObjects: Three.Object3D[] = [];
  const textObject = renderCurrent ? createTextVisualObject(visual, state) : undefined;
  if (textObject) {
    textObjects.push(textObject);
    meshes.push(textObject);
  }
  const drawingBlockObject = renderCurrent ? createDrawingBlockVisualObject(visual, state) : undefined;
  if (drawingBlockObject) {
    drawingBlockObjects.push(drawingBlockObject);
    meshes.push(drawingBlockObject);
  }
  const directVisualObject = renderCurrent ? createDirectVisualObject(visual, state, parentVisual) : undefined;
  if (directVisualObject) {
    directVisualObjects.push(directVisualObject);
    meshes.push(directVisualObject);
  }

  for (const ref of refs) {
    const mesh = createMeshObject(ref, visual, visual.materials, state);
    if (mesh) {
      if (mesh.userData.demo3d?.kind === "missing-geometry-placeholder") {
        placeholderObjects.push(mesh);
      }
      meshes.push(mesh);
    }
  }
  const aspectRenderableObjects = renderCurrent ? createAspectRenderableObjects(visual, state) : [];
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
    localTransformText: visual.xml.textOf("LR"),
    layer,
    layerVisible: isLayerVisible(layer, state)
  };
  if (visual.id) {
    state.visualObjectById.set(visual.id, object);
  }

  let containsRenderable = meshes.length > 0;
  for (const child of visual.children) {
    const childObject = createVisualObject(child, state, layer, visual);
    object.add(childObject);
    containsRenderable ||= state.renderableObjectTrees.has(childObject);
  }
  if (containsRenderable) {
    state.renderableObjectTrees.add(object);
  }
  if (renderCurrent) {
    reportUnreconstructedProceduralVisual(visual, containsRenderable, state);
  }

  return object;
}

function reportUnreconstructedProceduralVisual(
  visual: Demo3DVisual,
  containsRenderable: boolean,
  state: RendererState
): void {
  if (
    state.options.includeUnsupported !== true ||
    !visual.properties?.xsiType?.endsWith("ScriptProperties") ||
    visual.typeName === "e3d:PhotoEye" ||
    containsRenderable
  ) {
    return;
  }

  state.stats.unreconstructedProceduralVisuals += 1;
  if (state.warnedGeneratedTypes.has(visual.typeName)) {
    return;
  }
  state.warnedGeneratedTypes.add(visual.typeName);
  warn(state, {
    code: "DEMO3D_THREE_UNRECONSTRUCTABLE_SCRIPT_VISUAL",
    message: `${visual.typeName} has script properties but no serialized geometry or dimensions to reconstruct.`,
    sourceId: visual.id,
    sourceType: visual.typeName,
    xmlPath: visual.xml.path
  });
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
        const serializedMaterials = renderableMaterials(renderable);
        const materials = serializedMaterials.length > 0 ? serializedMaterials : visual.materials;
        const primaryMaterial = materials[0];
        const mesh = state.meshById.has(meshId)
          ? createMeshObject(meshId, renderable, materials, state)
          : createPrimitiveRenderableObject(aspect, renderable, meshId, primaryMaterial, state) ??
            createMeshObject(meshId, renderable, materials, state);
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

function createDirectVisualObject(
  visual: Demo3DVisual,
  state: RendererState,
  parentVisual?: Demo3DVisual
): Three.Object3D | undefined {
  if (!isRenderableVisualVisible(visual)) {
    return undefined;
  }

  if (visual.typeName === "e3d:LightVisual") {
    return createLightObject(visual, state);
  }

  if (visual.typeName === "e3d:ImportedImageVisual") {
    return createImportedImageObject(visual, state);
  }

  if (visual.typeName === "e3d:PointCloudVisual") {
    return createPointCloudObject(visual, state);
  }

  if (
    visual.typeName === "e3d:StraightBeltConveyor" ||
    visual.typeName === "e3d:CurveBeltConveyor" ||
    visual.typeName === "e3d:InjectorBeltConveyor"
  ) {
    return state.options.renderProceduralBelts === true
      ? createBeltConveyorObject(visual, state)
      : undefined;
  }

  if (visual.typeName === "e3d:RackVisual") {
    return state.options.renderProceduralRacks === true
      ? createRackObject(visual, state)
      : undefined;
  }

  if (visual.typeName === "e3d:SupportStand") {
    return state.options.renderProceduralSupportStands === true
      ? createSupportStandObject(visual, parentVisual, state)
      : undefined;
  }

  if (visual.typeName === "e3d:PhotoEye") {
    return state.options.renderProceduralPhotoEyes === true
      ? createPhotoEyeObject(visual, parentVisual, state)
      : undefined;
  }

  if (isRollerConveyorType(visual.typeName)) {
    return createProceduralRollerConveyorObject(visual, state);
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

function createPointCloudObject(
  visual: Demo3DVisual,
  state: RendererState
): Three.Object3D | undefined {
  const referenceId = visual.properties?.textOf("PointCloudRef");
  const pointCloud = referenceId ? state.pointCloudById.get(referenceId) : undefined;
  if (!pointCloud) {
    warn(state, {
      code: "DEMO3D_THREE_MISSING_POINT_CLOUD",
      message: `Point cloud reference ${referenceId ?? "<missing>"} could not be resolved.`,
      sourceId: visual.id,
      sourceType: visual.typeName,
      xmlPath: visual.xml.path
    });
    return undefined;
  }

  const group = new state.three.Group();
  group.name = visual.displayName ?? pointCloud.name ?? referenceId ?? visual.typeName;
  const fallbackColor = primaryMaterial(visual)?.diffuse;
  const pointSize = Math.min(128, Math.max(1, numberChild(visual.properties!, "PointSize", 1)));
  for (const [primitiveIndex, primitive] of pointCloud.primitives.entries()) {
    const bufferName = primitive.pointsBufferName;
    const buffer = bufferName ? state.bufferByName.get(bufferName.toLowerCase()) : undefined;
    if (!buffer) {
      warn(state, {
        code: "DEMO3D_THREE_MISSING_POINT_CLOUD_BUFFER",
        message: `Point cloud buffer ${bufferName ?? "<missing>"} could not be resolved.`,
        sourceId: visual.id,
        sourceType: visual.typeName,
        xmlPath: primitive.xml.path
      });
      continue;
    }
    if (buffer.byteLength % 12 !== 0) {
      warn(state, {
        code: "DEMO3D_THREE_INVALID_POINT_CLOUD_BUFFER",
        message: `Point cloud buffer ${bufferName} has ${buffer.byteLength} bytes; expected packed Float32 XYZ triples.`,
        sourceId: visual.id,
        sourceType: visual.typeName,
        xmlPath: primitive.xml.path
      });
      continue;
    }

    const positions = new Float32Array(buffer.byteLength / 4);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] = view.getFloat32(index * 4, true);
      positions[index + 1] = view.getFloat32((index + 1) * 4, true);
      positions[index + 2] = -view.getFloat32((index + 2) * 4, true);
    }
    const geometry = new state.three.BufferGeometry();
    geometry.setAttribute("position", new state.three.BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new state.three.PointsMaterial({
      color: demo3dColorToHex(primitive.color ?? fallbackColor ?? -1),
      size: pointSize,
      sizeAttenuation: false
    });
    const points = new state.three.Points(geometry, material);
    points.name = pointCloud.primitives.length > 1 ? `${group.name} ${primitiveIndex + 1}` : group.name;
    points.userData.demo3d = {
      kind: "point-cloud-primitive",
      pointCloudId: pointCloud.id,
      bufferName,
      pointCount: positions.length / 3
    };
    group.add(points);
    state.stats.geometries += 1;
    state.stats.materials += 1;
  }

  if (group.children.length === 0) {
    return undefined;
  }
  group.userData.demo3d = {
    kind: "point-cloud",
    id: visual.id,
    pointCloudId: pointCloud.id,
    typeName: visual.typeName,
    xmlPath: visual.xml.path
  };
  state.stats.groups += 1;
  state.stats.directVisuals += 1;
  state.stats.pointClouds += 1;
  return group;
}

function createBeltConveyorObject(
  visual: Demo3DVisual,
  state: RendererState
): Three.Mesh | undefined {
  if (visual.typeName === "e3d:CurveBeltConveyor") {
    return createCurveBeltConveyorObject(visual, state);
  }
  if (visual.typeName === "e3d:InjectorBeltConveyor") {
    const injector = createInjectorBeltConveyorObject(visual, state);
    if (injector) {
      return injector;
    }
  }

  const belt = readProceduralBelt(visual, state);
  if (!belt) {
    return undefined;
  }

  const geometry = getProceduralBeltGeometry(belt, state);
  const object = new state.three.Mesh(geometry, [
    getMaterial(belt.surfaceMaterial, state),
    getMaterial(belt.sideMaterial, state)
  ]);
  object.name = visual.displayName ?? visual.id ?? visual.typeName;
  object.userData.demo3d = {
    kind: "procedural-belt",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    length: belt.length,
    width: belt.width,
    loopHeight: belt.thickness,
    radius: belt.endRadius,
    startCap: belt.startCap,
    endCap: belt.endCap
  };
  state.stats.meshes += 1;
  state.stats.directVisuals += 1;
  state.stats.proceduralBelts += 1;
  return object;
}

const DEFAULT_BELT_WIDTH = 0.5;
const DEFAULT_BELT_DIAMETER = 0.06;

type Point3 = readonly [number, number, number];

function appendOrientedTriangle(
  target: number[],
  a: Point3,
  b: Point3,
  c: Point3,
  normal: Point3
): void {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  const forward = crossX * normal[0] + crossY * normal[1] + crossZ * normal[2] >= 0;
  target.push(...a, ...(forward ? b : c), ...(forward ? c : b));
}

function appendOrientedQuad(
  target: number[],
  a: Point3,
  b: Point3,
  c: Point3,
  d: Point3,
  normal: Point3
): void {
  appendOrientedTriangle(target, a, b, c, normal);
  appendOrientedTriangle(target, a, c, d, normal);
}

interface ProceduralInjectorBelt {
  readonly startEdge: readonly [Point3, Point3];
  readonly endEdge: readonly [Point3, Point3];
  readonly thickness: number;
  readonly surfaceMaterial?: Demo3DMaterial;
  readonly sideMaterial?: Demo3DMaterial;
}

function createInjectorBeltConveyorObject(
  visual: Demo3DVisual,
  state: RendererState
): Three.Mesh | undefined {
  const belt = readProceduralInjectorBelt(visual);
  if (!belt) {
    return undefined;
  }

  const geometry = getProceduralInjectorBeltGeometry(belt, state);
  const object = new state.three.Mesh(geometry, [
    getMaterial(belt.surfaceMaterial, state),
    getMaterial(belt.sideMaterial, state)
  ]);
  object.name = visual.displayName ?? visual.id ?? visual.typeName;
  object.userData.demo3d = {
    kind: "procedural-belt",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    loopHeight: belt.thickness,
    startEdge: belt.startEdge,
    endEdge: belt.endEdge,
    connectorShaped: true
  };
  state.stats.meshes += 1;
  state.stats.directVisuals += 1;
  state.stats.proceduralBelts += 1;
  return object;
}

function readProceduralInjectorBelt(visual: Demo3DVisual): ProceduralInjectorBelt | undefined {
  const properties = visual.properties;
  if (!properties || isFalse(properties.textOf("CenterVisible"))) {
    return undefined;
  }
  const startEdge = conveyorConnectorEdge(visual, "Start");
  const serializedEndEdge = conveyorConnectorEdge(visual, "End");
  if (!startEdge || !serializedEndEdge) {
    return undefined;
  }

  const sameDirection = pointDistanceSquared(startEdge[0], serializedEndEdge[0]) +
    pointDistanceSquared(startEdge[1], serializedEndEdge[1]);
  const reversedDirection = pointDistanceSquared(startEdge[0], serializedEndEdge[1]) +
    pointDistanceSquared(startEdge[1], serializedEndEdge[0]);
  const endEdge: readonly [Point3, Point3] = sameDirection <= reversedDirection
    ? serializedEndEdge
    : [serializedEndEdge[1], serializedEndEdge[0]];
  const beltDiameter =
    numberChildOptional(properties, "CenterDiameter") ??
    numberChildOptional(properties, "BeltDiameter") ??
    DEFAULT_BELT_DIAMETER;
  const thickness = isTrue(properties.textOf("UseBeltCenterHeight"))
    ? numberChild(properties, "BeltCenterHeight", beltDiameter)
    : beltDiameter;
  if (thickness <= 0) {
    return undefined;
  }

  const surfaceMaterial = firstMaterial(properties.child("SurfaceMaterial") ?? properties);
  const sideMaterial = firstMaterial(properties.child("SurfaceSideMaterial") ?? properties) ?? surfaceMaterial;
  return { startEdge, endEdge, thickness, surfaceMaterial, sideMaterial };
}

function conveyorConnectorEdge(
  visual: Demo3DVisual,
  name: "Start" | "End"
): readonly [Point3, Point3] | undefined {
  const connector = visual.xml.child("CN")?.children.find(
    (candidate) => candidate.xsiType === "e3d:ConveyorConnector" && candidate.textOf("Name") === name
  );
  if (!connector) {
    return undefined;
  }
  const start = pipePoint(connector.textOf("Start"));
  const end = pipePoint(connector.textOf("End"));
  return start && end ? [start, end] : undefined;
}

function pipePoint(value: string | undefined): Point3 | undefined {
  const values = parsePipeNumbers(value);
  if (values.length === 0) {
    return undefined;
  }
  return [values[0] ?? 0, values[1] ?? 0, -(values[2] ?? 0)];
}

function pointDistanceSquared(left: Point3, right: Point3): number {
  return (
    (left[0] - right[0]) ** 2 +
    (left[1] - right[1]) ** 2 +
    (left[2] - right[2]) ** 2
  );
}

function getProceduralInjectorBeltGeometry(
  belt: ProceduralInjectorBelt,
  state: RendererState
): Three.BufferGeometry {
  const key = `injector-belt:${[...belt.startEdge, ...belt.endEdge].map((point) => point.join(",")).join(";")}:${belt.thickness}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  const surfacePositions: number[] = [];
  const sidePositions: number[] = [];
  const top = [belt.startEdge[0], belt.startEdge[1], belt.endEdge[1], belt.endEdge[0]] as const;
  const bottom = top.map(
    (point) => [point[0], point[1] - belt.thickness, point[2]] as Point3
  ) as unknown as readonly [Point3, Point3, Point3, Point3];
  const center: Point3 = [
    top.reduce((sum, point) => sum + point[0], 0) / top.length,
    top.reduce((sum, point) => sum + point[1], 0) / top.length,
    top.reduce((sum, point) => sum + point[2], 0) / top.length
  ];

  appendOrientedQuad(surfacePositions, top[0], top[1], top[2], top[3], [0, 1, 0]);
  appendOrientedQuad(surfacePositions, bottom[0], bottom[3], bottom[2], bottom[1], [0, -1, 0]);
  appendInjectorBeltWall(surfacePositions, top[0], top[1], bottom[1], bottom[0], center);
  appendInjectorBeltWall(sidePositions, top[1], top[2], bottom[2], bottom[1], center);
  appendInjectorBeltWall(surfacePositions, top[2], top[3], bottom[3], bottom[2], center);
  appendInjectorBeltWall(sidePositions, top[3], top[0], bottom[0], bottom[3], center);

  const geometry = new state.three.BufferGeometry();
  geometry.setAttribute(
    "position",
    new state.three.Float32BufferAttribute([...surfacePositions, ...sidePositions], 3)
  );
  geometry.addGroup(0, surfacePositions.length / 3, 0);
  geometry.addGroup(surfacePositions.length / 3, sidePositions.length / 3, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function appendInjectorBeltWall(
  target: number[],
  topA: Point3,
  topB: Point3,
  bottomB: Point3,
  bottomA: Point3,
  center: Point3
): void {
  const middleX = (topA[0] + topB[0]) / 2;
  const middleZ = (topA[2] + topB[2]) / 2;
  let normalX = topB[2] - topA[2];
  let normalZ = -(topB[0] - topA[0]);
  if ((middleX - center[0]) * normalX + (middleZ - center[2]) * normalZ < 0) {
    normalX = -normalX;
    normalZ = -normalZ;
  }
  appendOrientedQuad(target, topA, topB, bottomB, bottomA, [normalX, 0, normalZ]);
}

type BeltCap = "Box" | "Cylinder";

interface ProceduralBelt {
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly endRadius: number;
  readonly xOffset: number;
  readonly zOffset: number;
  readonly startCap: BeltCap;
  readonly endCap: BeltCap;
  readonly centerProfile?: Demo3DExtrusionProfile;
  readonly surfaceMaterial?: Demo3DMaterial;
  readonly sideMaterial?: Demo3DMaterial;
}

function readProceduralBelt(visual: Demo3DVisual, state: RendererState): ProceduralBelt | undefined {
  const properties = visual.properties;
  if (!properties || isFalse(properties.textOf("CenterVisible"))) {
    return undefined;
  }

  const centerProfileElement = properties.child("CenterProfile");
  const centerProfile = centerProfileElement && centerProfileElement.children.length > 0
    ? new Demo3DExtrusionProfile(centerProfileElement)
    : undefined;

  const startPadding = numberChild(properties, "StartPadding", 0);
  const endPadding = numberChild(properties, "EndPadding", 0);
  const leftPadding = numberChild(properties, "LeftPadding", 0);
  const rightPadding = numberChild(properties, "RightPadding", 0);
  const serializedLength = numberChildOptional(properties, "Length");
  const beltLength =
    numberChildOptional(properties, "BeltLength") ??
    (serializedLength === undefined ? undefined : serializedLength - startPadding - endPadding);
  const serializedWidth = numberChildOptional(properties, "Width");
  const beltWidth = numberChildOptional(properties, "BeltWidth") ?? serializedWidth ?? DEFAULT_BELT_WIDTH;
  const effectiveLength = beltLength ?? 0;
  const effectiveWidth = beltWidth - leftPadding - rightPadding;
  const centerDiameter =
    numberChildOptional(properties, "CenterDiameter") ??
    numberChildOptional(properties, "BeltDiameter") ??
    DEFAULT_BELT_DIAMETER;
  const useBeltCenterHeight = isTrue(properties.textOf("UseBeltCenterHeight"));
  const loopHeight = useBeltCenterHeight
    ? numberChild(properties, "BeltCenterHeight", centerDiameter)
    : centerDiameter;
  const endRadius = centerDiameter / 2;

  if (effectiveLength <= 0 || effectiveWidth <= 0 || loopHeight <= 0 || endRadius <= 0) {
    warn(state, {
      code: "DEMO3D_THREE_INVALID_BELT_DIMENSIONS",
      message: `Straight belt conveyor dimensions must be positive (length ${effectiveLength}, width ${effectiveWidth}, height ${loopHeight}).`,
      sourceId: visual.id,
      sourceType: visual.typeName,
      xmlPath: visual.xml.path
    });
    return undefined;
  }

  const startCap = beltCap(properties.textOf("BeltCapStart"), visual, state);
  const endCap = beltCap(properties.textOf("BeltCapEnd"), visual, state);
  const surfaceMaterial = firstMaterial(properties.child("SurfaceMaterial") ?? properties);
  const sideMaterial = firstMaterial(properties.child("SurfaceSideMaterial") ?? properties) ?? surfaceMaterial;
  return {
    length: effectiveLength,
    width: effectiveWidth,
    thickness: loopHeight,
    endRadius,
    xOffset: startPadding,
    zOffset: (rightPadding - leftPadding) / 2,
    startCap,
    endCap,
    centerProfile,
    surfaceMaterial,
    sideMaterial
  };
}

function beltCap(value: string | undefined, visual: Demo3DVisual, state: RendererState): BeltCap {
  if (!value || value === "Box") {
    return "Box";
  }
  if (value === "Cylinder") {
    return "Cylinder";
  }

  warn(state, {
    code: "DEMO3D_THREE_UNSUPPORTED_BELT_CAP",
    message: `Belt cap ${value} is not supported; using Box geometry.`,
    sourceId: visual.id,
    sourceType: visual.typeName,
    xmlPath: visual.xml.path
  });
  return "Box";
}

function getProceduralBeltGeometry(belt: ProceduralBelt, state: RendererState): Three.BufferGeometry {
  const profileKey = belt.centerProfile?.polygons
    .map((polygon) => polygon.points.map((point) => `${point.x},${point.y}`).join(";"))
    .join("/") ?? "";
  const key = `belt:${belt.length}:${belt.width}:${belt.thickness}:${belt.endRadius}:${belt.xOffset}:${belt.zOffset}:${belt.startCap}:${belt.endCap}:${profileKey}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  const profilePolygon = belt.centerProfile?.polygons.find((polygon) => polygon.points.length >= 3);
  const geometry = belt.centerProfile && profilePolygon
    ? createProfileBeltGeometry(belt, belt.centerProfile, profilePolygon, state)
    : belt.startCap === "Box" && belt.endCap === "Box"
      ? createRectangularBeltGeometry(belt, state)
      : createRoundedBeltGeometry(belt, state);
  if (!profilePolygon) {
    convertTriangleGeometryToThreeCoordinates(geometry);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function createProfileBeltGeometry(
  belt: ProceduralBelt,
  profile: Demo3DExtrusionProfile,
  polygon: Demo3DExtrusionPolygon,
  state: RendererState
): Three.BufferGeometry {
  const shape = new state.three.Shape();
  polygon.points.forEach((point, index) => {
    const lateral = -(point.x - profile.anchor.x);
    const vertical = point.y - profile.anchor.y;
    if (index === 0) {
      shape.moveTo(lateral, vertical);
    } else {
      shape.lineTo(lateral, vertical);
    }
  });
  shape.closePath();
  const geometry = new state.three.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    curveSegments: 1,
    depth: belt.length,
    steps: 1
  });
  geometry.rotateY(Math.PI / 2);
  geometry.translate(belt.xOffset, 0, belt.zOffset);
  for (const group of geometry.groups) {
    group.materialIndex = group.materialIndex === 0 ? 1 : 0;
  }
  return geometry;
}

interface ProceduralCurveBelt {
  readonly innerRadius: number;
  readonly width: number;
  readonly thickness: number;
  readonly angle: number;
  readonly stepAngle: number;
  readonly surfaceMaterial?: Demo3DMaterial;
  readonly sideMaterial?: Demo3DMaterial;
}

function createCurveBeltConveyorObject(
  visual: Demo3DVisual,
  state: RendererState
): Three.Mesh | undefined {
  const belt = readProceduralCurveBelt(visual, state);
  if (!belt) {
    return undefined;
  }

  const geometry = getProceduralCurveBeltGeometry(belt, state);
  const object = new state.three.Mesh(geometry, [
    getMaterial(belt.surfaceMaterial, state),
    getMaterial(belt.sideMaterial, state)
  ]);
  object.name = visual.displayName ?? visual.id ?? visual.typeName;
  object.userData.demo3d = {
    kind: "procedural-belt",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    innerRadius: belt.innerRadius,
    width: belt.width,
    loopHeight: belt.thickness,
    angle: belt.angle
  };
  state.stats.meshes += 1;
  state.stats.directVisuals += 1;
  state.stats.proceduralBelts += 1;
  return object;
}

function readProceduralCurveBelt(
  visual: Demo3DVisual,
  state: RendererState
): ProceduralCurveBelt | undefined {
  const properties = visual.properties;
  if (!properties || isFalse(properties.textOf("CenterVisible"))) {
    return undefined;
  }

  const centerProfile = properties.child("CenterProfile");
  if (centerProfile && (centerProfile.children.length > 0 || centerProfile.text.length > 0)) {
    warn(state, {
      code: "DEMO3D_THREE_UNSUPPORTED_BELT_PROFILE",
      message: "Curve belt conveyors with a custom CenterProfile are not supported.",
      sourceId: visual.id,
      sourceType: visual.typeName,
      xmlPath: visual.xml.path
    });
    return undefined;
  }

  const innerRadius = numberChild(properties, "InnerRadius", 0.5);
  const width = numberChildOptional(properties, "BeltWidth")
    ?? numberChildOptional(properties, "Width")
    ?? DEFAULT_BELT_WIDTH;
  const beltDiameter =
    numberChildOptional(properties, "CenterDiameter") ??
    numberChildOptional(properties, "BeltDiameter") ??
    DEFAULT_BELT_DIAMETER;
  const thickness = isTrue(properties.textOf("UseBeltCenterHeight"))
    ? numberChild(properties, "BeltCenterHeight", beltDiameter)
    : beltDiameter;
  const angle = degreesToRadians(numberChild(properties, "Angle", 90));
  const stepAngle = Math.abs(degreesToRadians(numberChild(properties, "StepAngle", 15)));

  if (innerRadius <= 0 || width <= 0 || thickness <= 0 || Math.abs(angle) <= 1e-6) {
    warn(state, {
      code: "DEMO3D_THREE_INVALID_BELT_DIMENSIONS",
      message: `Curve belt conveyor dimensions must be positive and its angle non-zero (inner radius ${innerRadius}, width ${width}, height ${thickness}, angle ${numberChild(properties, "Angle", 90)}).`,
      sourceId: visual.id,
      sourceType: visual.typeName,
      xmlPath: visual.xml.path
    });
    return undefined;
  }

  const surfaceMaterial = firstMaterial(properties.child("SurfaceMaterial") ?? properties);
  const sideMaterial = firstMaterial(properties.child("SurfaceSideMaterial") ?? properties) ?? surfaceMaterial;
  return {
    innerRadius,
    width,
    thickness,
    angle,
    stepAngle: stepAngle > 1e-6 ? stepAngle : Math.PI / 12,
    surfaceMaterial,
    sideMaterial
  };
}

function getProceduralCurveBeltGeometry(
  belt: ProceduralCurveBelt,
  state: RendererState
): Three.BufferGeometry {
  const key = `curve-belt:${belt.innerRadius}:${belt.width}:${belt.thickness}:${belt.angle}:${belt.stepAngle}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  const surfacePositions: number[] = [];
  const sidePositions: number[] = [];
  const outerRadius = belt.innerRadius + belt.width;
  const segments = Math.max(4, Math.ceil(Math.abs(belt.angle) / belt.stepAngle));
  const point = (radius: number, y: number, theta: number): Point3 => [
    radius * Math.cos(theta),
    y,
    radius * Math.sin(theta)
  ];
  for (let segment = 0; segment < segments; segment += 1) {
    const theta0 = belt.angle * (segment / segments);
    const theta1 = belt.angle * ((segment + 1) / segments);
    const middle = (theta0 + theta1) / 2;
    const innerTop0 = point(belt.innerRadius, 0, theta0);
    const innerTop1 = point(belt.innerRadius, 0, theta1);
    const outerTop0 = point(outerRadius, 0, theta0);
    const outerTop1 = point(outerRadius, 0, theta1);
    const innerBottom0 = point(belt.innerRadius, -belt.thickness, theta0);
    const innerBottom1 = point(belt.innerRadius, -belt.thickness, theta1);
    const outerBottom0 = point(outerRadius, -belt.thickness, theta0);
    const outerBottom1 = point(outerRadius, -belt.thickness, theta1);

    appendOrientedQuad(surfacePositions, innerTop0, outerTop0, outerTop1, innerTop1, [0, 1, 0]);
    appendOrientedQuad(surfacePositions, innerBottom0, innerBottom1, outerBottom1, outerBottom0, [0, -1, 0]);
    appendOrientedQuad(
      sidePositions,
      outerBottom0,
      outerBottom1,
      outerTop1,
      outerTop0,
      [Math.cos(middle), 0, Math.sin(middle)]
    );
    appendOrientedQuad(
      sidePositions,
      innerBottom0,
      innerTop0,
      innerTop1,
      innerBottom1,
      [-Math.cos(middle), 0, -Math.sin(middle)]
    );
  }

  const direction = Math.sign(belt.angle) || 1;
  const start = 0;
  const end = belt.angle;
  appendOrientedQuad(
    surfacePositions,
    point(belt.innerRadius, -belt.thickness, start),
    point(outerRadius, -belt.thickness, start),
    point(outerRadius, 0, start),
    point(belt.innerRadius, 0, start),
    [direction * Math.sin(start), 0, -direction * Math.cos(start)]
  );
  appendOrientedQuad(
    surfacePositions,
    point(belt.innerRadius, -belt.thickness, end),
    point(belt.innerRadius, 0, end),
    point(outerRadius, 0, end),
    point(outerRadius, -belt.thickness, end),
    [-direction * Math.sin(end), 0, direction * Math.cos(end)]
  );

  const geometry = new state.three.BufferGeometry();
  geometry.setAttribute(
    "position",
    new state.three.Float32BufferAttribute([...surfacePositions, ...sidePositions], 3)
  );
  geometry.addGroup(0, surfacePositions.length / 3, 0);
  geometry.addGroup(surfacePositions.length / 3, sidePositions.length / 3, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function createRectangularBeltGeometry(belt: ProceduralBelt, state: RendererState): Three.BoxGeometry {
  const geometry = new state.three.BoxGeometry(belt.length, belt.thickness, belt.width);
  geometry.translate(
    belt.xOffset + belt.length / 2,
    -belt.thickness / 2,
    belt.zOffset
  );

  // BoxGeometry emits +/-Z last; those two width-facing ends use the side material.
  geometry.groups.forEach((group, index) => {
    group.materialIndex = index >= 4 ? 1 : 0;
  });
  return geometry;
}

function createRoundedBeltGeometry(belt: ProceduralBelt, state: RendererState): Three.ExtrudeGeometry {
  const capRadius = Math.min(belt.endRadius, belt.thickness / 2, belt.length / 2);
  const startIsCylinder = belt.startCap === "Cylinder";
  const endIsCylinder = belt.endCap === "Cylinder";
  const shape = new state.three.Shape();
  shape.moveTo(startIsCylinder ? capRadius : 0, 0);
  shape.lineTo(endIsCylinder ? belt.length - capRadius : belt.length, 0);
  if (endIsCylinder) {
    shape.absarc(belt.length - capRadius, -capRadius, capRadius, Math.PI / 2, -Math.PI / 2, true);
    shape.lineTo(belt.length - capRadius, -belt.thickness);
  } else {
    shape.lineTo(belt.length, -belt.thickness);
  }
  shape.lineTo(startIsCylinder ? capRadius : 0, -belt.thickness);
  if (startIsCylinder) {
    shape.lineTo(capRadius, -2 * capRadius);
    shape.absarc(capRadius, -capRadius, capRadius, -Math.PI / 2, Math.PI / 2, true);
  } else {
    shape.lineTo(0, 0);
  }

  const geometry = new state.three.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    curveSegments: 8,
    depth: belt.width,
    steps: 1
  });
  geometry.translate(belt.xOffset, 0, -belt.width / 2 + belt.zOffset);

  // Extrusion caps are width-facing and use the second material.
  for (const group of geometry.groups) {
    group.materialIndex = group.materialIndex === 0 ? 1 : 0;
  }
  return geometry;
}

function createRackObject(visual: Demo3DVisual, state: RendererState): Three.Group | undefined {
  const properties = visual.properties;
  if (!properties) {
    return undefined;
  }

  const frameHeight = numberChild(properties, "FrameHeight", 0);
  const uprightWidth = numberChild(properties, "UprightWidth", 0.05);
  const serializedUprightDepth = numberChild(properties, "UprightDepth", 0.05);
  const uprightDepth = serializedUprightDepth > 0 ? serializedUprightDepth : uprightWidth;
  const frameDepth = numberChildOptional(properties, "FrameDepth") ?? numberChild(properties, "BayDepth", 0);
  const strutWidth = numberChild(properties, "StrutWidth", 0.05);
  if (frameHeight <= 0 || frameDepth <= 0 || uprightWidth <= 0 || uprightDepth <= 0 || strutWidth <= 0) {
    warn(state, {
      code: "DEMO3D_THREE_INVALID_RACK_DIMENSIONS",
      message: `Rack dimensions must be positive (height ${frameHeight}, depth ${frameDepth}, upright ${uprightWidth} x ${uprightDepth}, strut ${strutWidth}).`,
      sourceId: visual.id,
      sourceType: visual.typeName,
      xmlPath: visual.xml.path
    });
    return undefined;
  }

  const numBays = Math.max(1, Math.round(numberChild(properties, "NumBays", 1)));
  const bayWidth = Math.max(0, numberChild(properties, "BayWidth", 0));
  const framePitch = bayWidth + uprightWidth + Math.max(0, numberChild(properties, "MinFrameGap", 0));
  const framePositions = [0];
  if (!isFalse(properties.child("MiddleFrames")?.textOf("Visible"))) {
    for (let bay = 1; bay < numBays; bay += 1) {
      framePositions.push(bay * framePitch);
    }
  }
  if (!isFalse(properties.child("LastFrame")?.textOf("Visible")) && framePitch > 0) {
    framePositions.push(numBays * framePitch);
  }

  const initialStrutHeight = clamp(numberChild(properties, "InitialStrutHeight", strutWidth / 2), 0, frameHeight);
  const strutSpanHeight = numberChild(properties, "StrutSpanHeight", frameHeight);
  const strutHeights = [initialStrutHeight];
  if (strutSpanHeight > 0) {
    for (
      let height = initialStrutHeight + strutSpanHeight;
      height < frameHeight - 1e-6;
      height += strutSpanHeight
    ) {
      strutHeights.push(height);
    }
  }
  const extensionHeight = clamp(
    frameHeight - Math.max(0, numberChild(properties, "ExtensionStrutOffset", strutWidth / 2)),
    0,
    frameHeight
  );
  if (!strutHeights.some((height) => Math.abs(height - extensionHeight) < 1e-6)) {
    strutHeights.push(extensionHeight);
  }
  strutHeights.sort((left, right) => left - right);

  const uprightMaterial = getColorMaterial(
    demo3dColorValue(properties.child("UprightColor"), 0xffd3d3d3 | 0),
    state
  );
  const strutMaterial = getColorMaterial(
    demo3dColorValue(properties.child("StrutColor"), 0xffd3d3d3 | 0),
    state
  );
  const uprightGeometry = cachedBoxGeometry(uprightWidth, frameHeight, uprightDepth, state);
  const strutGeometry = cachedBoxGeometry(strutWidth, strutWidth, frameDepth, state);
  const group = new state.three.Group();
  group.name = `${visual.displayName ?? visual.id ?? "Rack"} generated geometry`;

  for (const frameX of framePositions) {
    for (const z of [-frameDepth / 2, frameDepth / 2]) {
      const upright = new state.three.Mesh(uprightGeometry, uprightMaterial);
      upright.name = "Rack upright";
      upright.position.set(frameX, frameHeight / 2, z);
      upright.userData.demo3d = { kind: "procedural-rack-upright", frameX };
      group.add(upright);
      state.stats.meshes += 1;
    }
    for (const height of strutHeights) {
      const strut = new state.three.Mesh(strutGeometry, strutMaterial);
      strut.name = "Rack strut";
      strut.position.set(frameX, height, 0);
      strut.userData.demo3d = { kind: "procedural-rack-strut", frameX, height };
      group.add(strut);
      state.stats.meshes += 1;
    }
  }

  group.userData.demo3d = {
    kind: "procedural-rack",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    frameHeight,
    frameDepth,
    framePositions,
    strutHeights
  };
  state.stats.groups += 1;
  state.stats.directVisuals += 1;
  state.stats.proceduralRacks += 1;
  return group;
}

function demo3dColorValue(container: Demo3DXmlElement | undefined, fallback: number): number {
  const numeric = container?.text.trim();
  if (numeric) {
    const parsed = Number(numeric);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  switch (container?.textOf("name")?.trim().toLowerCase()) {
    case "black":
      return 0xff000000 | 0;
    case "darkgray":
    case "darkgrey":
      return 0xffa9a9a9 | 0;
    case "gray":
    case "grey":
      return 0xff808080 | 0;
    case "lightgray":
    case "lightgrey":
      return 0xffd3d3d3 | 0;
    case "white":
      return 0xffffffff | 0;
    default:
      return fallback;
  }
}

function createSupportStandObject(
  visual: Demo3DVisual,
  parentVisual: Demo3DVisual | undefined,
  state: RendererState
): Three.Group | undefined {
  const stand = visual instanceof Demo3DSupportStand
    ? visual
    : new Demo3DSupportStand(visual.typeName, visual.xml);
  const properties = stand.supportProperties;
  const legProfile = properties?.legProfile;
  const footProfile = properties?.footProfile;
  const floorPlateProfile = properties?.floorPlateProfile;
  const crossBraceProfile = properties?.crossBraceProfile;
  if (!properties) {
    return undefined;
  }
  if (!legProfile && !crossBraceProfile) {
    return createDefaultSupportStandObject(visual, parentVisual, properties, state);
  }
  if (!legProfile || !crossBraceProfile) {
    warn(state, {
      code: "DEMO3D_THREE_UNSUPPORTED_SUPPORT_STAND_PROFILE",
      message: "Support stand is missing its leg or cross-brace extrusion profile.",
      sourceId: visual.id,
      sourceType: visual.typeName,
      xmlPath: visual.xml.path
    });
    return undefined;
  }

  const braces = [...properties.crossBraceHeights]
    .filter((height) => height > 0)
    .sort((left, right) => left - right);
  const explicitHeight =
    numberChildOptional(visual.properties, "SupportHeight") ??
    numberChildOptional(visual.properties, "Height") ??
    numberChildOptional(visual.properties, "FloorHeight");
  const finalSpacing = braces.length > 1
    ? braces[braces.length - 1] - braces[braces.length - 2]
    : braces[0];
  const supportHeight = explicitHeight ?? (
    braces.length > 0
      ? braces[braces.length - 1] + Math.max(finalSpacing ?? 0, 0.05)
      : 1
  );
  const parentWidth =
    numberChildOptional(parentVisual?.properties, "RollerWidth") ??
    numberChildOptional(parentVisual?.properties, "BeltWidth") ??
    numberChildOptional(parentVisual?.properties, "Width") ??
    0.5;
  const conveyorOffset = properties.conveyorOffset;
  const sideExtension = Math.abs(conveyorOffset[2] ?? 0);
  const span = Math.max(parentWidth + sideExtension * 2, 0.1);
  const top = conveyorOffset[1] ?? 0;
  const x = conveyorOffset[0] ?? 0;
  const bottom = top - supportHeight;
  const floorPlateHeight = clamp(properties.floorPlateHeight, 0, supportHeight);
  const footHeight = clamp(properties.footHeight, 0, supportHeight - floorPlateHeight);
  const legHeight = Math.max(supportHeight - floorPlateHeight - footHeight, 0.001);
  const group = new state.three.Group();
  group.name = `${visual.displayName ?? visual.id ?? "Support stand"} geometry`;

  for (const z of [-span / 2, span / 2]) {
    addSupportProfileMeshes(
      group,
      legProfile,
      "vertical",
      legHeight,
      [x, top, z],
      properties.legMaterial,
      "leg",
      state
    );
    if (footProfile && footHeight > 0) {
      addSupportProfileMeshes(
        group,
        footProfile,
        "vertical",
        footHeight,
        [x, bottom + floorPlateHeight + footHeight, z],
        properties.footMaterial,
        "foot",
        state
      );
    }
    if (floorPlateProfile && floorPlateHeight > 0) {
      addSupportProfileMeshes(
        group,
        floorPlateProfile,
        "vertical",
        floorPlateHeight,
        [x, bottom + floorPlateHeight, z],
        properties.floorPlateMaterial,
        "floor plate",
        state
      );
    }
  }

  const braceHeights = [...braces, supportHeight];
  for (const height of braceHeights) {
    addSupportProfileMeshes(
      group,
      crossBraceProfile,
      "horizontal",
      span,
      [x, bottom + height, 0],
      properties.crossBraceMaterial,
      height === supportHeight ? "top brace" : "cross brace",
      state
    );
  }

  if (group.children.length === 0) {
    return undefined;
  }
  group.userData.demo3d = {
    kind: "procedural-support-stand",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    supportHeight,
    span,
    braceHeights: braces
  };
  state.stats.groups += 1;
  state.stats.directVisuals += 1;
  state.stats.proceduralSupportStands += 1;
  return group;
}

const DEFAULT_CONVEYOR_HEIGHT = 0.83;
const DEFAULT_SUPPORT_LEG_SIZE = 0.04;
const DEFAULT_SUPPORT_FOOT_SIZE = 0.06;
const DEFAULT_SUPPORT_FLOOR_PLATE_SIZE = 0.1;

function createDefaultSupportStandObject(
  visual: Demo3DVisual,
  parentVisual: Demo3DVisual | undefined,
  properties: NonNullable<Demo3DSupportStand["supportProperties"]>,
  state: RendererState
): Three.Group | undefined {
  const parentWidth =
    numberChildOptional(parentVisual?.properties, "RollerWidth") ??
    numberChildOptional(parentVisual?.properties, "BeltWidth") ??
    numberChildOptional(parentVisual?.properties, "Width") ??
    DEFAULT_BELT_WIDTH;
  const conveyorOffset = properties.conveyorOffset;
  const sideExtension = Math.abs(conveyorOffset[2] ?? 0);
  const span = Math.max(parentWidth + sideExtension * 2, 0.1);
  const top = conveyorOffset[1] ?? 0;
  const x = conveyorOffset[0] ?? 0;
  const floorY = numberChild(properties.xml, "FloorY", 0);
  const explicitStandHeight =
    numberChildOptional(properties.xml, "StandHeight") ??
    numberChildOptional(properties.xml, "SupportHeight") ??
    numberChildOptional(properties.xml, "Height");
  const explicitLegHeight = numberChildOptional(properties.xml, "LegHeight");
  const conveyorHeight = numberChildOptional(parentVisual?.properties, "ConveyorHeight") ?? DEFAULT_CONVEYOR_HEIGHT;
  const componentHeight = explicitLegHeight === undefined
    ? undefined
    : explicitLegHeight + properties.footHeight + properties.floorPlateHeight;
  const supportHeight = Math.max(
    explicitStandHeight ?? componentHeight ?? conveyorHeight + top - floorY,
    properties.footHeight + properties.floorPlateHeight + 0.001
  );
  const bottom = top - supportHeight;
  const floorPlateHeight = clamp(properties.floorPlateHeight, 0, supportHeight);
  const footHeight = clamp(properties.footHeight, 0, supportHeight - floorPlateHeight);
  const legHeight = Math.max(supportHeight - floorPlateHeight - footHeight, 0.001);
  const braces = [...properties.crossBraceHeights]
    .filter((height) => height > 0 && height < supportHeight)
    .sort((left, right) => left - right);
  const group = new state.three.Group();
  group.name = `${visual.displayName ?? visual.id ?? "Support stand"} default geometry`;
  const legMaterial = supportComponentMaterial(visual.properties?.child("LegMaterial"), properties.legMaterial, state);
  const footMaterial = supportComponentMaterial(visual.properties?.child("FootMaterial"), properties.footMaterial, state);
  const floorPlateMaterial = supportComponentMaterial(
    visual.properties?.child("FloorPlateMaterial"),
    properties.floorPlateMaterial,
    state
  );
  const braceMaterial = supportComponentMaterial(
    visual.properties?.child("CrossBraceMaterial"),
    properties.crossBraceMaterial,
    state
  );

  for (const z of [-span / 2, span / 2]) {
    addDefaultSupportBox(
      group,
      "leg",
      DEFAULT_SUPPORT_LEG_SIZE,
      legHeight,
      DEFAULT_SUPPORT_LEG_SIZE,
      [x, top - legHeight / 2, z],
      legMaterial,
      state
    );
    if (footHeight > 0) {
      addDefaultSupportBox(
        group,
        "foot",
        DEFAULT_SUPPORT_FOOT_SIZE,
        footHeight,
        DEFAULT_SUPPORT_FOOT_SIZE,
        [x, bottom + floorPlateHeight + footHeight / 2, z],
        footMaterial,
        state
      );
    }
    if (floorPlateHeight > 0) {
      addDefaultSupportBox(
        group,
        "floor plate",
        DEFAULT_SUPPORT_FLOOR_PLATE_SIZE,
        floorPlateHeight,
        DEFAULT_SUPPORT_FLOOR_PLATE_SIZE,
        [x, bottom + floorPlateHeight / 2, z],
        floorPlateMaterial,
        state
      );
    }
  }

  for (const height of braces) {
    addDefaultSupportBox(
      group,
      "cross brace",
      DEFAULT_SUPPORT_LEG_SIZE,
      DEFAULT_SUPPORT_LEG_SIZE,
      span,
      [x, bottom + height, 0],
      braceMaterial,
      state
    );
  }
  addDefaultSupportBox(
    group,
    "top brace",
    DEFAULT_SUPPORT_LEG_SIZE,
    DEFAULT_SUPPORT_LEG_SIZE,
    span,
    [x, top - DEFAULT_SUPPORT_LEG_SIZE / 2, 0],
    braceMaterial,
    state
  );

  group.userData.demo3d = {
    kind: "procedural-support-stand",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    supportHeight,
    span,
    braceHeights: braces,
    approximate: true,
    defaultProfiles: true
  };
  state.stats.groups += 1;
  state.stats.directVisuals += 1;
  state.stats.proceduralSupportStands += 1;
  return group;
}

function supportComponentMaterial(
  container: Demo3DXmlElement | undefined,
  fallbackColor: number | undefined,
  state: RendererState
): Three.Material {
  return materialFromContainer(container, state) ?? getColorMaterial(fallbackColor, state);
}

function addDefaultSupportBox(
  group: Three.Group,
  component: string,
  width: number,
  height: number,
  depth: number,
  position: readonly [number, number, number],
  material: Three.Material,
  state: RendererState
): void {
  const mesh = new state.three.Mesh(cachedBoxGeometry(width, height, depth, state), material);
  mesh.name = `Default support ${component}`;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.userData.demo3d = { kind: "support-stand-component", component, approximate: true };
  group.add(mesh);
  state.stats.meshes += 1;
}

type SupportProfileAxis = "vertical" | "horizontal";

function addSupportProfileMeshes(
  group: Three.Group,
  profile: Demo3DExtrusionProfile,
  axis: SupportProfileAxis,
  length: number,
  position: readonly [number, number, number],
  fallbackColor: number | undefined,
  component: string,
  state: RendererState
): void {
  profile.polygons.forEach((polygon, index) => {
    if (polygon.points.length < 3) {
      return;
    }
    const geometry = getSupportProfileGeometry(profile, polygon, axis, length, state);
    const material = polygon.materials[0]
      ? getMaterial(polygon.materials[0], state)
      : getColorMaterial(fallbackColor, state);
    const mesh = new state.three.Mesh(geometry, material);
    mesh.name = `${profile.name || component} ${index + 1}`;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.userData.demo3d = { kind: "support-stand-component", component };
    group.add(mesh);
    state.stats.meshes += 1;
  });
}

function getSupportProfileGeometry(
  profile: Demo3DExtrusionProfile,
  polygon: Demo3DExtrusionPolygon,
  axis: SupportProfileAxis,
  length: number,
  state: RendererState
): Three.BufferGeometry {
  const pointsKey = polygon.points.map((point) => `${point.x},${point.y}`).join(";");
  const key = `support:${axis}:${length}:${profile.anchor.x},${profile.anchor.y}:${pointsKey}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  const shape = new state.three.Shape();
  polygon.points.forEach((point, index) => {
    const x = point.x - profile.anchor.x;
    const y = axis === "vertical"
      ? -(point.y - profile.anchor.y)
      : point.y - profile.anchor.y;
    if (index === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  });
  shape.closePath();
  const geometry = new state.three.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    curveSegments: 1,
    depth: length,
    steps: 1
  });
  if (axis === "vertical") {
    geometry.rotateX(Math.PI / 2);
  } else {
    geometry.translate(0, 0, -length / 2);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function createPhotoEyeObject(
  visual: Demo3DVisual,
  parentVisual: Demo3DVisual | undefined,
  state: RendererState
): Three.Group | undefined {
  const photoEye = visual instanceof Demo3DPhotoEye
    ? visual
    : new Demo3DPhotoEye(visual.typeName, visual.xml);
  const properties = photoEye.photoEyeProperties;
  if (!properties) {
    return undefined;
  }
  const parentWidth =
    numberChildOptional(parentVisual?.properties, "RollerWidth") ??
    numberChildOptional(parentVisual?.properties, "BeltWidth") ??
    numberChildOptional(parentVisual?.properties, "Width") ??
    0.5;
  const sensorAspect = findVisualAspects(visual, state)
    .find((aspect) => aspect.xsiType === "e3d:SensorSymbolAspect");
  const symbolSide = sensorAspect?.textOf("SymbolSide")?.toLowerCase() ?? "right";
  const side = symbolSide.includes("left") ? -1 : 1;
  const beamThickness = Math.max(parentWidth / 150, 0.003);
  const bodySize = Math.max(parentWidth / 16, 0.025);
  const group = new state.three.Group();
  group.name = `${visual.displayName ?? visual.id ?? "Photo eye"} geometry`;

  const beamGeometry = cachedBoxGeometry(beamThickness, beamThickness, parentWidth, state);
  const beam = new state.three.Mesh(beamGeometry, getColorMaterial(properties.clearedMaterial, state));
  beam.name = "Photo eye beam";
  beam.position.y = properties.beamHeight;
  beam.rotation.x = degreesToRadians(properties.beamAngle);
  beam.userData.demo3d = { kind: "photo-eye-beam" };
  group.add(beam);

  const bodyGeometry = cachedBoxGeometry(bodySize, bodySize, bodySize * 0.75, state);
  const body = new state.three.Mesh(bodyGeometry, getColorMaterial(properties.boxMaterial, state));
  body.name = "Photo eye body";
  body.position.set(0, properties.beamHeight, side * (parentWidth / 2 + bodySize * 0.4));
  body.userData.demo3d = { kind: "photo-eye-body", symbolSide };
  group.add(body);

  group.userData.demo3d = {
    kind: "procedural-photo-eye",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path,
    beamHeight: properties.beamHeight,
    symbolSide
  };
  state.stats.groups += 1;
  state.stats.meshes += 2;
  state.stats.directVisuals += 1;
  state.stats.proceduralPhotoEyes += 1;
  return group;
}

function createProceduralRollerConveyorObject(
  visual: Demo3DVisual,
  state: RendererState
): Three.Group | undefined {
  if (
    state.options.renderProceduralConveyorSides !== true &&
    state.options.renderProceduralRollers !== true &&
    state.options.renderProceduralMotors !== true
  ) {
    return undefined;
  }
  const properties = visual.properties;
  if (!properties) {
    return undefined;
  }
  const group = new state.three.Group();
  group.name = `${visual.displayName ?? visual.id ?? "Roller conveyor"} generated geometry`;

  if (state.options.renderProceduralConveyorSides === true) {
    addConveyorSide(group, visual, properties.child("LeftSide"), "left", state);
    addConveyorSide(group, visual, properties.child("RightSide"), "right", state);
  }
  if (
    state.options.renderProceduralRollers === true &&
    !hasSerializedRollerGeometry(visual, state)
  ) {
    addProceduralRollers(group, visual, state);
  }
  if (
    state.options.renderProceduralMotors === true &&
    properties.child("MotorVisual") &&
    !hasRenderableMotorChild(visual, state)
  ) {
    addProceduralMotor(group, visual, state);
  }

  if (group.children.length === 0) {
    return undefined;
  }
  group.userData.demo3d = {
    kind: "procedural-roller-conveyor",
    id: visual.id,
    name: visual.displayName,
    typeName: visual.typeName,
    xmlPath: visual.xml.path
  };
  state.stats.groups += 1;
  state.stats.directVisuals += 1;
  return group;
}

type ConveyorSideName = "left" | "right";

function addConveyorSide(
  group: Three.Group,
  visual: Demo3DVisual,
  sideXml: Demo3DXmlElement | undefined,
  sideName: ConveyorSideName,
  state: RendererState
): void {
  if (!sideXml) {
    return;
  }
  const side = new Demo3DConveyorSideProperties(
    sideXml.xsiType ?? "e3d:ConveyorSideProperties",
    sideXml
  );
  const profile = side.profile;
  if (!side.visible || !profile) {
    return;
  }
  const frames = conveyorSideFrames(visual, sideName);
  if (frames.length < 2) {
    return;
  }
  profile.polygons.forEach((polygon, index) => {
    if (polygon.points.length < 3) {
      return;
    }
    const geometry = getSweptProfileGeometry(profile, polygon, frames, state);
    const materials = polygon.materials.length > 0
      ? polygon.materials.map((material) => getMaterial(material, state))
      : [side.material ? getMaterial(side.material, state) : state.defaultMaterial];
    const mesh = new state.three.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.name = `${sideName} conveyor side ${index + 1}`;
    mesh.userData.demo3d = { kind: "procedural-conveyor-side", side: sideName };
    group.add(mesh);
    state.stats.meshes += 1;
    state.stats.proceduralConveyorSides += 1;
  });
}

interface SweepFrame {
  readonly center: readonly [number, number, number];
  readonly lateral: readonly [number, number, number];
}

function conveyorSideFrames(visual: Demo3DVisual, side: ConveyorSideName): SweepFrame[] {
  const properties = visual.properties;
  if (!properties) {
    return [];
  }
  const width =
    numberChildOptional(properties, "RollerWidth") ??
    numberChildOptional(properties, "Width") ??
    0.5;
  if (visual.typeName === "e3d:CurveRollerConveyor") {
    const innerRadius = numberChild(properties, "InnerRadius", 0.5);
    const angle = degreesToRadians(numberChild(properties, "Angle", 90));
    const segments = Math.max(4, Math.ceil(Math.abs(angle) / (Math.PI / 24)));
    const pathRadius = side === "left" ? innerRadius : innerRadius + width;
    const frames: SweepFrame[] = [];
    for (let index = 0; index <= segments; index += 1) {
      const theta = angle * (1 - index / segments);
      frames.push({
        center: [
          pathRadius * Math.cos(theta),
          0,
          pathRadius * Math.sin(theta)
        ],
        lateral: [Math.cos(theta), 0, Math.sin(theta)]
      });
    }
    return frames;
  }

  const length = visual.typeName === "e3d:InjectorRollerConveyor"
    ? Math.max(
        numberChild(properties, "ShortSideLength", 0),
        numberChild(properties, "ExtraLength", 0),
        numberChild(properties, "RollerPitch", 0.1)
      )
    : numberChild(properties, "Length", 1);
  const z = (side === "left" ? -1 : 1) * width / 2;
  return [
    { center: [0, 0, z], lateral: [0, 0, 1] },
    { center: [length, 0, z], lateral: [0, 0, 1] }
  ];
}

function getSweptProfileGeometry(
  profile: Demo3DExtrusionProfile,
  polygon: Demo3DExtrusionPolygon,
  frames: readonly SweepFrame[],
  state: RendererState
): Three.BufferGeometry {
  const pointsKey = polygon.points.map((point) => `${point.x},${point.y}`).join(";");
  const framesKey = frames
    .map((frame) => `${frame.center.join(",")}/${frame.lateral.join(",")}`)
    .join(";");
  const key = `sweep:${profile.anchor.x},${profile.anchor.y}:${polygon.materials.length}:${pointsKey}:${framesKey}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const pointCount = polygon.points.length;
  for (const frame of frames) {
    for (const point of polygon.points) {
      const lateral = point.x - profile.anchor.x;
      const vertical = point.y - profile.anchor.y;
      positions.push(
        frame.center[0] + frame.lateral[0] * lateral,
        frame.center[1] + vertical,
        frame.center[2] + frame.lateral[2] * lateral
      );
    }
  }
  const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
  for (let point = 0; point < pointCount; point += 1) {
    const start = indices.length;
    for (let frame = 0; frame < frames.length - 1; frame += 1) {
      const current = frame * pointCount;
      const next = (frame + 1) * pointCount;
      const following = (point + 1) % pointCount;
      indices.push(
        current + point,
        next + point,
        current + following,
        current + following,
        next + point,
        next + following
      );
    }
    groups.push({
      start,
      count: indices.length - start,
      materialIndex: Math.min(point, Math.max(0, polygon.materials.length - 1))
    });
  }
  const shapePoints = polygon.points.map(
    (point) => new state.three.Vector2(point.x - profile.anchor.x, point.y - profile.anchor.y)
  );
  const capTriangles = state.three.ShapeUtils.triangulateShape(shapePoints, []);
  const finalOffset = (frames.length - 1) * pointCount;
  const capStart = indices.length;
  for (const triangle of capTriangles) {
    indices.push(triangle[2], triangle[1], triangle[0]);
    indices.push(finalOffset + triangle[0], finalOffset + triangle[1], finalOffset + triangle[2]);
  }

  const geometry = new state.three.BufferGeometry();
  geometry.setAttribute("position", new state.three.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  for (const group of groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.addGroup(capStart, indices.length - capStart, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function addProceduralRollers(group: Three.Group, visual: Demo3DVisual, state: RendererState): void {
  const properties = visual.properties;
  if (!properties) {
    return;
  }

  const width =
    numberChildOptional(properties, "RollerWidth") ??
    numberChildOptional(properties, "Width") ??
    0.5;
  const diameter = numberChild(properties, "RollerDiameter", 0.05);
  const radius = diameter / 2;
  const material = materialFromContainer(properties.child("SurfaceMaterial") ?? properties, state)
    ?? getColorMaterial(numberChildOptional(properties, "RollerColor"), state);
  const geometry = cachedRollerGeometry(radius, width, state);

  if (visual.typeName === "e3d:DiverterRollerConveyor") {
    const length = numberChild(properties, "Length", 1);
    const pitch = Math.max(numberChild(properties, "RollerPitch", diameter * 1.2), diameter);
    const count = Math.max(1, Math.round(numberChildOptional(properties, "RollerCount") ?? length / pitch));
    const across = Math.max(1, Math.round(numberChild(properties, "NumRollersAcrossWidth", 1)));
    const totalWidth = numberChild(properties, "Width", width);
    for (let index = 0; index < count; index += 1) {
      for (let acrossIndex = 0; acrossIndex < across; acrossIndex += 1) {
        const roller = new state.three.Mesh(geometry, material);
        roller.name = `Generated divert roller ${index + 1}.${acrossIndex + 1}`;
        roller.position.set(
          ((index + 0.5) / count) * length,
          0,
          ((acrossIndex + 0.5) / across - 0.5) * totalWidth
        );
        roller.userData.demo3d = { kind: "procedural-roller", index, acrossIndex };
        group.add(roller);
        state.stats.meshes += 1;
        state.stats.proceduralRollers += 1;
      }
    }
    return;
  }

  if (visual.typeName === "e3d:CurveRollerConveyor") {
    const count = Math.max(1, Math.round(numberChild(properties, "RollerCount", 1)));
    const innerRadius = numberChild(properties, "InnerRadius", 0.5);
    const angle = degreesToRadians(numberChild(properties, "Angle", 90));
    const centerRadius = innerRadius + width / 2;
    for (let index = 0; index < count; index += 1) {
      const theta = count === 1 ? angle / 2 : angle * (1 - index / (count - 1));
      const roller = new state.three.Mesh(geometry, material);
      roller.name = `Generated roller ${index + 1}`;
      roller.position.set(
        centerRadius * Math.cos(theta),
        0,
        centerRadius * Math.sin(theta)
      );
      roller.rotation.y = Math.PI / 2 - theta;
      roller.userData.demo3d = { kind: "procedural-roller", index };
      group.add(roller);
      state.stats.meshes += 1;
      state.stats.proceduralRollers += 1;
    }
    return;
  }

  const length = visual.typeName === "e3d:InjectorRollerConveyor"
    ? Math.max(numberChild(properties, "ShortSideLength", 0), numberChild(properties, "RollerPitch", 0.1))
    : numberChild(properties, "Length", 1);
  const pitch = Math.max(numberChild(properties, "RollerPitch", diameter * 1.2), diameter);
  const explicitCount = numberChildOptional(properties, "RollerCount");
  const count = Math.max(1, Math.round(explicitCount ?? length / pitch));
  for (let index = 0; index < count; index += 1) {
    const roller = new state.three.Mesh(geometry, material);
    roller.name = `Generated roller ${index + 1}`;
    roller.position.x = ((index + 0.5) / count) * length;
    roller.userData.demo3d = { kind: "procedural-roller", index };
    group.add(roller);
    state.stats.meshes += 1;
    state.stats.proceduralRollers += 1;
  }
}

function cachedRollerGeometry(radius: number, width: number, state: RendererState): Three.BufferGeometry {
  const key = `roller:${radius}:${width}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }
  const geometry = new state.three.CylinderGeometry(radius, radius, width, 16);
  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function addProceduralMotor(group: Three.Group, visual: Demo3DVisual, state: RendererState): void {
  const properties = visual.properties;
  if (!properties) {
    return;
  }
  const width =
    numberChildOptional(properties, "RollerWidth") ??
    numberChildOptional(properties, "Width") ??
    0.5;
  const length = numberChildOptional(properties, "Length") ?? 0.2;
  const diameter = numberChild(properties, "RollerDiameter", 0.05);
  const size = Math.max(diameter * 1.6, 0.06);
  const geometry = cachedBoxGeometry(size * 1.4, size, size, state);
  const motor = new state.three.Mesh(geometry, getColorMaterial(0xff303840 | 0, state));
  motor.name = "Generated conveyor motor";
  motor.position.set(length * 0.75, -size / 2, width / 2 + size / 2);
  motor.userData.demo3d = { kind: "procedural-conveyor-motor", approximate: true };
  group.add(motor);
  state.stats.meshes += 1;
  state.stats.proceduralMotors += 1;
}

function hasSerializedRollerGeometry(visual: Demo3DVisual, state: RendererState): boolean {
  const stack = [...visual.children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const displayName = current.displayName?.toLowerCase() ?? "";
    const propertyType = current.properties?.textOf("Type")?.toLowerCase() ?? "";
    const isRoller = propertyType === "displayroller" || /^roller(?:\d+)?$/.test(displayName);
    if (
      isRoller &&
      findVisualAspects(current, state).some((aspect) => aspect.xsiType === "e3d:CylinderRendererAspect")
    ) {
      return true;
    }
    stack.push(...current.children);
  }
  return false;
}

function hasRenderableMotorChild(visual: Demo3DVisual, state: RendererState): boolean {
  return visual.children.some((child) => {
    const name = child.displayName?.toLowerCase() ?? "";
    return (name.includes("motor") || name.includes("transmission")) && findVisualAspects(child, state).length > 0;
  });
}

function materialFromContainer(
  root: Demo3DXmlElement | undefined,
  state?: RendererState
): Three.Material | undefined {
  if (!root || !state) {
    return undefined;
  }
  const material = firstMaterial(root);
  return material ? getMaterial(material, state) : undefined;
}

function cachedBoxGeometry(
  width: number,
  height: number,
  depth: number,
  state: RendererState
): Three.BufferGeometry {
  const key = `box:${width}:${height}:${depth}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }
  const geometry = new state.three.BoxGeometry(width, height, depth);
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function isRollerConveyorType(typeName: string): boolean {
  return (
    typeName === "e3d:StraightRollerConveyor" ||
    typeName === "e3d:CurveRollerConveyor" ||
    typeName === "e3d:DiverterRollerConveyor" ||
    typeName === "e3d:InjectorRollerConveyor"
  );
}

function createImportedImageObject(visual: Demo3DVisual, state: RendererState): Three.Mesh | undefined {
  const properties = visual.properties;
  if (!properties) {
    return undefined;
  }

  const width = numberChild(properties, "WidthScale", 1);
  const height = numberChild(properties, "HeightScale", 1);
  const geometry = new state.three.PlaneGeometry(width, height);
  convertTriangleGeometryToThreeCoordinates(geometry);
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
    properties.textOf("Thickness") ?? "",
    properties.textOf("Width") ?? ""
  ].join("|")}`;
  const cached = state.primitiveGeometryCache.get(key);
  if (cached) {
    return cached;
  }

  let geometry: Three.BufferGeometry | undefined;
  if (visual.typeName === "e3d:BoxVisual") {
    geometry = new state.three.BoxGeometry(
      numberChild(properties, "Width", 1),
      numberChild(properties, "Height", 1),
      numberChild(properties, "Depth", 1)
    );
  } else if (visual.typeName === "e3d:BoxTubeVisual") {
    geometry = createBoxTubeGeometry(
      numberChild(properties, "Width", 0.25),
      numberChild(properties, "Height", 1),
      numberChild(properties, "Depth", 0.25),
      numberChild(properties, "Thickness", 0.015),
      state
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
  } else if (visual.typeName === "e3d:SphereVisual") {
    geometry = new state.three.SphereGeometry(
      numberChild(properties, "Radius", 0.5),
      32,
      16
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

  // BoxGeometry and the box-tube extrusion are already created in Three's
  // coordinate system. Reflecting these symmetric, Three-native geometries
  // swaps their front/back UV layouts even though their bounds do not change.
  // Other direct primitives still need the Demo3D-to-Three Z reflection.
  if (
    visual.typeName !== "e3d:BoxVisual" &&
    visual.typeName !== "e3d:BoxTubeVisual" &&
    visual.typeName !== "e3d:SphereVisual"
  ) {
    convertTriangleGeometryToThreeCoordinates(geometry);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function createBoxTubeGeometry(
  width: number,
  height: number,
  depth: number,
  thickness: number,
  state: RendererState
): Three.BufferGeometry {
  const halfWidth = Math.max(width, 0) / 2;
  const halfDepth = Math.max(depth, 0) / 2;
  const edge = clamp(thickness, 0, Math.min(halfWidth, halfDepth));
  const shape = new state.three.Shape();
  shape.moveTo(-halfWidth, -halfDepth);
  shape.lineTo(-halfWidth, halfDepth);
  shape.lineTo(halfWidth, halfDepth);
  shape.lineTo(halfWidth, -halfDepth);
  shape.closePath();

  const innerHalfWidth = halfWidth - edge;
  const innerHalfDepth = halfDepth - edge;
  if (innerHalfWidth > 0 && innerHalfDepth > 0) {
    const hole = new state.three.Path();
    hole.moveTo(-innerHalfWidth, -innerHalfDepth);
    hole.lineTo(innerHalfWidth, -innerHalfDepth);
    hole.lineTo(innerHalfWidth, innerHalfDepth);
    hole.lineTo(-innerHalfWidth, innerHalfDepth);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new state.three.ExtrudeGeometry(shape, {
    depth: Math.max(height, 0),
    steps: 1,
    bevelEnabled: false
  });
  // ExtrudeGeometry uses Z for its extrusion. Demo3D box tubes extrude along Y.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -Math.max(height, 0) / 2, 0);
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
  geometry.scale(1, 1, -1);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.lineGeometryCache.set(blockId, geometry);
  state.stats.geometries += 1;
  return geometry;
}

type Demo3DMaterialSelection = Demo3DMaterial | readonly Demo3DMaterial[] | undefined;

function createMeshObject(
  meshId: string,
  source: Demo3DVisual | Demo3DXmlElement,
  materialSelection: Demo3DMaterialSelection,
  state: RendererState
): Three.Mesh | undefined {
  const mesh = state.meshById.get(meshId);
  const materials = Array.isArray(materialSelection)
    ? materialSelection as readonly Demo3DMaterial[]
    : materialSelection ? [materialSelection as Demo3DMaterial] : [];
  const primaryMaterial = materials[0];
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
    return state.options.showPlaceholders === true
      ? createPlaceholderMesh(sourceId ?? meshId, meshId, primaryMaterial, state)
      : undefined;
  }

  const geometry = getGeometry(mesh, state);
  if (!geometry) {
    return state.options.showPlaceholders === true
      ? createPlaceholderMesh(sourceId ?? meshId, meshId, primaryMaterial, state)
      : undefined;
  }

  const threeMaterial = materials.length > 1
    ? materials.map((material) => getMaterial(material, state))
    : getMaterial(primaryMaterial, state);
  const object = new state.three.Mesh(geometry, threeMaterial);
  object.name = source instanceof Demo3DVisual ? source.displayName ?? meshId : meshId;
  object.userData.demo3d = {
    kind: "mesh",
    meshId,
    materialSlots: materials.length,
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
    const innerRadius = numberChild(renderable, "InnerRadius", 0);
    const radiusRatio = numberChild(renderable, "RadiusRatio", 1);
    const coneRatio = numberChild(renderable, "ConeRatio", 1);
    const length = numberChild(renderable, "Length", 1);
    const slices = Math.max(3, Math.round(numberChild(renderable, "Slices", 16)));
    const startAngle = degreesToRadians(numberChild(renderable, "StartAngle", 0));
    const angle = degreesToRadians(numberChild(renderable, "Angle", 360));
    geometry = innerRadius > 0 && innerRadius < Math.min(radius * radiusRatio, radius * coneRatio)
      ? createAnnularCylinderGeometry(
          radius * radiusRatio,
          radius * coneRatio,
          innerRadius,
          length,
          slices,
          startAngle,
          angle,
          state
        )
      : new state.three.CylinderGeometry(
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

  if (type !== "e3d:BoxRendererAspect" && type !== "e3d:ContainerRendererAspect") {
    convertTriangleGeometryToThreeCoordinates(geometry);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  state.primitiveGeometryCache.set(key, geometry);
  state.stats.geometries += 1;
  return geometry;
}

function createAnnularCylinderGeometry(
  topRadius: number,
  bottomRadius: number,
  innerRadius: number,
  length: number,
  slices: number,
  startAngle: number,
  angle: number,
  state: RendererState
): Three.BufferGeometry {
  type Point3 = readonly [number, number, number];
  const positions: number[] = [];
  const halfLength = length / 2;
  const fullCircle = Math.abs(angle) >= Math.PI * 2 - 1e-6;
  const segments = Math.max(1, Math.round(slices * Math.abs(angle) / (Math.PI * 2)));
  const point = (radius: number, y: number, theta: number): Point3 => [
    radius * Math.sin(theta),
    y,
    radius * Math.cos(theta)
  ];
  const addTriangle = (a: Point3, b: Point3, c: Point3, normal: Point3): void => {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    const forward = crossX * normal[0] + crossY * normal[1] + crossZ * normal[2] >= 0;
    const second = forward ? b : c;
    const third = forward ? c : b;
    positions.push(...a, ...second, ...third);
  };
  const addQuad = (a: Point3, b: Point3, c: Point3, d: Point3, normal: Point3): void => {
    addTriangle(a, b, c, normal);
    addTriangle(a, c, d, normal);
  };

  for (let segment = 0; segment < segments; segment += 1) {
    const theta0 = startAngle + angle * (segment / segments);
    const theta1 = startAngle + angle * ((segment + 1) / segments);
    const middle = (theta0 + theta1) / 2;
    const outerBottom0 = point(bottomRadius, -halfLength, theta0);
    const outerBottom1 = point(bottomRadius, -halfLength, theta1);
    const outerTop0 = point(topRadius, halfLength, theta0);
    const outerTop1 = point(topRadius, halfLength, theta1);
    const innerBottom0 = point(innerRadius, -halfLength, theta0);
    const innerBottom1 = point(innerRadius, -halfLength, theta1);
    const innerTop0 = point(innerRadius, halfLength, theta0);
    const innerTop1 = point(innerRadius, halfLength, theta1);

    addQuad(
      outerBottom0,
      outerBottom1,
      outerTop1,
      outerTop0,
      [Math.sin(middle), 0, Math.cos(middle)]
    );
    addQuad(
      innerBottom0,
      innerTop0,
      innerTop1,
      innerBottom1,
      [-Math.sin(middle), 0, -Math.cos(middle)]
    );
    addQuad(outerTop0, outerTop1, innerTop1, innerTop0, [0, 1, 0]);
    addQuad(outerBottom0, innerBottom0, innerBottom1, outerBottom1, [0, -1, 0]);
  }

  if (!fullCircle) {
    const direction = Math.sign(angle) || 1;
    const endAngle = startAngle + angle;
    addQuad(
      point(innerRadius, -halfLength, startAngle),
      point(innerRadius, halfLength, startAngle),
      point(topRadius, halfLength, startAngle),
      point(bottomRadius, -halfLength, startAngle),
      [-direction * Math.cos(startAngle), 0, direction * Math.sin(startAngle)]
    );
    addQuad(
      point(innerRadius, -halfLength, endAngle),
      point(bottomRadius, -halfLength, endAngle),
      point(topRadius, halfLength, endAngle),
      point(innerRadius, halfLength, endAngle),
      [direction * Math.cos(endAngle), 0, -direction * Math.sin(endAngle)]
    );
  }

  const geometry = new state.three.BufferGeometry();
  geometry.setAttribute("position", new state.three.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function primitiveGeometryKey(type: string | null, renderable: Demo3DXmlElement): string {
  const fields = [
    "Angle",
    "ConeRatio",
    "CurveRadius",
    "Depth",
    "Height",
    "InnerRadius",
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
  const key = [
    "material",
    String(material.diffuse ?? "default"),
    String(material.transparency ?? 0),
    String(material.reflectivity ?? 0),
    textureReference ?? ""
  ].join(":");
  const cached = state.materialCache.get(key);
  if (cached) {
    return cached;
  }

  const created = createDemo3DThreeMaterial(material, state.three);
  const texture = textureReference ? getTexture(textureReference, state) : undefined;
  if (texture && "map" in created) {
    const standard = created as Three.MeshStandardMaterial;
    standard.map = texture;
    if (textureReference && state.textureImageById.get(textureReference)?.containsAlpha) {
      standard.transparent = true;
      standard.depthWrite = false;
    }
    created.needsUpdate = true;
  }
  state.materialCache.set(key, created);
  state.stats.materials += 1;
  return created;
}

function getColorMaterial(color: number | undefined, state: RendererState): Three.Material {
  if (color === undefined) {
    return state.defaultMaterial;
  }
  const opacity = demo3dColorToOpacity(color);
  const key = `color:${color}:${opacity}`;
  const cached = state.materialCache.get(key);
  if (cached) {
    return cached;
  }
  const created = new state.three.MeshStandardMaterial({
    color: demo3dColorToHex(color),
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    roughness: 0.9,
    metalness: 0.05
  });
  state.materialCache.set(key, created);
  state.stats.materials += 1;
  return created;
}

function getImageMaterial(material: Demo3DMaterial | undefined, state: RendererState): Three.Material {
  const diffuse = material?.diffuse;
  const opacity = demo3dMaterialOpacity(material);
  const textureReference = material?.textureReference;
  const texture = textureReference ? getTexture(textureReference, state) : undefined;
  const key = `image:${String(diffuse ?? "default")}:${String(material?.transparency ?? 0)}:${textureReference ?? ""}`;
  const cached = state.materialCache.get(key);
  if (cached) {
    return cached;
  }

  const parameters: Three.MeshBasicMaterialParameters = {
    color: diffuse === undefined ? 0xffffff : demo3dColorToHex(diffuse),
    transparent: texture !== undefined || opacity < 1,
    opacity,
    depthWrite: texture === undefined && opacity >= 1,
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
  // Demo3D's generated primitive UVs use the conventional bottom-left texture
  // origin expected by Three's TextureLoader.
  texture.flipY = true;
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
  convertTriangleGeometryToThreeCoordinates(geometry);
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
  convertTriangleGeometryToThreeCoordinates(geometry);
  const mesh = new state.three.Mesh(geometry, getMaterial(material, state));
  state.stats.geometries += 1;
  return mesh;
}

function getLineMaterial(material: Demo3DMaterial | undefined, state: RendererState): Three.Material {
  const color = material?.diffuse === undefined ? 0x202124 : demo3dColorToHex(material.diffuse);
  const opacity = demo3dMaterialOpacity(material);
  const key = `line:${color}:${opacity}`;
  const cached = state.materialCache.get(key);
  if (cached) {
    return cached;
  }

  const created = new state.three.LineBasicMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    depthWrite: opacity >= 1
  });
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
      height: numberChildOptional(value, "Height"),
      containsAlpha: isTrue(value?.textOf("ContainsAlpha"))
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
      if (!isFalse(aspect.textOf("IsEnabled"))) {
        found.push(aspect);
      }
      continue;
    }
    if (state.options.includeUnsupported) {
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
        const mesh = createMeshObject(meshId, renderable, renderableMaterials(renderable), state);
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

function createDimensionGroup(state: RendererState): Three.Group {
  const group = new state.three.Group();
  group.name = "Demo3D dimensions";
  for (const xml of state.serializedObjectById.values()) {
    if (xml.xsiType !== "e3d:DimensionAspect") {
      continue;
    }
    const dimension = createDimensionObject(new Demo3DDimensionAspect(xml.xsiType, xml), state);
    if (dimension) {
      group.add(dimension);
    }
  }
  if (group.children.length > 0) {
    group.userData.demo3d = { kind: "dimensions" };
    state.stats.groups += 1;
  }
  return group;
}

function createDimensionObject(
  dimension: Demo3DDimensionAspect,
  state: RendererState
): Three.Group | undefined {
  const start = dimensionPointToWorld(dimension.start, state);
  const end = dimensionPointToWorld(dimension.end, state);
  if (!start || !end) {
    return undefined;
  }
  const extensionValues = dimension.extensionDirection;
  const extension = new state.three.Vector3(
    extensionValues[0] ?? 0,
    extensionValues[1] ?? 1,
    -(extensionValues[2] ?? 0)
  );
  if (extension.lengthSq() === 0) {
    extension.set(0, 1, 0);
  }
  extension.normalize().multiplyScalar(dimension.height);
  const lineStart = start.clone().add(extension);
  const lineEnd = end.clone().add(extension);
  const positions: number[] = [];
  pushVectorLine(positions, start, lineStart);
  pushVectorLine(positions, end, lineEnd);
  pushVectorLine(positions, lineStart, lineEnd);

  const direction = lineEnd.clone().sub(lineStart);
  const distance = direction.length();
  if (distance > 0) {
    direction.normalize();
    const normal = extension.clone().normalize();
    const perpendicular = new state.three.Vector3().crossVectors(direction, normal);
    if (perpendicular.lengthSq() === 0) {
      perpendicular.set(0, 0, 1);
    }
    perpendicular.normalize();
    const startArrow = dimensionArrowSize(dimension.startArrow, distance);
    const endArrow = dimensionArrowSize(dimension.endArrow, distance);
    const startDirection = dimension.arrowsInside ? direction : direction.clone().negate();
    const endDirection = dimension.arrowsInside ? direction.clone().negate() : direction;
    addDimensionArrow(positions, lineStart, startDirection, perpendicular, startArrow.length, startArrow.width);
    addDimensionArrow(positions, lineEnd, endDirection, perpendicular, endArrow.length, endArrow.width);
  }

  const geometry = new state.three.BufferGeometry();
  geometry.setAttribute("position", new state.three.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const object = new state.three.Group();
  const lines = new state.three.LineSegments(geometry, getLineMaterial(dimension.material, state));
  lines.name = "Dimension lines";
  object.add(lines);

  if (distance > 0) {
    const label = distance.toFixed(3);
    const color = demo3dColorToHex(dimension.material?.diffuse ?? -16777216);
    const lineHeight = clamp(distance * 0.035, 0.025, 0.12);
    const text = canUseCanvas()
      ? createCanvasTextMesh(label, lineHeight, color, false, state)
      : createFallbackTextMesh(label, lineHeight, dimension.material, state);
    text.position.copy(lineStart).lerp(lineEnd, 0.5).add(extension.clone().normalize().multiplyScalar(lineHeight));
    text.name = `Dimension ${label}`;
    object.add(text);
    state.stats.meshes += 1;
  }

  object.name = dimension.id ?? "Dimension";
  object.userData.demo3d = {
    kind: "dimension",
    id: dimension.id,
    distance,
    unit: dimension.unit,
    format: dimension.format,
    arrowsInside: dimension.arrowsInside,
    flipText: dimension.flipText,
    lockDirection: dimension.lockDirection,
    depth: dimension.depth,
    xmlPath: dimension.xml.path
  };
  state.stats.geometries += 1;
  state.stats.lines += positions.length / 6;
  state.stats.groups += 1;
  state.stats.dimensions += 1;
  return object;
}

function dimensionArrowSize(
  profile: Demo3DExtrusionProfile | undefined,
  distance: number
): { readonly length: number; readonly width: number } {
  const points = profile?.polygons.flatMap((polygon) => polygon.points) ?? [];
  const anchorX = profile?.anchor.x ?? 0;
  const anchorY = profile?.anchor.y ?? 0;
  const profileLength = points.reduce(
    (largest, point) => Math.max(largest, Math.abs(point.y - anchorY)),
    0
  );
  const profileWidth = points.reduce(
    (largest, point) => Math.max(largest, Math.abs(point.x - anchorX)),
    0
  );
  const fallbackLength = clamp(distance * 0.04, 0.02, 0.08);
  const length = profileLength > 0 ? Math.min(profileLength, distance * 0.25) : fallbackLength;
  const width = profileWidth > 0 ? Math.min(profileWidth, distance * 0.125) : length * 0.45;
  return { length, width };
}

function dimensionPointToWorld(
  point: Demo3DDimensionPoint | undefined,
  state: RendererState
): Three.Vector3 | undefined {
  if (!point) {
    return undefined;
  }
  const local = new state.three.Vector3(
    point.point[0] ?? 0,
    point.point[1] ?? 0,
    -(point.point[2] ?? 0)
  );
  const visual = point.visualId ? state.visualObjectById.get(point.visualId) : undefined;
  return visual ? visual.localToWorld(local) : local;
}

function pushVectorLine(positions: number[], start: Three.Vector3, end: Three.Vector3): void {
  positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
}

function addDimensionArrow(
  positions: number[],
  tip: Three.Vector3,
  direction: Three.Vector3,
  perpendicular: Three.Vector3,
  length: number,
  width: number
): void {
  const base = tip.clone().addScaledVector(direction, length);
  pushVectorLine(positions, tip, base.clone().addScaledVector(perpendicular, width));
  pushVectorLine(positions, tip, base.clone().addScaledVector(perpendicular, -width));
}

function createPlaceholderMesh(
  name: string,
  meshReferenceId: string,
  material: Demo3DMaterial | undefined,
  state: RendererState
): Three.Mesh {
  const geometry = new state.three.BoxGeometry(0.25, 0.25, 0.25);
  convertTriangleGeometryToThreeCoordinates(geometry);
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

function findVisualMeshReferenceIds(root: Demo3DXmlElement): string[] {
  const ids = new Set<string>();
  for (const child of root.children) {
    if (child.localName === "C") {
      continue;
    }
    for (const id of findMeshReferenceIds(child)) {
      ids.add(id);
    }
  }
  return [...ids];
}

function renderableMaterials(renderable: Demo3DXmlElement): Demo3DMaterial[] {
  const materials: Demo3DMaterial[] = [];
  const materialProperties = renderable.child("MaterialProperties");
  for (const entry of materialProperties?.children ?? []) {
    const material = firstMaterial(entry);
    if (material) {
      materials.push(material);
    }
  }
  if (materials.length === 0) {
    const material = firstMaterial(renderable);
    if (material) {
      materials.push(material);
    }
  }
  return materials;
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
  return alpha / 255;
}

function demo3dMaterialOpacity(material: Demo3DMaterial | undefined): number {
  const colorOpacity = material?.diffuse === undefined
    ? 1
    : demo3dColorToOpacity(material.diffuse);
  const transparency = clamp01(material?.transparency ?? 0);
  return colorOpacity * (1 - transparency);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function applyDemo3DTransform(object: Three.Object3D, transformText: string | undefined): void {
  const values = parsePipeNumbers(transformText);
  if (values.length === 0) {
    return;
  }

  object.position.set(values[0] ?? 0, values[1] ?? 0, -(values[2] ?? 0));
  // Demo3D rotation triples are pitch (X), yaw (Y), and roll (Z). Its
  // RotationYawPitchRoll matrix corresponds to Three's intrinsic YXZ order.
  object.rotation.set(-(values[3] ?? 0), -(values[4] ?? 0), values[5] ?? 0, "YXZ");
}

function convertTriangleGeometryToThreeCoordinates(geometry: Three.BufferGeometry): void {
  geometry.scale(1, 1, -1);
  const index = geometry.getIndex();

  if (index) {
    const values = index.array as unknown as { [index: number]: number; readonly length: number };
    for (let offset = 0; offset + 2 < values.length; offset += 3) {
      const second = values[offset + 1];
      values[offset + 1] = values[offset + 2];
      values[offset + 2] = second;
    }
    index.needsUpdate = true;
    return;
  }

  for (const attribute of Object.values(geometry.attributes) as Three.BufferAttribute[]) {
    const values = attribute.array as unknown as { [index: number]: number; readonly length: number };
    for (let vertex = 0; vertex + 2 < attribute.count; vertex += 3) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        const second = (vertex + 1) * attribute.itemSize + component;
        const third = (vertex + 2) * attribute.itemSize + component;
        const value = values[second];
        values[second] = values[third];
        values[third] = value;
      }
    }
    attribute.needsUpdate = true;
  }
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

function isLayerVisible(layerName: string | undefined, state: RendererState): boolean {
  return (
    state.options.includeHiddenLayers === true ||
    layerName === undefined ||
    state.layerVisibilityByName.get(layerName) !== false
  );
}

function isTrue(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function isFalse(value: string | undefined): boolean {
  return value === "0" || value?.toLowerCase() === "false";
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
