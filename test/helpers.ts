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
              <D>AAAAAAAAAAAAAAAAAAAAAAAAgD8AAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAA</D>
            </V>
            <I>
              <IF xsi:type="Demo3D.Renderers.Meshes.IndexFormat">UInt16</IF>
              <D>AAABAAIA</D>
            </I>
            <A>AAAAAA==</A>
          </MeshData>
          <Name>Fixture Mesh</Name>
        </val>
      </e>
    </Meshes>
  </MeshLibrary>
  <LayerLibrary>
    <Layers>
      <e xsi:type="e3d:DictionaryEntry">
        <key xsi:type="xsd:string">Main</key>
        <val xsi:type="e3d:Layer">
          <Color>-65536</Color>
          <LayerPresets><KT>System.String</KT><VT>System.Boolean</VT><C>
            <e xsi:type="e3d:DictionaryEntry"><key xsi:type="xsd:string">Presentation</key><val xsi:type="xsd:Boolean">0</val></e>
          </C></LayerPresets>
          <Name>Main</Name>
        </val>
      </e>
      <e xsi:type="e3d:DictionaryEntry">
        <key xsi:type="xsd:string">Hidden</key>
        <val xsi:type="e3d:Layer"><Name>Hidden</Name><Visible>0</Visible></val>
      </e>
    </Layers>
  </LayerLibrary>
  <C>
    <e xsi:type="e3d:BoxVisual">
      <Id>visual-1</Id>
      <N>Box 1</N>
      <LR>|1|2|3|</LR>
      <P xsi:type="e3d:BoxProperties">
        <Layer>Main</Layer>
        <Mesh><Id>mesh-1</Id></Mesh>
        <Material xsi:type="e3d:MeshMaterialProperty">
          <MeshMaterial xsi:type="e3d:MeshMaterial">
            <Diffuse>-16744448</Diffuse>
            <Texture><Id>texture-1</Id></Texture>
          </MeshMaterial>
        </Material>
        <VendorThing xsi:type="Vendor.CustomThing"><Value xsi:type="xsd:int">42</Value></VendorThing>
      </P>
      <C>
        <e xsi:type="e3d:SphereVisual">
          <Id>visual-2</Id><N>Child</N>
          <P><Material><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-65536</Diffuse></MeshMaterial></Material></P>
        </e>
      </C>
    </e>
  </C>
</e3d:Demo3DProject>`;

export const supportStandXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:StraightRollerConveyor">
      <Id>conveyor-1</Id><N>Conveyor</N>
      <P xsi:type="e3d:StraightRollerConveyorProperties"><RollerWidth>0.4</RollerWidth></P>
      <C>
        <e xsi:type="e3d:SupportStand">
          <Id>support-definition</Id><N>SU-W420-UH1400</N>
          <P xsi:type="e3d:SupportStandProperties"><Visible>0</Visible></P>
        </e>
        <e xsi:type="e3d:SupportStand">
          <Id>support-visible</Id><N>SupportStandRM8841 42</N>
          <P xsi:type="e3d:SupportStandProperties">
            <AddCrossBraceAtHeight><e xsi:type="xsd:double">0.4</e><e xsi:type="xsd:double">0.8</e></AddCrossBraceAtHeight>
            <ConveyorOffset>|-0.1|-0.05</ConveyorOffset>
            <CrossBraceMaterial>-15724266</CrossBraceMaterial>
            <CrossBraceProfile>${supportProfileXml("CrossBrace", 0.02, 0.06)}</CrossBraceProfile>
            <FloorPlateHeight>0.01</FloorPlateHeight>
            <FloorPlateMaterial>-15724266</FloorPlateMaterial>
            <FloorPlateProfile>${supportProfileXml("FloorPlate", 0.08, 0.16)}</FloorPlateProfile>
            <FootHeight>0.2</FootHeight>
            <FootMaterial>-15724266</FootMaterial>
            <FootProfile>${supportProfileXml("Foot", 0.05, 0.09)}</FootProfile>
            <LegMaterial>-15724266</LegMaterial>
            <LegProfile>${supportProfileXml("Leg", 0.04, 0.08)}</LegProfile>
          </P>
        </e>
      </C>
    </e>
  </C>
</e3d:Demo3DProject>`;

export const generatedObjectsXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:e3d="uri://emulate3d.com">
  <C>
    <e xsi:type="e3d:StraightRollerConveyor">
      <Id>conveyor-1</Id><N>Generated conveyor</N><LR>1|0|2|||</LR>
      <P xsi:type="e3d:StraightRollerConveyorProperties">
        <Length>2</Length><Width>0.5</Width><RollerWidth>0.5</RollerWidth>
        <RollerDiameter>0.1</RollerDiameter><RollerPitch>0.25</RollerPitch><CenterVisible>0</CenterVisible>
        <RollerColor>-8355712</RollerColor>
        <LeftSide xsi:type="e3d:ConveyorSideProperties">
          <SideVisible>1</SideVisible><Profile>${conveyorSideProfileXml("Left")}</Profile>
        </LeftSide>
        <RightSide xsi:type="e3d:ConveyorSideProperties">
          <SideVisible>1</SideVisible><Profile>${conveyorSideProfileXml("Right")}</Profile>
        </RightSide>
        <MotorVisual><Type>e3d:ConveyorVisual</Type></MotorVisual>
      </P>
      <C>
        <e xsi:type="e3d:PhotoEye">
          <Id>photo-eye-1</Id><N>PE1</N><LR>0.6|0|0|||</LR>
          <P xsi:type="e3d:SensorWithScriptProperties">
            <BeamHeight>0.04</BeamHeight><BeamAngle>10</BeamAngle>
            <BoxMaterial>-13676721</BoxMaterial><ClearedMaterial>-23296</ClearedMaterial>
          </P>
          <AS><E>sensor-aspect-1</E></AS>
        </e>
      </C>
    </e>
  </C>
  <SerializedObjects>
    <E xsi:type="e3d:SensorSymbolAspect"><Id>sensor-aspect-1</Id><SymbolSide>Left</SymbolSide></E>
    <E xsi:type="e3d:DimensionAspect">
      <Id>dimension-1</Id>
      <ArrowsInside>1</ArrowsInside><Depth>0.02</Depth><FlipText>0</FlipText><LockDirection>1</LockDirection>
      <StartPoint><Point>0|0|0</Point><Visual xsi:type="e3d:VisualReference"><Id>conveyor-1</Id></Visual></StartPoint>
      <EndPoint><Point>2|0|0</Point><Visual xsi:type="e3d:VisualReference"><Id>conveyor-1</Id></Visual></EndPoint>
      <DimensionDirection><Normal>1|0|0</Normal></DimensionDirection>
      <ExtensionDirection><Normal>0|1|0</Normal></ExtensionDirection>
      <Height>0.3</Height>
      <Format>{0:0.##} {1}</Format><Unit xsi:type="e3d:DimensionUnit">Default</Unit>
      <StartArrow>${dimensionArrowProfileXml()}</StartArrow><EndArrow>${dimensionArrowProfileXml()}</EndArrow>
      <Material><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-65536</Diffuse></MeshMaterial></Material>
    </E>
  </SerializedObjects>
</e3d:Demo3DProject>`;

export const annularCylinderXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:Visual"><Id>ring-visual</Id><N>Ring sector</N><AS><E>ring-aspect</E></AS></e></C>
  <SerializedObjects>
    <E xsi:type="e3d:CylinderRendererAspect"><Id>ring-aspect</Id><Renderables><E>
      <Id>ring-renderable</Id><Length>0.2</Length><Radius>1</Radius><InnerRadius>0.75</InnerRadius>
      <RadiusRatio>1</RadiusRatio><ConeRatio>1</ConeRatio><Slices>24</Slices><Angle>135</Angle><StartAngle>-90</StartAngle>
      <MaterialProperties><e><MeshMaterial xsi:type="e3d:MeshMaterial"><Diffuse>-16744448</Diffuse></MeshMaterial></e></MaterialProperties>
      <MeshReference><Id>primitive-ring-template</Id></MeshReference>
    </E></Renderables></E>
  </SerializedObjects>
</e3d:Demo3DProject>`;

export const rollerAspectConveyorXmlFixture = `<e3d:Demo3DProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:e3d="uri://emulate3d.com">
  <C><e xsi:type="e3d:StraightRollerConveyor"><Id>conveyor-with-rollers</Id><N>Serialized rollers</N>
    <P xsi:type="e3d:StraightRollerConveyorProperties"><Length>1</Length><RollerWidth>0.4</RollerWidth><RollerDiameter>0.05</RollerDiameter><RollerPitch>0.1</RollerPitch></P>
    <C><e xsi:type="e3d:Visual"><Id>roller-1</Id><N>Roller</N><AS><E>roller-aspect</E></AS></e></C>
  </e></C>
  <SerializedObjects><E xsi:type="e3d:CylinderRendererAspect"><Id>roller-aspect</Id><Renderables><E>
    <Length>0.4</Length><Radius>0.025</Radius><Slices>12</Slices><Angle>360</Angle>
    <MeshReference><Id>primitive-cylinder-template</Id></MeshReference>
  </E></Renderables></E></SerializedObjects>
</e3d:Demo3DProject>`;

function conveyorSideProfileXml(name: string): string {
  return `<Name>${name}</Name><Polygons><e xsi:type="e3d:ExtrusionPolygon"><Points>
    <e xsi:type="e3d:Vector2">-0.015|-0.08</e><e xsi:type="e3d:Vector2">0.015|-0.08</e>
    <e xsi:type="e3d:Vector2">0.015|0</e><e xsi:type="e3d:Vector2">-0.015|0</e>
  </Points><M>
    <e xsi:type="e3d:MeshMaterial"><Diffuse>-8355712</Diffuse></e>
    <e xsi:type="e3d:MeshMaterial"><Diffuse>-65536</Diffuse></e>
    <e xsi:type="e3d:MeshMaterial"><Diffuse>-8355712</Diffuse></e>
    <e xsi:type="e3d:MeshMaterial"><Diffuse>-8355712</Diffuse></e>
  </M></e></Polygons><Anchor>0|0</Anchor>`;
}

function dimensionArrowProfileXml(): string {
  return `<Name>Arrow</Name><Polygons><e xsi:type="e3d:ExtrusionPolygon"><Points>
    <e xsi:type="e3d:Vector2"></e><e xsi:type="e3d:Vector2">0.04|-0.08</e>
    <e xsi:type="e3d:Vector2">-0.04|-0.08</e>
  </Points><M><e xsi:type="e3d:MeshMaterial"><Diffuse>-65536</Diffuse></e></M></e></Polygons><Anchor>0|0</Anchor>`;
}

function supportProfileXml(name: string, width: number, depth: number): string {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return `<Name>${name}</Name><Polygons><e xsi:type="e3d:ExtrusionPolygon">
    <Points>
      <e xsi:type="e3d:Vector2">${-halfWidth}|${-halfDepth}</e>
      <e xsi:type="e3d:Vector2">${halfWidth}|${-halfDepth}</e>
      <e xsi:type="e3d:Vector2">${halfWidth}|${halfDepth}</e>
      <e xsi:type="e3d:Vector2">${-halfWidth}|${halfDepth}</e>
    </Points>
    <M><e xsi:type="e3d:MeshMaterial"><Diffuse>-15724266</Diffuse></e></M>
    <IgnoreCutouts>0</IgnoreCutouts>
  </e></Polygons><Anchor>0|0</Anchor>`;
}
