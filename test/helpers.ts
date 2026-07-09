import { DOMParser } from "@xmldom/xmldom";
import { deflateRawSync } from "node:zlib";

export function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserErrors = document.getElementsByTagName("parsererror");
  if (parserErrors.length > 0) {
    throw new Error(parserErrors[0]?.textContent ?? "XML parse failed");
  }
  return document as unknown as Document;
}

export interface TestZipEntry {
  readonly name: string;
  readonly data: Uint8Array | string;
  readonly method?: 0 | 8;
  readonly flags?: number;
}

export function createZip(entries: readonly TestZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 0;
    const flags = entry.flags ?? 0x0800;
    const name = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const raw = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data);
    const compressed = method === 8 ? deflateRawSync(raw) : raw;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);

    localOffset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const body = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  eocd.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([body, centralDirectory, eocd]));
}

export const demo3dXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <e3d:Header xsi:type="e3d:DocumentHeader">
    <Id>project-id</Id>
    <Locale>English (United States)</Locale>
    <Product>Demo3D</Product>
    <Version>18.3.0.53</Version>
    <Edition>Emulate3D</Edition>
  </e3d:Header>
  <MeshLibrary>
    <Meshes>
      <e xsi:type="e3d:DictionaryEntry">
        <key xsi:type="e3d:MeshReference"><Id>mesh-1</Id></key>
        <val xsi:type="e3d:Mesh">
          <MeshData>
            <MF xsi:type="Demo3D.Renderers.Meshes.MeshFormat">TriangleList</MF>
            <V>
              <VF xsi:type="Demo3D.Renderers.Meshes.VertexFormat">PositionNormal</VF>
              <D>AAAAAA==</D>
            </V>
            <I>
              <IF xsi:type="Demo3D.Renderers.Meshes.IndexFormat">UInt16</IF>
              <D>AQACAA==</D>
            </I>
            <A>AAAAAA==</A>
          </MeshData>
          <Name>Fixture Mesh</Name>
        </val>
      </e>
    </Meshes>
  </MeshLibrary>
  <C>
    <e xsi:type="e3d:BoxVisual">
      <Id>visual-1</Id>
      <N>Box 1</N>
      <LR>|1|2|3|</LR>
      <P xsi:type="e3d:BoxProperties">
        <Material xsi:type="e3d:MeshMaterialProperty">
          <MeshMaterial xsi:type="e3d:MeshMaterial">
            <Diffuse>-16744448</Diffuse>
          </MeshMaterial>
        </Material>
        <VendorThing xsi:type="Vendor.CustomThing"><Value xsi:type="xsd:int">42</Value></VendorThing>
      </P>
      <C>
        <e xsi:type="e3d:SphereVisual"><Id>visual-2</Id><N>Child</N></e>
      </C>
    </e>
  </C>
</e3d:Demo3DProject>`;
