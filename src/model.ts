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

export class Demo3DMaterial extends Demo3DTypedObject {
  get diffuse(): number | undefined {
    return numberValue(this.xml.valueOf("Diffuse"));
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

export class Demo3DMesh extends Demo3DTypedObject {
  private readonly referenceId?: string;
  readonly meshFormat?: string;
  readonly vertexFormat?: string;
  readonly indexFormat?: string;
  readonly vertices?: Demo3DBinaryBlock;
  readonly indices?: Demo3DBinaryBlock;
  readonly auxiliary?: Demo3DBinaryBlock;

  constructor(typeName: string, xml: Demo3DXmlElement, id?: string) {
    super(typeName, xml);
    const meshData = xml.child("MeshData");
    const vertices = meshData?.child("V");
    const indices = meshData?.child("I");

    this.referenceId = id;
    this.meshFormat = stringValue(meshData?.valueOf("MF"));
    this.vertexFormat = stringValue(vertices?.valueOf("VF"));
    this.indexFormat = stringValue(indices?.valueOf("IF"));
    this.vertices = binaryValue(vertices?.valueOf("D"));
    this.indices = binaryValue(indices?.valueOf("D"));
    this.auxiliary = binaryValue(meshData?.valueOf("A"));
  }

  override get id(): string | undefined {
    return this.referenceId ?? super.id;
  }
}

export class Demo3DVisual extends Demo3DTypedObject {
  readonly displayName?: string;
  readonly localTransform?: readonly number[];
  readonly initialLocalTransform?: readonly number[];
  readonly properties?: Demo3DXmlElement;
  readonly materials: readonly Demo3DMaterial[];
  readonly children: Demo3DVisual[] = [];

  constructor(typeName: string, xml: Demo3DXmlElement) {
    super(typeName, xml);
    this.displayName = xml.textOf("N") ?? xml.textOf("Name");
    this.localTransform = numberArrayValue(xml.valueOf("LR"));
    this.initialLocalTransform = numberArrayValue(xml.valueOf("ILR"));
    this.properties = xml.child("P");
    this.materials = findDescendants(xml, (node) => node.xsiType === "e3d:MeshMaterial")
      .map((node) => new Demo3DMaterial(node.xsiType ?? "e3d:MeshMaterial", node));
  }
}

export class Demo3DResource {
  constructor(public readonly path: string, public readonly entry: ZipEntryInfo) {}
}

export class Demo3DProject {
  constructor(
    public readonly root: Demo3DXmlElement,
    public readonly header: Demo3DHeader,
    public readonly meshes: readonly Demo3DMesh[],
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

export function extractProject(root: Demo3DXmlElement): Demo3DProject {
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
    extractMeshes(root),
    extractVisualRoots(root),
    typedObjects,
    unknownTypes
  );
}

function collectTypedObjects(root: Demo3DXmlElement): Demo3DTypedObject[] {
  return findDescendants(root, (node) => node.xsiType !== null).map(createTypedObject);
}

function extractMeshes(root: Demo3DXmlElement): Demo3DMesh[] {
  const meshes: Demo3DMesh[] = [];
  const entries = findDescendants(root, (node) => node.xsiType === "e3d:DictionaryEntry");

  for (const entry of entries) {
    const value = entry.child("val");
    if (value?.xsiType !== "e3d:Mesh") {
      continue;
    }

    const id = entry.child("key")?.textOf("Id") ?? value.textOf("Id");
    meshes.push(new Demo3DMesh("e3d:Mesh", value, id));
  }

  return meshes;
}

function extractVisualRoots(root: Demo3DXmlElement): Demo3DVisual[] {
  const roots: Demo3DVisual[] = [];
  const rootChildren = root.child("Scene")?.child("C")?.children ?? root.child("C")?.children ?? findTopLevelVisualContainers(root);

  for (const child of rootChildren) {
    if (isVisualElement(child)) {
      roots.push(buildVisual(child));
    }
  }

  return roots;
}

function findTopLevelVisualContainers(root: Demo3DXmlElement): readonly Demo3DXmlElement[] {
  const projectChildren = root.children.filter((child) => child.localName === "e" || child.localName === "Visual");
  return projectChildren.length > 0 ? projectChildren : root.children;
}

function buildVisual(node: Demo3DXmlElement): Demo3DVisual {
  const visual = new Demo3DVisual(node.xsiType ?? "e3d:Visual", node);
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
  return typeof value === "number" ? value : undefined;
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

registerDemo3DType("e3d:Visual", Demo3DVisual);
registerDemo3DType("e3d:Mesh", Demo3DMesh);
registerDemo3DType("e3d:MeshMaterial", Demo3DMaterial);
