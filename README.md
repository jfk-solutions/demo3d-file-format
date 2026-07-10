# demo3d-file-format

Browser-first TypeScript parser for Demo3D/Emulate3D `.demo3d` project files.

The parser accepts an `ArrayBuffer`, `Uint8Array`, or `DataView`, reads the outer ZIP package, extracts the nested XML model document, and returns a lossless object structure with typed helpers for the pieces most useful to rendering adapters.

## Install

```sh
npm install
npm run build
```

## Usage

```ts
import { parseDemo3D } from "demo3d-file-format";

const file = input.files![0];
const parsed = await parseDemo3D(await file.arrayBuffer());

console.log(parsed.model.header.product);
console.log(parsed.model.meshes.length);
console.log(parsed.model.visuals.length);
```

Runtime code has no production dependencies and uses browser APIs only. ZIP method `8` entries are decompressed with `DecompressionStream("deflate-raw")`.

The default single-pass XML parser builds the Demo3D object tree directly, avoiding the time and memory cost of an intermediate browser DOM. For unusual XML inputs, callers can opt into the browser parser or inject another DOM implementation:

```ts
await parseDemo3D(bytes, { xmlParser: "dom" });
await parseDemo3D(bytes, { parseXml: customParseXml });
```

The fast parser supports the XML constructs used by Demo3D files but intentionally rejects document type declarations.

## Three Renderer Demo

The Three.js smoke demo must be opened through a local HTTP server, not directly through `file://`, because browsers block module imports from unique file origins.

```sh
npm run demo:three
```

Then open the printed `http://127.0.0.1:.../examples/three-render-smoke.html` URL and choose a `.demo3d` file.

The parser root remains independent of Three.js. Renderer features that require
procedural reconstruction are opt-in through the `demo3d-file-format/three`
subpath:

```ts
import { createDemo3DThreeGroup } from "demo3d-file-format/three";

const group = await createDemo3DThreeGroup(parsed, {
  renderProceduralBelts: true,
  renderProceduralRacks: true,
  renderProceduralSupportStands: true,
  renderProceduralConveyorSides: true,
  renderProceduralPhotoEyes: true,
  renderProceduralRollers: true,
  renderProceduralMotors: true,
  renderDimensions: true
});
```

`renderProceduralBelts` reconstructs `StraightBeltConveyor` and
`CurveBeltConveyor` surfaces, plus connector-shaped `InjectorBeltConveyor`
surfaces, from their serialized dimensions, cap types, connectors, and
surface/side materials. It also applies Demo3D's omitted default belt width and
diameter values. It defaults to `false`.

`renderProceduralRacks` reconstructs `RackVisual` uprights and struts from the
serialized bay, frame, visibility, spacing, and color properties. It defaults
to `false`.

`renderProceduralSupportStands` reconstructs visible `SupportStand` instances
from their serialized leg, foot, floor-plate, and cross-brace extrusion
profiles. If a file omits all four profiles because it uses Demo3D's defaults,
the renderer creates an approximate default two-leg stand with feet, floor
plates, and cross braces. Geometry is cached by profile and dimensions. It
defaults to `false`.

The other procedural options reconstruct serialized conveyor side profiles,
photo-eye bodies and beams, missing roller sets, approximate motor housings, and
dimension annotations. Roller generation is automatically suppressed when a
conveyor already contains serialized cylinder aspects. Cylinder aspects with an
`InnerRadius` are rendered as hollow full or partial annular geometry. Every
procedural option defaults to `false`.

Set `includeUnsupported: true` to receive deduplicated warnings for
script-generated visual types that contain neither serialized geometry nor the
dimensions required for an independent reconstruction.

Missing mesh references produce warnings but no invented geometry by default.
Set `showPlaceholders: true` only for diagnostics; placeholders are fixed-size
colored cubes and are not part of the Demo3D project. Procedural motor housings
are also approximate and remain disabled unless `renderProceduralMotors: true`
is explicitly requested.

Visuals on layers serialized with `Visible` set to `false` are omitted by
default, including inherited child-layer visibility. Set
`includeHiddenLayers: true` only when a tool needs to inspect hidden project
content.

### WebGPU With WebGL Fallback

Tools can lazily select a canvas renderer before creating the Demo3D scene. The
factory probes for a WebGPU adapter and imports `three/webgpu` only when one is
available. Otherwise, or when WebGPU initialization fails, it falls back to
WebGL:

```ts
import {
  createDemo3DThreeGroup,
  createDemo3DThreeRenderer
} from "demo3d-file-format/three";

const selected = await createDemo3DThreeRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance"
});
const group = await createDemo3DThreeGroup(parsed, {
  three: selected.three
});
const scene = new selected.three.Scene();
scene.add(group);
const camera = new selected.three.PerspectiveCamera(45, width / height, 0.1, 100000);

selected.renderer.render(scene, camera);
console.log(selected.backend); // "webgpu" or "webgl"
```

Always pass `selected.three` into the scene adapter so WebGPU materials and
lights come from the same Three.js module as the renderer. Set
`preferWebGPU: false` to force the existing `WebGLRenderer` path.

WebGPU can improve repeated rendering of complex scenes, but it does not speed
up archive/XML parsing and may have higher first-frame shader compilation cost.

## Current Scope

- Read-only parser.
- Outer ZIP package parsing.
- Stored and DEFLATE ZIP entries.
- Full XML tree preservation.
- Core typed classes for project header, visuals, meshes, materials, resources, and unknown typed entries.
- Vendor-specific object types are preserved as `Demo3DUnknownObject` until explicit classes are added.
