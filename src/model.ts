import { Demo3DBinaryBlock, type Demo3DScalarValue, Demo3DXmlElement } from "./xml.js";
import type { ZipEntryInfo } from "./zip.js";

export interface Demo3DTypeConstructor<T extends Demo3DTypedObject = Demo3DTypedObject> {
  new (typeName: string, xml: Demo3DXmlElement): T;
}

const typeRegistry = new Map<string, Demo3DTypeConstructor>();

export function registerDemo3DType(typeName: string, constructor: Demo3DTypeConstructor): void {
  typeRegistry.set(typeName, constructor);
}

export function createTypedObject(xml: Demo3DXmlElement): Demo3DTypedObject {
  const typeName = xml.xsiType ?? "unknown";
  const Constructor = typeRegistry.get(typeName) ?? Demo3DUnknownObject;
  return new Constructor(typeName, xml);
}

export class Demo3DTypedObject {
  constructor(public readonly typeName: string, public readonly xml: Demo3DXmlElement) {}

  get name(): string | undefined {
    return this.xml.textOf("N") ?? this.xml.textOf("Name");
  }

  get id(): string | undefined {
    return this.xml.textOf("Id") ?? this.xml.textOf("UID");
  }

  child(localName: string): Demo3DXmlElement | undefined {
    return this.xml.child(localName);
  }

  value(localName: string): Demo3DScalarValue | undefined {
    return this.xml.valueOf(localName);
  }
}

export class Demo3DUnknownObject extends Demo3DTypedObject {}

export class Demo3DReference {
  constructor(
    public readonly id: string,
    public readonly typeName?: string,
    public readonly filter?: Demo3DXmlElement
  ) {}
}

export class Demo3DHeader {
  constructor(
    public readonly id?: string,
    public readonly locale?: string,
    public readonly product?: string,
    public readonly version?: string,
    public readonly edition?: string,
    public readonly lastModified?: string,
    public readonly hardwareId?: string
  ) {}

  static fromXml(root: Demo3DXmlElement): Demo3DHeader {
    const header = root.child("Header");
    return new Demo3DHeader(
      header?.textOf("Id"),
      header?.textOf("Locale"),
      header?.textOf("Product"),
      header?.textOf("Version"),
      header?.textOf("Edition"),
      header?.textOf("LastModified"),
      header?.textOf("Hwid")
    );
  }
}

/** A named camera saved in an editable Demo3D project. */
export class Demo3DView {
  constructor(
    public readonly name: string,
    public readonly position: readonly number[],
    public readonly target: readonly number[]
  ) {}
}

export class Demo3DMaterial extends Demo3DTypedObject {
  get diffuse(): number | undefined {
    return numberValue(this.xml.valueOf("Diffuse"));
  }

  get reflectivity(): number | undefined {
    return numberValue(this.xml.valueOf("Reflectivity"));
  }

  get transparency(): number | undefined {
    return numberValue(this.xml.valueOf("Transparency"));
  }

  get textureReference(): string | undefined {
    return (
      this.xml.child("TextureReference")?.textOf("Id") ??
      this.xml.child("Texture")?.textOf("Id") ??
      this.xml.textOf("TextureReference") ??
      this.xml.textOf("Texture")
    );
  }
}

export interface Demo3DExternalMeshData {
  readonly meshFormat: string;
  readonly vertexFormat: string;
  readonly indexFormat?: string;
  readonly vertices: Uint8Array;
  readonly indices?: Uint8Array;
  readonly auxiliary?: Uint8Array;
}

export class Demo3DMesh extends Demo3DTypedObject {
  private readonly referenceId?: string;
  readonly meshFormat?: string;
  readonly vertexFormat?: string;
  readonly indexFormat?: string;
  readonly vertices?: Demo3DBinaryBlock;
  readonly indices?: Demo3DBinaryBlock;
  readonly auxiliary?: Demo3DBinaryBlock;

  constructor(typeName: string, xml: Demo3DXmlElement, id?: string, external?: Demo3DExternalMeshData) {
    super(typeName, xml);
    const meshData = xml.child("MeshData");
    const vertices = meshData?.child("V");
    const indices = meshData?.child("I");

    this.referenceId = id;
    this.meshFormat = external?.meshFormat ?? stringValue(meshData?.valueOf("MF"));
    this.vertexFormat = external?.vertexFormat ?? stringValue(vertices?.valueOf("VF"));
    this.indexFormat = external?.indexFormat ?? stringValue(indices?.valueOf("IF"));
    this.vertices = external ? Demo3DBinaryBlock.fromBytes(external.vertices) : binaryValue(vertices?.valueOf("D"));
    this.indices = external?.indices
      ? Demo3DBinaryBlock.fromBytes(external.indices)
      : binaryValue(indices?.valueOf("D"));
    this.auxiliary = external?.auxiliary
      ? Demo3DBinaryBlock.fromBytes(external.auxiliary)
      : binaryValue(meshData?.valueOf("A"));
  }

  override get id(): string | undefined {
    return this.referenceId ?? super.id;
  }
}

export class Demo3DPointCloudPrimitive {
  constructor(public readonly xml: Demo3DXmlElement) {}

  get color(): number | undefined {
    return numberValue(this.xml.valueOf("Color"));
  }

  get pointsBufferName(): string | undefined {
    return this.xml.textOf("Points");
  }
}

export class Demo3DPointCloud extends Demo3DTypedObject {
  private primitivesCache?: readonly Demo3DPointCloudPrimitive[];

  constructor(typeName: string, xml: Demo3DXmlElement, private readonly referenceId?: string) {
    super(typeName, xml);
  }

  override get id(): string | undefined {
    return this.referenceId ?? super.id ?? this.name;
  }

  get hasColoredVertices(): boolean {
    return booleanValue(this.xml.valueOf("HasColoredVertices"), false);
  }

  get hasNormals(): boolean {
    return booleanValue(this.xml.valueOf("HasNormals"), false);
  }

  get primitives(): readonly Demo3DPointCloudPrimitive[] {
    return this.primitivesCache ??= (this.xml.child("PointCloudPrimitives")?.children ?? [])
      .map((primitive) => new Demo3DPointCloudPrimitive(primitive));
  }
}

export class Demo3DVisual extends Demo3DTypedObject {
  readonly displayName?: string;
  readonly layer?: string;
  readonly localTransform?: readonly number[];
  readonly initialLocalTransform?: readonly number[];
  readonly properties?: Demo3DXmlElement;
  readonly materials: readonly Demo3DMaterial[];
  readonly children: Demo3DVisual[] = [];

  constructor(typeName: string, xml: Demo3DXmlElement) {
    super(typeName, xml);
    this.displayName = xml.textOf("N") ?? xml.textOf("Name") ?? attributeValue(xml, "Name");
    this.layer = xml.child("P")?.textOf("Layer");
    this.localTransform = numberArrayValue(xml.valueOf("LR"));
    this.initialLocalTransform = numberArrayValue(xml.valueOf("ILR"));
    this.properties = xml.child("P");
    this.materials = findVisualMaterials(xml)
      .map((node) => new Demo3DMaterial(node.xsiType ?? "e3d:MeshMaterial", node));
  }
}

export class Demo3DVector2 extends Demo3DTypedObject {
  readonly x: number;
  readonly y: number;

  constructor(typeName: string, xml: Demo3DXmlElement) {
    super(typeName, xml);
    const values = parsePipeNumbers(xml.text);
    this.x = values[0] ?? 0;
    this.y = values[1] ?? 0;
  }
}

export class Demo3DExtrusionPolygon extends Demo3DTypedObject {
  private pointsCache?: readonly Demo3DVector2[];
  private materialsCache?: readonly Demo3DMaterial[];
  private smoothCache?: readonly boolean[];

  get points(): readonly Demo3DVector2[] {
    return this.pointsCache ??= (this.xml.child("Points")?.children ?? [])
      .filter((point) => point.xsiType === "e3d:Vector2")
      .map((point) => new Demo3DVector2(point.xsiType ?? "e3d:Vector2", point));
  }

  get materials(): readonly Demo3DMaterial[] {
    return this.materialsCache ??= (this.xml.child("M")?.children ?? [])
      .filter((material) => material.xsiType === "e3d:MeshMaterial")
      .map((material) => new Demo3DMaterial(material.xsiType ?? "e3d:MeshMaterial", material));
  }

  get smooth(): readonly boolean[] {
    return this.smoothCache ??= (this.xml.child("Smooth")?.children ?? [])
      .map((value) => booleanValue(value.value, false));
  }

  get ignoreCutouts(): boolean {
    return booleanValue(this.xml.valueOf("IgnoreCutouts"), false);
  }
}

export class Demo3DExtrusionProfile {
  private anchorCache?: Demo3DVector2;
  private polygonsCache?: readonly Demo3DExtrusionPolygon[];

  constructor(public readonly xml: Demo3DXmlElement) {}

  get name(): string | undefined {
    return this.xml.textOf("Name");
  }

  get anchor(): Demo3DVector2 {
    const anchor = this.xml.child("Anchor");
    return this.anchorCache ??= new Demo3DVector2("e3d:Vector2", anchor ?? emptyXmlElement("Anchor"));
  }

  get polygons(): readonly Demo3DExtrusionPolygon[] {
    return this.polygonsCache ??= (this.xml.child("Polygons")?.children ?? [])
      .filter((polygon) => polygon.xsiType === "e3d:ExtrusionPolygon")
      .map((polygon) => new Demo3DExtrusionPolygon(polygon.xsiType ?? "e3d:ExtrusionPolygon", polygon));
  }
}

export class Demo3DSupportStandProperties extends Demo3DTypedObject {
  get legProfile(): Demo3DExtrusionProfile | undefined {
    return extrusionProfile(this.xml.child("LegProfile"));
  }

  get footProfile(): Demo3DExtrusionProfile | undefined {
    return extrusionProfile(this.xml.child("FootProfile"));
  }

  get floorPlateProfile(): Demo3DExtrusionProfile | undefined {
    return extrusionProfile(this.xml.child("FloorPlateProfile"));
  }

  get crossBraceProfile(): Demo3DExtrusionProfile | undefined {
    return extrusionProfile(this.xml.child("CrossBraceProfile"));
  }

  get conveyorOffset(): readonly (number | undefined)[] {
    return parsePipeNumbers(this.xml.textOf("ConveyorOffset") ?? "");
  }

  get crossBraceHeights(): readonly number[] {
    return numericChildren(this.xml.child("AddCrossBraceAtHeight"));
  }

  get footHeight(): number {
    return numberValue(this.xml.valueOf("FootHeight")) ?? 0;
  }

  get floorPlateHeight(): number {
    return numberValue(this.xml.valueOf("FloorPlateHeight")) ?? 0;
  }

  get legMaterial(): number | undefined {
    return numberValue(this.xml.valueOf("LegMaterial"));
  }

  get footMaterial(): number | undefined {
    return numberValue(this.xml.valueOf("FootMaterial"));
  }

  get floorPlateMaterial(): number | undefined {
    return numberValue(this.xml.valueOf("FloorPlateMaterial"));
  }

  get crossBraceMaterial(): number | undefined {
    return numberValue(this.xml.valueOf("CrossBraceMaterial"));
  }
}

export class Demo3DSupportStand extends Demo3DVisual {
  private supportPropertiesCache?: Demo3DSupportStandProperties;

  get supportProperties(): Demo3DSupportStandProperties | undefined {
    if (this.properties) {
      return this.supportPropertiesCache ??= new Demo3DSupportStandProperties(
        this.properties.xsiType ?? "e3d:SupportStandProperties",
        this.properties
      );
    }
    return undefined;
  }
}

export class Demo3DConveyorSideProperties extends Demo3DTypedObject {
  get profile(): Demo3DExtrusionProfile | undefined {
    return extrusionProfile(this.xml.child("Profile"));
  }

  get material(): Demo3DMaterial | undefined {
    return firstTypedMaterial(this.xml.child("Material") ?? this.xml);
  }

  get height(): number {
    return numberValue(this.xml.valueOf("Height")) ?? 0;
  }

  get width(): number {
    return numberValue(this.xml.valueOf("Width")) ?? 0;
  }

  get step(): number {
    return numberValue(this.xml.valueOf("Step")) ?? 0;
  }

  get visible(): boolean {
    return booleanValue(this.xml.valueOf("SideVisible"), true);
  }
}

export class Demo3DPhotoEyeProperties extends Demo3DTypedObject {
  get beamHeight(): number {
    return numberValue(this.xml.valueOf("BeamHeight")) ?? 0;
  }

  get beamAngle(): number {
    return numberValue(this.xml.valueOf("BeamAngle")) ?? 0;
  }

  get boxMaterial(): number | undefined {
    return numberValue(this.xml.valueOf("BoxMaterial"));
  }

  get clearedMaterial(): number | undefined {
    return numberValue(this.xml.valueOf("ClearedMaterial"));
  }

  get blockedMaterial(): number | undefined {
    return numberValue(this.xml.valueOf("BlockedMaterial"));
  }

  get disabledMaterial(): number | undefined {
    return numberValue(this.xml.valueOf("DisabledMaterial"));
  }
}

export class Demo3DPhotoEye extends Demo3DVisual {
  private photoEyePropertiesCache?: Demo3DPhotoEyeProperties;

  get photoEyeProperties(): Demo3DPhotoEyeProperties | undefined {
    if (!this.properties) {
      return undefined;
    }
    return this.photoEyePropertiesCache ??= new Demo3DPhotoEyeProperties(
      this.properties.xsiType ?? "e3d:SensorWithScriptProperties",
      this.properties
    );
  }
}

export class Demo3DDimensionPoint {
  readonly point: readonly (number | undefined)[];
  readonly visualId?: string;

  constructor(public readonly xml: Demo3DXmlElement) {
    this.point = parsePipeNumbers(xml.textOf("Point") ?? "");
    this.visualId = xml.child("Visual")?.textOf("Id");
  }
}

export class Demo3DDimensionAspect extends Demo3DTypedObject {
  get start(): Demo3DDimensionPoint | undefined {
    const point = this.xml.child("StartPoint");
    return point ? new Demo3DDimensionPoint(point) : undefined;
  }

  get end(): Demo3DDimensionPoint | undefined {
    const point = this.xml.child("EndPoint");
    return point ? new Demo3DDimensionPoint(point) : undefined;
  }

  get dimensionDirection(): readonly (number | undefined)[] {
    return parsePipeNumbers(this.xml.child("DimensionDirection")?.textOf("Normal") ?? "");
  }

  get extensionDirection(): readonly (number | undefined)[] {
    return parsePipeNumbers(this.xml.child("ExtensionDirection")?.textOf("Normal") ?? "");
  }

  get height(): number {
    return numberValue(this.xml.valueOf("Height")) ?? 0;
  }

  get depth(): number {
    return numberValue(this.xml.valueOf("Depth")) ?? 0;
  }

  get arrowsInside(): boolean {
    return booleanValue(this.xml.valueOf("ArrowsInside"), true);
  }

  get flipText(): boolean {
    return booleanValue(this.xml.valueOf("FlipText"), false);
  }

  get lockDirection(): boolean {
    return booleanValue(this.xml.valueOf("LockDirection"), false);
  }

  get format(): string | undefined {
    return this.xml.textOf("Format");
  }

  get unit(): string | undefined {
    return this.xml.textOf("Unit");
  }

  get startArrow(): Demo3DExtrusionProfile | undefined {
    return extrusionProfile(this.xml.child("StartArrow"));
  }

  get endArrow(): Demo3DExtrusionProfile | undefined {
    return extrusionProfile(this.xml.child("EndArrow"));
  }

  get material(): Demo3DMaterial | undefined {
    return firstTypedMaterial(this.xml.child("Material") ?? this.xml);
  }
}

export class Demo3DLayer extends Demo3DTypedObject {
  readonly color?: number;
  readonly visible: boolean;
  readonly presets: ReadonlyMap<string, boolean>;

  constructor(typeName: string, xml: Demo3DXmlElement, private readonly referenceName?: string) {
    super(typeName, xml);
    this.color = numberValue(xml.valueOf("Color"));
    this.visible = booleanValue(xml.valueOf("Visible"), true);
    this.presets = extractLayerPresets(xml.child("LayerPresets")?.child("C"));
  }

  override get name(): string {
    return super.name ?? this.referenceName ?? "";
  }
}

export class Demo3DResource {
  constructor(
    public readonly path: string,
    public readonly entry: ZipEntryInfo,
    public readonly data?: Uint8Array
  ) {}
}

export class Demo3DProject {
  constructor(
    public readonly root: Demo3DXmlElement,
    public readonly header: Demo3DHeader,
    public readonly defaultView: string | undefined,
    public readonly views: readonly Demo3DView[],
    public readonly meshes: readonly Demo3DMesh[],
    public readonly pointClouds: readonly Demo3DPointCloud[],
    public readonly layers: readonly Demo3DLayer[],
    public readonly visuals: readonly Demo3DVisual[],
    public readonly typedObjects: readonly Demo3DTypedObject[],
    public readonly unknownTypes: ReadonlyMap<string, number>
  ) {}
}

export class Demo3DPackage {
  constructor(
    public readonly entries: readonly ZipEntryInfo[],
    public readonly modelEntryName: string,
    public readonly modelXml: string,
    public readonly model: Demo3DProject,
    public readonly thumbnail?: Demo3DResource,
    public readonly resources: readonly Demo3DResource[] = [],
    public readonly buffers: readonly Demo3DResource[] = []
  ) {}
}

export function extractProject(
  root: Demo3DXmlElement,
  externalMeshes: readonly Demo3DMesh[] = []
): Demo3DProject {
  const typedObjects = collectTypedObjects(root);
  const unknownTypes = new Map<string, number>();
  for (const typedObject of typedObjects) {
    if (typedObject instanceof Demo3DUnknownObject) {
      unknownTypes.set(typedObject.typeName, (unknownTypes.get(typedObject.typeName) ?? 0) + 1);
    }
  }

  return new Demo3DProject(
    root,
    Demo3DHeader.fromXml(root),
    root.textOf("DefaultCamera"),
    extractViews(root),
    mergeMeshes(extractMeshes(root), externalMeshes),
    extractPointClouds(root),
    extractLayers(root),
    extractVisualRoots(root),
    typedObjects,
    unknownTypes
  );
}

function mergeMeshes(
  embedded: readonly Demo3DMesh[],
  external: readonly Demo3DMesh[]
): Demo3DMesh[] {
  const meshes = new Map<string, Demo3DMesh>();
  for (const mesh of [...embedded, ...external]) {
    const key = mesh.id ?? mesh.xml.path;
    meshes.set(key, mesh);
  }
  return [...meshes.values()];
}

function extractViews(root: Demo3DXmlElement): Demo3DView[] {
  const entries = root.child("Cameras")?.children ?? [];
  return entries.flatMap((entry) => {
    const camera = entry.child("val");
    if (camera?.xsiType !== "e3d:Camera") {
      return [];
    }
    const name = entry.child("key")?.text ?? camera.textOf("Name");
    if (!name) {
      return [];
    }
    return [new Demo3DView(name, cameraVector(camera.textOf("Position")), cameraVector(camera.textOf("Target")))];
  });
}

function extractLayers(root: Demo3DXmlElement): Demo3DLayer[] {
  const entries = root.child("LayerLibrary")?.child("Layers")?.children ?? [];
  return entries.flatMap((entry) => {
    const value = entry.child("val");
    if (value?.xsiType !== "e3d:Layer") {
      return [];
    }
    return [new Demo3DLayer(value.xsiType, value, entry.child("key")?.text)];
  });
}

function extractLayerPresets(container: Demo3DXmlElement | undefined): ReadonlyMap<string, boolean> {
  const presets = new Map<string, boolean>();
  for (const entry of container?.children ?? []) {
    const name = entry.child("key")?.text;
    if (name) {
      presets.set(name, booleanValue(entry.child("val")?.value, true));
    }
  }
  return presets;
}

function collectTypedObjects(root: Demo3DXmlElement): Demo3DTypedObject[] {
  return findDescendants(root, (node) => node.xsiType !== null).map(createTypedObject);
}

function extractMeshes(root: Demo3DXmlElement): Demo3DMesh[] {
  const meshes: Demo3DMesh[] = [];
  const entries = root.child("MeshLibrary")?.child("Meshes")?.children;
  const candidates = entries ?? findDescendants(root, (node) => node.xsiType === "e3d:DictionaryEntry");

  for (const entry of candidates) {
    const value = entry.child("val");
    if (value?.xsiType !== "e3d:Mesh") {
      continue;
    }

    const id = entry.child("key")?.textOf("Id") ?? value.textOf("Id");
    meshes.push(new Demo3DMesh("e3d:Mesh", value, id));
  }

  return meshes;
}

function extractPointClouds(root: Demo3DXmlElement): Demo3DPointCloud[] {
  const entries = root.child("PointCloudLibrary")?.child("PointClouds")?.children ?? [];
  const pointClouds: Demo3DPointCloud[] = [];
  for (const entry of entries) {
    const value = entry.child("val");
    if (value?.xsiType !== "e3d:PointCloud") {
      continue;
    }
    const id = entry.child("key")?.textOf("Id") ?? entry.child("key")?.text ?? value.textOf("Name");
    pointClouds.push(new Demo3DPointCloud(value.xsiType, value, id));
  }
  return pointClouds;
}

function findVisualMaterials(root: Demo3DXmlElement): Demo3DXmlElement[] {
  const found: Demo3DXmlElement[] = [];
  const stack = root.children.filter((child) => child.localName !== "C");

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.xsiType === "e3d:MeshMaterial") {
      found.push(node);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }

  return found;
}

function extractVisualRoots(root: Demo3DXmlElement): Demo3DVisual[] {
  const flatVisuals = root.child("Visuals")?.children.filter(isVisualElement) ?? [];
  if (flatVisuals.length > 0) {
    return buildFlatVisualRoots(flatVisuals);
  }

  const roots: Demo3DVisual[] = [];
  const rootChildren = root.child("Scene")?.child("C")?.children ?? root.child("C")?.children ?? findTopLevelVisualContainers(root);

  for (const child of rootChildren) {
    if (isVisualElement(child)) {
      roots.push(buildVisual(child));
    }
  }

  return roots;
}

function buildFlatVisualRoots(nodes: readonly Demo3DXmlElement[]): Demo3DVisual[] {
  const visualById = new Map<string, Demo3DVisual>();
  for (const node of nodes) {
    const id = node.textOf("Id");
    if (id) {
      visualById.set(id, buildVisual(node));
    }
  }

  const roots: Demo3DVisual[] = [];
  for (const node of nodes) {
    const id = node.textOf("Id");
    const visual = id ? visualById.get(id) : undefined;
    if (!visual) {
      continue;
    }
    const parentId = attributeValue(node, "Parent");
    const parent = parentId ? visualById.get(parentId) : undefined;
    if (parent) {
      parent.children.push(visual);
    } else {
      roots.push(visual);
    }
  }
  return roots;
}

function findTopLevelVisualContainers(root: Demo3DXmlElement): readonly Demo3DXmlElement[] {
  const projectChildren = root.children.filter((child) => child.localName === "e" || child.localName === "Visual");
  return projectChildren.length > 0 ? projectChildren : root.children;
}

function buildVisual(node: Demo3DXmlElement): Demo3DVisual {
  const typed = createTypedObject(node);
  const visual = typed instanceof Demo3DVisual
    ? typed
    : new Demo3DVisual(node.xsiType ?? "e3d:Visual", node);
  const childContainer = node.child("C");
  if (childContainer) {
    for (const child of childContainer.children) {
      if (isVisualElement(child)) {
        visual.children.push(buildVisual(child));
      }
    }
  }
  return visual;
}

function isVisualElement(node: Demo3DXmlElement): boolean {
  if (!node.xsiType) {
    return false;
  }

  if (node.localName === "Visual") {
    return true;
  }

  if (node.localName === "e" && (node.child("Id") || node.child("N") || node.child("P"))) {
    return true;
  }

  return node.xsiType === "e3d:Visual" || node.xsiType.endsWith("Visual");
}

function attributeValue(node: Demo3DXmlElement, name: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === name)?.value;
}

function findDescendants(
  root: Demo3DXmlElement,
  predicate: (node: Demo3DXmlElement) => boolean
): Demo3DXmlElement[] {
  const found: Demo3DXmlElement[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (predicate(node)) {
      found.push(node);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }

  return found;
}

function numberValue(value: Demo3DScalarValue | undefined): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: Demo3DScalarValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function binaryValue(value: Demo3DScalarValue | undefined): Demo3DBinaryBlock | undefined {
  return value instanceof Demo3DBinaryBlock ? value : undefined;
}

function numberArrayValue(value: Demo3DScalarValue | undefined): readonly number[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function booleanValue(value: Demo3DScalarValue | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string" && value.length > 0) {
    return !(value === "0" || value.toLowerCase() === "false");
  }
  return fallback;
}

function parsePipeNumbers(value: string): Array<number | undefined> {
  return value.split("|").map((part) => {
    const trimmed = part.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  });
}

function cameraVector(value: string | undefined): readonly number[] {
  const values = parsePipeNumbers(value ?? "");
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function numericChildren(container: Demo3DXmlElement | undefined): number[] {
  const values: number[] = [];
  for (const child of container?.children ?? []) {
    const value = numberValue(child.value);
    if (value !== undefined) {
      values.push(value);
    }
  }
  if (values.length === 0) {
    const value = numberValue(container?.value);
    if (value !== undefined) {
      values.push(value);
    }
  }
  return values;
}

function extrusionProfile(xml: Demo3DXmlElement | undefined): Demo3DExtrusionProfile | undefined {
  return xml ? new Demo3DExtrusionProfile(xml) : undefined;
}

function emptyXmlElement(localName: string): Demo3DXmlElement {
  return new Demo3DXmlElement(localName, localName, null, null, `/${localName}`, [], [], "", null, "");
}

function firstTypedMaterial(root: Demo3DXmlElement): Demo3DMaterial | undefined {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.xsiType === "e3d:MeshMaterial") {
      return new Demo3DMaterial(node.xsiType, node);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }
  return undefined;
}

registerDemo3DType("e3d:Visual", Demo3DVisual);
registerDemo3DType("e3d:Mesh", Demo3DMesh);
registerDemo3DType("e3d:MeshMaterial", Demo3DMaterial);
registerDemo3DType("e3d:PointCloud", Demo3DPointCloud);
registerDemo3DType("e3d:Layer", Demo3DLayer);
registerDemo3DType("e3d:Vector2", Demo3DVector2);
registerDemo3DType("e3d:ExtrusionPolygon", Demo3DExtrusionPolygon);
registerDemo3DType("e3d:SupportStand", Demo3DSupportStand);
registerDemo3DType("e3d:SupportStandProperties", Demo3DSupportStandProperties);
registerDemo3DType("e3d:ConveyorSideProperties", Demo3DConveyorSideProperties);
registerDemo3DType("e3d:SensorWithScriptProperties", Demo3DPhotoEyeProperties);
registerDemo3DType("e3d:DimensionAspect", Demo3DDimensionAspect);
registerDemo3DType("e3d:PhotoEye", Demo3DPhotoEye);

for (const visualType of [
  "e3d:BoxTubeVisual",
  "e3d:BoxVisual",
  "e3d:ContainerVisual",
  "e3d:CurveBeltConveyor",
  "e3d:CurveRollerConveyor",
  "e3d:ChainConveyor",
  "e3d:ChainTransferVisual",
  "e3d:ChainTurntableConveyor",
  "e3d:CylinderVisual",
  "e3d:DiverterRollerConveyor",
  "e3d:ImportedImageVisual",
  "e3d:ImportedMeshVisual",
  "e3d:InjectorBeltConveyor",
  "e3d:InjectorRollerConveyor",
  "e3d:LightVisual",
  "e3d:FloorVisual",
  "e3d:GroupObject",
  "e3d:HandrailVisual",
  "e3d:LoadCreatorVisual",
  "e3d:PointCloudVisual",
  "e3d:PrimitivesVisual",
  "e3d:RackVisual",
  "e3d:StraightBeltConveyor",
  "e3d:StraightRollerConveyor",
  "e3d:ShelfVisual",
  "e3d:SphereVisual",
  "e3d:StairVisual",
  "e3d:TextVisual",
  "e3d:WedgeVisual"
]) {
  registerDemo3DType(visualType, Demo3DVisual);
}

for (const genericType of [
  "e3d:BoxProperties",
  "e3d:BoxTubeProperties",
  "e3d:ChainConveyorProperties",
  "e3d:ChainTransferProperties",
  "e3d:ChainTurntableConveyorProperties",
  "e3d:ContainerProperties",
  "e3d:CylinderProperties",
  "e3d:DrawingBlockProperties",
  "e3d:FloorProperties",
  "e3d:GroupProperties",
  "e3d:HandrailProperties",
  "e3d:ImportedImageProperties",
  "e3d:ImportedMeshProperties",
  "e3d:LightProperties",
  "e3d:LoadCreatorProperties",
  "e3d:PointCloudProperties",
  "e3d:RackProperties",
  "e3d:ShelfProperties",
  "e3d:SphereProperties",
  "e3d:StairProperties",
  "e3d:StraightBeltConveyorProperties",
  "e3d:StraightRollerConveyorProperties",
  "e3d:TextProperties",
  "e3d:VisualProperties",
  "e3d:WedgeProperties"
]) {
  registerDemo3DType(genericType, Demo3DTypedObject);
}
