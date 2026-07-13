import { decodeText, toUint8Array, type Demo3DInput } from "./binary.js";
import { Demo3DUnsupportedError, Demo3DZipError } from "./errors.js";
import { parseDemo3DXmlFast } from "./fast-xml.js";
import { Demo3DResource } from "./model.js";
import { defaultParseXml, type Demo3DXmlElement, type ParseXmlDocument, xmlDocumentToElement } from "./xml.js";
import { parseZip, type ZipEntry, type ZipEntryInfo } from "./zip.js";

export interface ParseRaw3DOptions {
  readonly parseXml?: ParseXmlDocument;
  readonly xmlParser?: "fast" | "dom";
}

export class Raw3DView {
  constructor(
    public readonly name: string,
    public readonly position: readonly number[],
    public readonly target: readonly number[]
  ) {}
}

export class Raw3DNode {
  constructor(
    public readonly index: number,
    public readonly name: string,
    public readonly parentIndex: number | undefined,
    public readonly meshIndex: number | undefined,
    public readonly layerIndex: number | undefined,
    public readonly materialIndices: readonly number[],
    public readonly location: readonly number[],
    public readonly rotation: readonly number[],
    public readonly scale: readonly number[],
    public readonly castsShadow: boolean,
    public readonly customAttributes: ReadonlyMap<string, string>,
    public readonly xml: Demo3DXmlElement
  ) {}
}

export class Raw3DLayer {
  constructor(
    public readonly name: string,
    public readonly materialIndex: number | undefined,
    public readonly xml: Demo3DXmlElement
  ) {}
}

export class Raw3DMaterial {
  constructor(
    public readonly red: number,
    public readonly green: number,
    public readonly blue: number,
    public readonly transparency: number,
    public readonly reflectivity: number,
    public readonly textureIndex: number | undefined,
    public readonly normalTextureIndex: number | undefined,
    public readonly normalScale: number,
    public readonly scaleU: number,
    public readonly scaleV: number,
    public readonly xml: Demo3DXmlElement
  ) {}
}

export class Raw3DTexture {
  constructor(
    public readonly path: string,
    public readonly data: Uint8Array | undefined,
    public readonly xml: Demo3DXmlElement
  ) {}
}

export class Raw3DVertexAttribute {
  constructor(
    public readonly usage: string,
    public readonly type: string,
    public readonly componentCount: number,
    public readonly offset: number,
    public readonly xml: Demo3DXmlElement
  ) {}
}

export class Raw3DVertexBuffer {
  constructor(
    public readonly path: string,
    public readonly attributes: readonly Raw3DVertexAttribute[],
    public readonly stride: number,
    public readonly data: Uint8Array | undefined,
    public readonly xml: Demo3DXmlElement
  ) {}
}

export class Raw3DIndexBuffer {
  constructor(
    public readonly path: string,
    public readonly data: Uint8Array | undefined,
    public readonly xml: Demo3DXmlElement
  ) {}
}

export class Raw3DMesh {
  constructor(
    public readonly vertexBufferIndex: number,
    public readonly indexBufferIndices: readonly number[],
    public readonly xml: Demo3DXmlElement
  ) {}
}

export class Raw3DProject {
  constructor(
    public readonly root: Demo3DXmlElement,
    public readonly origin: string | undefined,
    public readonly views: readonly Raw3DView[],
    public readonly nodes: readonly Raw3DNode[],
    public readonly layers: readonly Raw3DLayer[],
    public readonly materials: readonly Raw3DMaterial[],
    public readonly textures: readonly Raw3DTexture[],
    public readonly meshes: readonly Raw3DMesh[],
    public readonly vertexBuffers: readonly Raw3DVertexBuffer[],
    public readonly indexBuffers: readonly Raw3DIndexBuffer[]
  ) {}
}

export class Raw3DPackage {
  constructor(
    public readonly entries: readonly ZipEntryInfo[],
    public readonly modelEntryName: string,
    public readonly modelXml: string,
    public readonly model: Raw3DProject,
    public readonly thumbnail?: Demo3DResource,
    public readonly aspects?: Demo3DResource
  ) {}
}

export async function parseRaw3D(input: Demo3DInput, options: ParseRaw3DOptions = {}): Promise<Raw3DPackage> {
  const archive = parseZip(toUint8Array(input));
  const entryByPath = new Map(archive.entries.map((entry) => [entry.name.toLowerCase(), entry]));
  const modelEntry = entryByPath.get("model.xml");
  if (!modelEntry) {
    throw new Demo3DZipError('No "Model.xml" scene entry was found in the RAW3D package.');
  }
  if (modelEntry.uncompressedSize === 0) {
    throw new Demo3DUnsupportedError('RAW3D scene entry "Model.xml" is empty.', "RAW3D_EMPTY_MODEL");
  }

  const modelXml = decodeText(await modelEntry.arrayBuffer(), "utf-8");
  const root = options.parseXml || options.xmlParser === "dom"
    ? xmlDocumentToElement((options.parseXml ?? defaultParseXml)(modelXml))
    : parseDemo3DXmlFast(modelXml);
  if (root.localName !== "Scene") {
    throw new Demo3DUnsupportedError(
      `RAW3D Model.xml has unsupported root element "${root.name}".`,
      "RAW3D_MODEL_ROOT_UNSUPPORTED"
    );
  }

  const loadData = async (path: string): Promise<Uint8Array | undefined> => {
    const entry = entryByPath.get(path.toLowerCase());
    return entry ? entry.arrayBuffer() : undefined;
  };
  const model = await extractRaw3DProject(root, loadData);
  const thumbnailEntry = entryByPath.get("thumbnail.png");
  const aspectsEntry = entryByPath.get("aspects.json");
  const [thumbnail, aspects] = await Promise.all([
    thumbnailEntry ? toResource(thumbnailEntry) : undefined,
    aspectsEntry ? toResource(aspectsEntry) : undefined
  ]);

  return new Raw3DPackage(
    archive.entries.map(toEntryInfo),
    modelEntry.name,
    modelXml,
    model,
    thumbnail,
    aspects
  );
}

async function extractRaw3DProject(
  root: Demo3DXmlElement,
  loadData: (path: string) => Promise<Uint8Array | undefined>
): Promise<Raw3DProject> {
  const textureElements = root.child("Textures")?.childrenNamed("Texture") ?? [];
  const vertexBufferElements = root.child("VertexBuffers")?.childrenNamed("VertexBuffer") ?? [];
  const indexBufferElements = root.child("IndexBuffers")?.childrenNamed("IndexBuffer") ?? [];
  const [textureData, vertexData, indexData] = await Promise.all([
    Promise.all(textureElements.map((element) => loadData(attribute(element, "Path") ?? ""))),
    Promise.all(vertexBufferElements.map((element) => loadData(attribute(element, "Path") ?? ""))),
    Promise.all(indexBufferElements.map((element) => loadData(attribute(element, "Path") ?? "")))
  ]);

  return new Raw3DProject(
    root,
    attribute(root, "Origin"),
    (root.child("Views")?.childrenNamed("View") ?? []).map((element) => new Raw3DView(
      attribute(element, "Name") ?? "",
      numberList(attribute(element, "Position")),
      numberList(attribute(element, "Target"))
    )),
    (root.child("Nodes")?.childrenNamed("Node") ?? []).map((element, position) => new Raw3DNode(
      integerAttribute(element, "Index") ?? position,
      attribute(element, "Name") ?? "",
      integerAttribute(element, "Parent"),
      integerAttribute(element, "Mesh"),
      integerAttribute(element, "Layer"),
      integerList(attribute(element, "Materials")),
      numberList(attribute(element, "Location")),
      numberList(attribute(element, "Rotation")),
      numberList(attribute(element, "Scale"), [1, 1, 1]),
      booleanAttribute(element, "CastsShadow", true),
      parseCustomAttributes(attribute(element, "CustomAttributes")),
      element
    )),
    (root.child("Layers")?.childrenNamed("Layer") ?? []).map((element) => new Raw3DLayer(
      attribute(element, "Name") ?? "",
      integerAttribute(element, "Material"),
      element
    )),
    (root.child("Materials")?.childrenNamed("Material") ?? []).map((element) => new Raw3DMaterial(
      numberAttribute(element, "R", 0),
      numberAttribute(element, "G", 0),
      numberAttribute(element, "B", 0),
      numberAttribute(element, "A", 0),
      numberAttribute(element, "Reflectivity", 0),
      integerAttribute(element, "Texture"),
      integerAttribute(element, "NormalTexture"),
      numberAttribute(element, "NormalScale", 1),
      numberAttribute(element, "SU", 1),
      numberAttribute(element, "SV", 1),
      element
    )),
    textureElements.map((element, index) => new Raw3DTexture(
      attribute(element, "Path") ?? "",
      textureData[index],
      element
    )),
    (root.child("Meshes")?.childrenNamed("Mesh") ?? []).map((element) => new Raw3DMesh(
      integerAttribute(element, "VertexBuffer") ?? -1,
      integerList(attribute(element, "IndexBuffers")),
      element
    )),
    vertexBufferElements.map((element, index) => {
      let offset = 0;
      const attributes = element.childrenNamed("Attribute").map((attributeElement) => {
        const type = attribute(attributeElement, "Type") ?? "Vector3";
        const componentCount = vectorComponentCount(type);
        const result = new Raw3DVertexAttribute(
          attribute(attributeElement, "Usage") ?? "",
          type,
          componentCount,
          offset,
          attributeElement
        );
        offset += componentCount * 4;
        return result;
      });
      return new Raw3DVertexBuffer(
        attribute(element, "Path") ?? "",
        attributes,
        offset,
        vertexData[index],
        element
      );
    }),
    indexBufferElements.map((element, index) => new Raw3DIndexBuffer(
      attribute(element, "Path") ?? "",
      indexData[index],
      element
    ))
  );
}

function attribute(element: Demo3DXmlElement, name: string): string | undefined {
  return element.attributes.find((item) => item.localName === name)?.value;
}

function numberAttribute(element: Demo3DXmlElement, name: string, fallback: number): number {
  const parsed = Number.parseFloat(attribute(element, name) ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerAttribute(element: Demo3DXmlElement, name: string): number | undefined {
  const parsed = Number.parseInt(attribute(element, name) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanAttribute(element: Demo3DXmlElement, name: string, fallback: boolean): boolean {
  const value = attribute(element, name)?.toLowerCase();
  return value === undefined ? fallback : value !== "false" && value !== "0";
}

function numberList(value: string | undefined, fallback: readonly number[] = []): number[] {
  if (!value) {
    return [...fallback];
  }
  return value.trim().split(/\s+/).map(Number).filter(Number.isFinite);
}

function integerList(value: string | undefined): number[] {
  return numberList(value).map((item) => Math.trunc(item));
}

function vectorComponentCount(type: string): number {
  const match = /Vector([1-4])$/i.exec(type);
  return match ? Number.parseInt(match[1]!, 10) : 3;
}

function parseCustomAttributes(value: string | undefined): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  const parts = value?.split("|") ?? [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    if (parts[index]) {
      attributes.set(parts[index]!, parts[index + 1]!);
    }
  }
  return attributes;
}

function toEntryInfo(entry: ZipEntryInfo): ZipEntryInfo {
  return {
    name: entry.name,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    compressionMethod: entry.compressionMethod,
    flags: entry.flags,
    crc32: entry.crc32
  };
}

async function toResource(entry: ZipEntry): Promise<Demo3DResource> {
  return new Demo3DResource(entry.name, toEntryInfo(entry), await entry.arrayBuffer());
}
