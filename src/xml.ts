import { encodeBase64ToBytes } from "./binary.js";
import { Demo3DXmlError } from "./errors.js";

const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";

export interface Demo3DXmlAttribute {
  readonly name: string;
  readonly localName: string;
  readonly prefix: string | null;
  readonly namespaceUri: string | null;
  readonly value: string;
}

export type Demo3DScalarValue =
  | string
  | number
  | boolean
  | Demo3DBinaryBlock
  | readonly number[]
  | null;

export class Demo3DBinaryBlock {
  constructor(
    public readonly base64: string,
    private readonly bytes?: Uint8Array
  ) {}

  static fromBase64(base64: string): Demo3DBinaryBlock {
    return new Demo3DBinaryBlock(base64);
  }

  static fromBytes(bytes: Uint8Array): Demo3DBinaryBlock {
    return new Demo3DBinaryBlock("", bytes);
  }

  get byteLengthEstimate(): number {
    if (this.bytes) {
      return this.bytes.byteLength;
    }
    const cleanLength = this.base64.replace(/\s+/g, "").length;
    return Math.floor((cleanLength * 3) / 4);
  }

  toUint8Array(): Uint8Array {
    return this.bytes ?? encodeBase64ToBytes(this.base64);
  }
}

export class Demo3DXmlElement {
  constructor(
    public readonly name: string,
    public readonly localName: string,
    public readonly prefix: string | null,
    public readonly namespaceUri: string | null,
    public readonly path: string,
    public readonly attributes: readonly Demo3DXmlAttribute[],
    public readonly children: readonly Demo3DXmlElement[],
    public readonly text: string,
    public readonly xsiType: string | null,
    public readonly value: Demo3DScalarValue
  ) {}

  child(localName: string): Demo3DXmlElement | undefined {
    return this.children.find((child) => child.localName === localName);
  }

  childrenNamed(localName: string): Demo3DXmlElement[] {
    return this.children.filter((child) => child.localName === localName);
  }

  textOf(localName: string): string | undefined {
    return this.child(localName)?.text || undefined;
  }

  valueOf(localName: string): Demo3DScalarValue | undefined {
    return this.child(localName)?.value;
  }
}

export type ParseXmlDocument = (xml: string) => Document;

export function defaultParseXml(xml: string): Document {
  if (typeof DOMParser !== "function") {
    throw new Demo3DXmlError(
      "DOMParser is not available. Pass options.parseXml when parsing outside the browser.",
      "DEMO3D_DOMPARSER_UNAVAILABLE"
    );
  }

  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Demo3DXmlError(parserError.textContent ?? "Failed to parse Demo3D XML.");
  }

  return document;
}

export function xmlDocumentToElement(document: Document): Demo3DXmlElement {
  const root = document.documentElement;
  if (!root) {
    throw new Demo3DXmlError("Demo3D XML document has no root element.");
  }

  return xmlElementToObject(root, `/${root.localName || root.nodeName}`);
}

function xmlElementToObject(element: Element, path: string): Demo3DXmlElement {
  const attributes: Demo3DXmlAttribute[] = [];
  const sourceAttributes = element.attributes;
  for (let index = 0; index < sourceAttributes.length; index += 1) {
    const attribute = sourceAttributes.item(index);
    if (!attribute) {
      continue;
    }
    attributes.push({
      name: attribute.name,
      localName: attribute.localName || attribute.name,
      prefix: attribute.prefix,
      namespaceUri: attribute.namespaceURI,
      value: attribute.value
    });
  }

  const children: Demo3DXmlElement[] = [];
  let text = "";
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) {
      const child = node as Element;
      children.push(
        xmlElementToObject(child, `${path}/${child.localName || child.nodeName}[${children.length}]`)
      );
    } else if (node.nodeType === 3 || node.nodeType === 4) {
      text += node.nodeValue ?? "";
    }
  }
  text = text.trim();

  const xsiType = element.getAttributeNS(XSI_NAMESPACE, "type") ?? element.getAttribute("xsi:type");
  const localName = element.localName || element.nodeName;

  return new Demo3DXmlElement(
    element.nodeName,
    localName,
    element.prefix,
    element.namespaceURI,
    path,
    attributes,
    children,
    text,
    xsiType,
    coerceDemo3DXmlValue(localName, xsiType, text, children.length)
  );
}

export function coerceDemo3DXmlValue(
  localName: string,
  xsiType: string | null,
  text: string,
  childCount: number
): Demo3DScalarValue {
  if (childCount > 0) {
    return null;
  }

  if (text.length === 0) {
    return "";
  }

  if (xsiType === "xsd:Boolean" || xsiType === "xsd:boolean") {
    return text === "1" || text.toLowerCase() === "true";
  }

  if (xsiType === "xsd:int" || xsiType === "xsd:integer" || xsiType === "xsd:long") {
    const value = Number.parseInt(text, 10);
    return Number.isFinite(value) ? value : text;
  }

  if (
    xsiType === "xsd:double" ||
    xsiType === "xsd:float" ||
    xsiType === "e3d:DistanceProperty" ||
    xsiType === "e3d:AngleProperty" ||
    xsiType === "e3d:SpeedProperty"
  ) {
    const value = Number.parseFloat(text);
    return Number.isFinite(value) ? value : text;
  }

  if (localName === "LR" || localName === "ILR") {
    return text.split("|").filter(Boolean).map(Number).filter((value) => Number.isFinite(value));
  }

  if ((localName === "D" || localName === "A") && looksLikeBase64(text)) {
    return Demo3DBinaryBlock.fromBase64(text);
  }

  return text;
}

function looksLikeBase64(text: string): boolean {
  if (text.length < 4 || text.length % 4 !== 0) {
    return false;
  }

  return /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}
