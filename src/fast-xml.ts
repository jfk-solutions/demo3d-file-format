import { Demo3DXmlError } from "./errors.js";
import {
  coerceDemo3DXmlValue,
  Demo3DXmlElement,
  type Demo3DXmlAttribute
} from "./xml.js";

const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

interface RawAttribute {
  readonly name: string;
  readonly value: string;
}

interface XmlFrame {
  readonly name: string;
  readonly localName: string;
  readonly prefix: string | null;
  readonly namespaceUri: string | null;
  readonly path: string;
  readonly attributes: readonly Demo3DXmlAttribute[];
  readonly xsiType: string | null;
  readonly namespaces?: Readonly<Record<string, string>>;
  readonly parent?: XmlFrame;
  readonly children: Demo3DXmlElement[];
  text: string;
}

export function parseDemo3DXmlFast(xml: string): Demo3DXmlElement {
  const stack: XmlFrame[] = [];
  let root: Demo3DXmlElement | undefined;
  let cursor = 0;

  while (cursor < xml.length) {
    const tagStart = xml.indexOf("<", cursor);
    if (tagStart < 0) {
      appendText(stack, decodeXmlEntities(xml.slice(cursor)));
      break;
    }

    if (tagStart > cursor) {
      appendText(stack, decodeXmlEntities(xml.slice(cursor, tagStart)));
    }

    if (xml.startsWith("<!--", tagStart)) {
      cursor = endDelimited(xml, tagStart + 4, "-->");
      continue;
    }
    if (xml.startsWith("<![CDATA[", tagStart)) {
      const end = xml.indexOf("]]>", tagStart + 9);
      if (end < 0) {
        throw new Demo3DXmlError("Unterminated XML CDATA section.");
      }
      if (stack.length > 0) {
        stack[stack.length - 1].text += xml.slice(tagStart + 9, end);
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", tagStart)) {
      cursor = endDelimited(xml, tagStart + 2, "?>");
      continue;
    }
    if (xml.startsWith("<!DOCTYPE", tagStart) || xml.startsWith("<!doctype", tagStart)) {
      throw new Demo3DXmlError("XML document type declarations are not supported by the fast parser.");
    }
    if (xml.startsWith("</", tagStart)) {
      const tagEnd = xml.indexOf(">", tagStart + 2);
      if (tagEnd < 0) {
        throw new Demo3DXmlError("Unterminated XML closing tag.");
      }
      const closingName = xml.slice(tagStart + 2, tagEnd).trim();
      const frame = stack.pop();
      if (!frame || frame.name !== closingName) {
        throw new Demo3DXmlError(`Unexpected XML closing tag </${closingName}>.`);
      }
      root = finishFrame(frame, stack, root);
      cursor = tagEnd + 1;
      continue;
    }
    if (xml.startsWith("<!", tagStart)) {
      throw new Demo3DXmlError("Unsupported XML declaration in Demo3D model.");
    }

    const tagEnd = findTagEnd(xml, tagStart + 1);
    let tag = xml.slice(tagStart + 1, tagEnd);
    const selfClosing = tag.trimEnd().endsWith("/");
    if (selfClosing) {
      tag = tag.trimEnd().slice(0, -1);
    }

    const parent = stack[stack.length - 1];
    const frame = createFrame(tag, parent);
    if (selfClosing) {
      root = finishFrame(frame, stack, root);
    } else {
      stack.push(frame);
    }
    cursor = tagEnd + 1;
  }

  if (stack.length > 0) {
    throw new Demo3DXmlError(`Unclosed XML element <${stack[stack.length - 1].name}>.`);
  }
  if (!root) {
    throw new Demo3DXmlError("Demo3D XML document has no root element.");
  }
  return root;
}

function createFrame(tag: string, parent: XmlFrame | undefined): XmlFrame {
  let cursor = skipWhitespace(tag, 0);
  const nameStart = cursor;
  while (cursor < tag.length && !isWhitespace(tag.charCodeAt(cursor))) {
    cursor += 1;
  }
  const name = tag.slice(nameStart, cursor);
  if (!name) {
    throw new Demo3DXmlError("XML element has no name.");
  }

  const rawAttributes: RawAttribute[] = [];
  while (cursor < tag.length) {
    cursor = skipWhitespace(tag, cursor);
    if (cursor >= tag.length) {
      break;
    }
    const attributeStart = cursor;
    while (cursor < tag.length && !isWhitespace(tag.charCodeAt(cursor)) && tag[cursor] !== "=") {
      cursor += 1;
    }
    const attributeName = tag.slice(attributeStart, cursor);
    cursor = skipWhitespace(tag, cursor);
    if (tag[cursor] !== "=") {
      throw new Demo3DXmlError(`XML attribute ${attributeName} has no value.`);
    }
    cursor = skipWhitespace(tag, cursor + 1);
    const quote = tag[cursor];
    if (quote !== '"' && quote !== "'") {
      throw new Demo3DXmlError(`XML attribute ${attributeName} is not quoted.`);
    }
    const valueEnd = tag.indexOf(quote, cursor + 1);
    if (valueEnd < 0) {
      throw new Demo3DXmlError(`XML attribute ${attributeName} is unterminated.`);
    }
    rawAttributes.push({ name: attributeName, value: decodeXmlEntities(tag.slice(cursor + 1, valueEnd)) });
    cursor = valueEnd + 1;
  }

  let namespaces: Record<string, string> | undefined;
  for (const attribute of rawAttributes) {
    if (attribute.name === "xmlns") {
      (namespaces ??= {})[""] = attribute.value;
    } else if (attribute.name.startsWith("xmlns:")) {
      (namespaces ??= {})[attribute.name.slice(6)] = attribute.value;
    }
  }

  const [prefix, localName] = splitName(name);
  const namespaceUri = resolveNamespace(prefix ?? "", namespaces, parent);
  const attributes = rawAttributes.map((attribute): Demo3DXmlAttribute => {
    const [attributePrefix, attributeLocalName] = splitName(attribute.name);
    const attributeNamespace = attribute.name === "xmlns" || attributePrefix === "xmlns"
      ? XMLNS_NAMESPACE
      : attributePrefix
        ? resolveNamespace(attributePrefix, namespaces, parent)
        : null;
    return {
      name: attribute.name,
      localName: attributeLocalName,
      prefix: attributePrefix,
      namespaceUri: attributeNamespace,
      value: attribute.value
    };
  });
  const xsiType = attributes.find(
    (attribute) => attribute.localName === "type" && attribute.namespaceUri === XSI_NAMESPACE
  )?.value ?? attributes.find((attribute) => attribute.name === "xsi:type")?.value ?? null;
  const path = parent
    ? `${parent.path}/${localName}[${parent.children.length}]`
    : `/${localName}`;

  return {
    name,
    localName,
    prefix,
    namespaceUri,
    path,
    attributes,
    xsiType,
    namespaces,
    parent,
    children: [],
    text: ""
  };
}

function finishFrame(
  frame: XmlFrame,
  stack: readonly XmlFrame[],
  currentRoot: Demo3DXmlElement | undefined
): Demo3DXmlElement | undefined {
  const text = frame.text.trim();
  const element = new Demo3DXmlElement(
    frame.name,
    frame.localName,
    frame.prefix,
    frame.namespaceUri,
    frame.path,
    frame.attributes,
    frame.children,
    text,
    frame.xsiType,
    coerceDemo3DXmlValue(frame.localName, frame.xsiType, text, frame.children.length)
  );
  const parent = stack[stack.length - 1];
  if (parent) {
    parent.children.push(element);
    return currentRoot;
  }
  if (currentRoot) {
    throw new Demo3DXmlError("Demo3D XML document has multiple root elements.");
  }
  return element;
}

function appendText(stack: readonly XmlFrame[], value: string): void {
  if (stack.length > 0) {
    stack[stack.length - 1].text += value;
  } else if (value.trim().length > 0) {
    throw new Demo3DXmlError("Unexpected text outside the XML root element.");
  }
}

function resolveNamespace(
  prefix: string,
  own: Readonly<Record<string, string>> | undefined,
  parent: XmlFrame | undefined
): string | null {
  if (prefix === "xml") {
    return XML_NAMESPACE;
  }
  if (own?.[prefix] !== undefined) {
    return own[prefix];
  }
  for (let frame = parent; frame; frame = frame.parent) {
    if (frame.namespaces?.[prefix] !== undefined) {
      return frame.namespaces[prefix];
    }
  }
  return null;
}

function splitName(name: string): [string | null, string] {
  const separator = name.indexOf(":");
  return separator < 0 ? [null, name] : [name.slice(0, separator), name.slice(separator + 1)];
}

function findTagEnd(xml: string, start: number): number {
  let quote = "";
  for (let cursor = start; cursor < xml.length; cursor += 1) {
    const character = xml[cursor];
    if (quote) {
      if (character === quote) {
        quote = "";
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor;
    }
  }
  throw new Demo3DXmlError("Unterminated XML opening tag.");
}

function endDelimited(xml: string, start: number, delimiter: string): number {
  const end = xml.indexOf(delimiter, start);
  if (end < 0) {
    throw new Demo3DXmlError(`Unterminated XML ${delimiter} section.`);
  }
  return end + delimiter.length;
}

function skipWhitespace(value: string, cursor: number): number {
  while (cursor < value.length && isWhitespace(value.charCodeAt(cursor))) {
    cursor += 1;
  }
  return cursor;
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function decodeXmlEntities(value: string): string {
  if (!value.includes("&")) {
    return value;
  }
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    switch (entity) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const codePoint = entity.startsWith("#x")
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
        return String.fromCodePoint(codePoint);
      }
    }
  });
}
