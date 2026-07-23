import { decodeText, toUint8Array, type Demo3DInput } from "./binary.js";
import { Demo3DUnsupportedError, Demo3DZipError } from "./errors.js";
import { parseDemo3DXmlFast } from "./fast-xml.js";
import {
  Demo3DMesh,
  Demo3DPackage,
  Demo3DResource,
  extractProject,
  type Demo3DExternalMeshData
} from "./model.js";
import {
  defaultParseXml,
  type Demo3DXmlElement,
  type ParseXmlDocument,
  xmlDocumentToElement
} from "./xml.js";
import { parseZip, type ZipEntry, type ZipEntryInfo } from "./zip.js";

export interface ParseDemo3DOptions {
  readonly parseXml?: ParseXmlDocument;
  readonly xmlParser?: "fast" | "dom";
}

export async function parseDemo3D(input: Demo3DInput, options: ParseDemo3DOptions = {}): Promise<Demo3DPackage> {
  const bytes = toUint8Array(input);
  const archive = parseZip(bytes);
  const modelEntry = findModelEntry(archive.entries);
  const resourceEntries = archive.entries.filter((entry) => isResourceEntry(entry.name));
  const bufferEntries = archive.entries.filter((entry) => entry.name.toLowerCase().startsWith("buffers_md/"));
  const thumbnailEntry = archive.entries.find((entry) => entry.name.toLowerCase() === "thumbnail.png");
  const resourcePromises = new Map<string, Promise<Demo3DResource>>();
  const loadResource = (entry: ZipEntry): Promise<Demo3DResource> => {
    let promise = resourcePromises.get(entry.name);
    if (!promise) {
      promise = toResource(entry);
      resourcePromises.set(entry.name, promise);
    }
    return promise;
  };
  const resourcesPromise = Promise.all(resourceEntries.map(loadResource));
  const buffersPromise = Promise.all(bufferEntries.map(loadResource));
  const thumbnailPromise = thumbnailEntry ? loadResource(thumbnailEntry) : Promise.resolve(undefined);
  const modelBytes = await modelEntry.arrayBuffer();
  const modelXml = decodeText(modelBytes, "utf-8");
  const root = parseXmlElement(modelXml, options);
  const externalMeshes = await parseExternalMeshCache(archive.entries, options);
  const model = extractProject(root, externalMeshes);
  const [resources, buffers, thumbnail] = await Promise.all([
    resourcesPromise,
    buffersPromise,
    thumbnailPromise
  ]);

  return new Demo3DPackage(
    archive.entries.map(toEntryInfo),
    modelEntry.name,
    modelXml,
    model,
    thumbnail,
    resources,
    buffers
  );
}

function findModelEntry(entries: readonly ZipEntry[]): ZipEntry {
  const modelEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".demo3d"));
  const preferred = modelEntries.find((entry) => entry.uncompressedSize > 0 && entry.name.indexOf("/") === -1);
  const entry = preferred
    ?? modelEntries[0]
    ?? entries.find((candidate) => candidate.name.toLowerCase() === "model.xml");

  if (!entry) {
    throw new Demo3DZipError('No Demo3D project XML entry ("*.demo3d" or "Model.xml") was found in the package.');
  }

  if (entry.uncompressedSize === 0) {
    throw new Demo3DUnsupportedError(`Model entry "${entry.name}" is empty.`, "DEMO3D_EMPTY_MODEL");
  }

  return entry;
}

function parseXmlElement(xml: string, options: ParseDemo3DOptions): Demo3DXmlElement {
  return options.parseXml || options.xmlParser === "dom"
    ? xmlDocumentToElement((options.parseXml ?? defaultParseXml)(xml))
    : parseDemo3DXmlFast(xml);
}

async function parseExternalMeshCache(
  entries: readonly ZipEntry[],
  options: ParseDemo3DOptions
): Promise<Demo3DMesh[]> {
  const entryByPath = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
  const mapEntry = entryByPath.get("meshes/map.xml");
  if (!mapEntry) {
    return [];
  }

  const mapXml = decodeText(await mapEntry.arrayBuffer(), "utf-8");
  const root = parseXmlElement(mapXml, options);
  if (root.localName !== "MeshMap") {
    throw new Demo3DUnsupportedError(
      `External mesh map has unsupported root element "${root.name}".`,
      "DEMO3D_MESH_MAP_ROOT_UNSUPPORTED"
    );
  }

  const vertexDescriptors = root.child("Vertices")?.childrenNamed("VertexBuffer") ?? [];
  const indexDescriptors = root.child("Indices")?.childrenNamed("IndexBuffer") ?? [];
  const meshEntries = root.child("Meshes")?.childrenNamed("Mesh") ?? [];
  const requiredPaths = new Set<string>();
  for (const mesh of meshEntries) {
    const vertexIndex = integerAttribute(mesh, "VertexBuffer");
    const indexIndex = integerAttribute(mesh, "IndexBuffers");
    const sectionIndex = integerAttribute(mesh, "Sections");
    const vertexPath = vertexIndex === undefined ? undefined : attribute(vertexDescriptors[vertexIndex], "Path");
    const indexPath = indexIndex === undefined ? undefined : attribute(indexDescriptors[indexIndex], "Path");
    if (vertexPath) {
      requiredPaths.add(meshCachePath(vertexPath));
    }
    if (indexPath) {
      requiredPaths.add(meshCachePath(indexPath));
    }
    if (sectionIndex !== undefined) {
      requiredPaths.add(`meshes/s${sectionIndex}.dat`);
    }
  }

  const dataByPath = new Map<string, Uint8Array>();
  const paths = [...requiredPaths];
  const batchSize = 32;
  for (let offset = 0; offset < paths.length; offset += batchSize) {
    await Promise.all(paths.slice(offset, offset + batchSize).map(async (path) => {
      const entry = entryByPath.get(path.toLowerCase());
      if (entry) {
        dataByPath.set(path.toLowerCase(), await entry.arrayBuffer());
      }
    }));
  }

  const meshes: Demo3DMesh[] = [];
  for (const mesh of meshEntries) {
    const id = attribute(mesh, "Id");
    const vertexIndex = integerAttribute(mesh, "VertexBuffer");
    const indexIndex = integerAttribute(mesh, "IndexBuffers");
    const sectionIndex = integerAttribute(mesh, "Sections");
    const vertexDescriptor = vertexIndex === undefined ? undefined : vertexDescriptors[vertexIndex];
    const indexDescriptor = indexIndex === undefined ? undefined : indexDescriptors[indexIndex];
    const vertexPath = attribute(vertexDescriptor, "Path");
    const indexPath = attribute(indexDescriptor, "Path");
    const vertices = vertexPath ? dataByPath.get(meshCachePath(vertexPath).toLowerCase()) : undefined;
    const indices = indexPath ? dataByPath.get(meshCachePath(indexPath).toLowerCase()) : undefined;
    if (!id || !vertices) {
      continue;
    }

    const vertexFormat = externalVertexFormat(vertexDescriptor);
    const stride = externalVertexStride(vertexFormat);
    const vertexCount = Math.floor(vertices.byteLength / stride);
    const indexFormat = vertexCount > 0xffff ? "UInt32" : "UInt16";
    const sectionData = sectionIndex === undefined
      ? undefined
      : dataByPath.get(`meshes/s${sectionIndex}.dat`);
    const external: Demo3DExternalMeshData = {
      meshFormat: "TriangleList",
      vertexFormat,
      indexFormat,
      vertices,
      indices,
      auxiliary: indices && sectionData
        ? decodeExternalSubsets(sectionData, indices.byteLength, indexFormat)
        : undefined
    };
    meshes.push(new Demo3DMesh("e3d:Mesh", mesh, id, external));
  }
  return meshes;
}

function externalVertexFormat(descriptor: Demo3DXmlElement | undefined): string {
  const usages = descriptor?.childrenNamed("Attribute")
    .map((item) => attribute(item, "Usage")?.toLowerCase())
    .filter((item): item is string => Boolean(item)) ?? [];
  const hasNormal = usages.includes("normal");
  const hasTexture = usages.some((usage) => usage.includes("texture"));
  if (hasNormal && hasTexture) {
    return "PositionNormalTexture";
  }
  return hasNormal ? "PositionNormal" : "Position";
}

function externalVertexStride(vertexFormat: string): number {
  return vertexFormat === "PositionNormalTexture" ? 32 : vertexFormat === "PositionNormal" ? 24 : 12;
}

function decodeExternalSubsets(
  sections: Uint8Array,
  indexByteLength: number,
  indexFormat: string
): Uint8Array | undefined {
  const indexSize = indexFormat === "UInt32" ? 4 : 2;
  const faceCount = Math.floor(indexByteLength / indexSize / 3);
  if (faceCount === 0 || sections.byteLength < 8 || sections.byteLength % 8 !== 0) {
    return undefined;
  }

  const subsets = new Uint8Array(faceCount);
  const view = new DataView(sections.buffer, sections.byteOffset, sections.byteLength);
  for (let slot = 0; slot < sections.byteLength / 8; slot += 1) {
    const startFace = Math.floor(view.getUint32(slot * 8, true) / 3);
    const faceLength = Math.floor(view.getUint32(slot * 8 + 4, true) / 3);
    subsets.fill(Math.min(slot, 255), startFace, Math.min(faceCount, startFace + faceLength));
  }
  return subsets;
}

function meshCachePath(path: string): string {
  return `meshes/${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

function integerAttribute(element: Demo3DXmlElement | undefined, name: string): number | undefined {
  const value = attribute(element, name);
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

function attribute(element: Demo3DXmlElement | undefined, name: string): string | undefined {
  return element?.attributes.find((item) => item.localName === name)?.value;
}

function isResourceEntry(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.startsWith("userresources/") ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".bmp") ||
    lower.endsWith(".gif")
  );
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
