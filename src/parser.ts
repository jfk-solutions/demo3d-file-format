import { decodeText, toUint8Array, type Demo3DInput } from "./binary.js";
import { Demo3DUnsupportedError, Demo3DZipError } from "./errors.js";
import { parseDemo3DXmlFast } from "./fast-xml.js";
import { Demo3DPackage, Demo3DResource, extractProject } from "./model.js";
import { defaultParseXml, type ParseXmlDocument, xmlDocumentToElement } from "./xml.js";
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
  const root = options.parseXml || options.xmlParser === "dom"
    ? xmlDocumentToElement((options.parseXml ?? defaultParseXml)(modelXml))
    : parseDemo3DXmlFast(modelXml);
  const model = extractProject(root);
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

  if (modelEntries.length === 0) {
    throw new Demo3DZipError("No nested .demo3d XML model entry was found in the package.");
  }

  const preferred = modelEntries.find((entry) => entry.uncompressedSize > 0 && entry.name.indexOf("/") === -1);
  const entry = preferred ?? modelEntries[0];

  if (entry.uncompressedSize === 0) {
    throw new Demo3DUnsupportedError(`Model entry "${entry.name}" is empty.`, "DEMO3D_EMPTY_MODEL");
  }

  return entry;
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
