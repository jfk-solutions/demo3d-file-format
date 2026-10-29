# demo3d-file-format

Browser-first TypeScript parser and Three.js adapter for Demo3D/Emulate3D
`.demo3d` project files and render-ready `.raw3d` scene files.

The parser accepts an `ArrayBuffer`, `Uint8Array`, or `DataView`, reads the outer
ZIP package, extracts either the traditional nested XML model document or the
Demo3D 2026 `Model.xml`, and returns a lossless object structure with typed
helpers for the pieces most useful to rendering adapters. Demo3D 2026 external
geometry caches (`meshes/map.xml` with `v*.dat`, `i*.dat`, and `s*.dat`
buffers) are decoded automatically.

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

Saved project views are available through `parsed.model.views`; the name stored
in `parsed.model.defaultView` identifies the project's default view. Each view
contains its Demo3D `position` and `target` vectors. The included Three.js
viewer exposes these from its **Saved views** menu and opens the default view
automatically. RAW3D saved views are exposed as `parsed.model.views` as well.

RAW3D scenes use a separate, strongly typed API because their `Model.xml`, flat
node hierarchy, and external vertex/index buffers differ from the editable
Demo3D project schema:

```ts
import { parseRaw3D } from "demo3d-file-format";
import { createRaw3DThreeGroup } from "demo3d-file-format/three";

const parsed = await parseRaw3D(await file.arrayBuffer());
const group = await createRaw3DThreeGroup(parsed);

console.log(parsed.model.nodes.length);
console.log(parsed.model.meshes.length);
```

`parseRaw3D` reads `Model.xml`, `Thumbnail.png`, `Aspects.json`, textures, and
all referenced `v*.dat` and `i*.dat` buffers. The Three.js adapter preserves the
RAW3D node hierarchy, transforms, material assignments, texture coordinates,
submeshes, and shadow flags.

Runtime code has no production dependencies and uses browser APIs only. ZIP method `8` entries are decompressed with `DecompressionStream("deflate-raw")`.

## RAW3D animation without a renderer

The root package has no Three.js dependency. It reads animation channels and
samples native node state independently of any renderer, UI, or playback clock:

```ts
import { parseRaw3D } from "@jfk-solutions/demo3d-file-format";

const parsed = await parseRaw3D(await file.arrayBuffer());
const animation = parsed.model.animation; // Lazy, cached typed Updates parser.
console.log(animation.duration, animation.tracks, animation.warnings);
const states = animation.sample(1.25); // Absolute simulation seconds.
const node = animation.sampleNode(0, 1.25);
console.log(node.location, node.quaternion, node.layerIndex);
```

Supported tracks include position, rotation, scale, own-geometry visibility,
deletion, parent, mesh, layer, interaction mode, highlight, optimization metadata,
and material diffuse ARGB, texture offsets/scales, reflectivity, transparency,
luminosity, normal scale, and point size. Unknown tracks remain available through
their original XML and produce warnings; their timestamps still contribute to
the clip duration. Reading metadata does not execute its native behavior.
Invalid supported tracks fail explicitly. Duplicate key times select the last
value, and seeking before a first key restores the node's initial state.

`Raw3DInterpolationMode` matches the Emulate3D 2026 enum: `Default=0`, `None=1`,
`Linear=2`, `DualQuaternion=3`. `None` holds the previous key; `Linear` interpolates
numeric channels, with shortest-path angle interpolation. This library treats
`Default` as linear. Discrete properties and ARGB colors switch at key times.

`DualQuaternion` couples position and orientation using normalized dual-quaternion
linear blending (DLB). Scale stays separate. `quaternion` and `rotation` describe
the same sampled orientation in native coordinates. Transform keys are evaluated
on the union of the node's position/rotation key times. This original implementation
is derived from the mathematical representation and normalization in
[Kavan et al., Dual Quaternions for Rigid Transformation Blending (2006)](https://users.cs.utah.edu/~ladislav/kavan06dual/kavan06dual.pdf).
DLB follows a rigid screw path but is not constant-speed ScLERP. Exact parity
with Demo3D's interpolation variant/default policy has not yet been established.
No vendor or paper implementation code is copied.

Native node visibility, interpolation mode, highlight, user data, owner,
decal/billboard flags, material luminosity/offsets/point size, and scene floor,
lighting, ambient color and quality properties have typed accessors. Unknown XML
is still retained; these accessors do not imply full native shader, billboard,
decal, floor, interaction, or scripting behavior.

### Optional Three.js playback

Only the `/three` entry point binds the sampled state to Three.js objects:

```ts
import { createRaw3DThreePlayback } from "@jfk-solutions/demo3d-file-format/three";

const playback = await createRaw3DThreePlayback(parsed, { three: THREE });
scene.add(playback.group);
playback.seek(1.25);
renderer.render(scene, camera);
// The application owns its animation clock, play/pause, speed and looping.
scene.remove(playback.group);
playback.dispose();
```

The binding applies transforms, visibility, deletion, parenting, mesh swaps,
layer-material fallback, and supported material changes. It preserves explicit
node materials when a layer changes and isolates animated materials between
nodes. Structural groups stay enabled when only their own geometry is hidden.
Retired mesh samples are released, and `dispose()` releases owned GPU resources.
Playback does not run simulation scripts, physics, or PLC connections. Both
native bone/weight buffers and baked deforming mesh updates are supported.

The demo and generated standalone viewer offer Play/Pause and an absolute-time
slider for animated RAW3D files. Embedding the original RAW3D retains animation;
the source-protected Three.js snapshot export remains a static snapshot.

### Native effects, surfaces and skinning

Use `animation.sampleFrame(time)` for a complete renderer-independent frame:
`nodes`, `lights`, `buttons`, and `scene`. The same current frame is available as
`playback.state` after `seek()`. Extended tracks and original XML are exposed by
`animation.effects.tracks`.

- Material `Texture`, `NormalMap`/`NormalTexture` references switch discretely,
  including clearing a texture with a negative index. Referenced archive textures
  are preloaded even when they are only used by later animation keys. Color and
  normal textures are isolated per animated node and restored on backward seeks.
- Native light channels include `LightType`, `LightEnabled`, `LightMaterial`,
  `LightAR`, `LightAC`, `LightAL`, `LightAQ`, `LightSF`, `LightSIA`, `LightSOA`, and
  `LightCS`. Range, constant/linear/quadratic attenuation, total inner/outer cone
  angles, falloff and shadow flags are applied. WebGL hooks and the TSL node backend implement
  the distance/cone equations described in [Microsoft's Direct3D lighting
  documentation](https://learn.microsoft.com/en-us/windows/win32/direct3d9/attenuation-and-spotlight-factor).
  `evaluateRaw3DLightAttenuation()` exposes the same calculation without Three.js.
  Shadow rendering still requires the host renderer's shadow map to be enabled.
- `SceneShowDefaultFloor`, `SceneAllowTeleportOnDefaultFloor`,
  `SceneUseDefaultLighting`, and `ALR`/`ALG`/`ALB` update the sampled scene.
  The Three binding provides ambient/default light and a finite floor preview on
  the recorded plane. Teleport permission is metadata; browser navigation is a
  host concern. Host-added lighting remains under host control.
- Native button visibility and checked-state channels are sampled and displayed
  by the demo. Their original native serializer names `UpdateUIVisible` and
  `UpdateUIChecked`, as well as `UIVisible`/`UIChecked`, are accepted. Displayed
  buttons are read-only; the library does not execute their model actions.
- Unambiguous `UserData`/`ClientOwner` string keys are sampled as metadata. The
  native serializer joins string arrays with spaces without escaping boundaries.
  A single key may contain spaces; multi-key values with ambiguous boundaries
  remain in XML with `RAW3D_STRING_KEYS_AMBIGUOUS` instead of being guessed.
- The native `Default`, `FlatText`, and `PointCloud` material shader modes map to
  lit, unlit, and vertex-colored point rendering. Packed ARGB/byte/short vertex
  attributes retain their native strides. RAW3D material `A` is opacity; the
  public `transparency` property is its complement. This corrects older builds
  which inverted partially transparent native materials.
- Billboards orient their own drawable toward the render camera while leaving
  the node hierarchy intact. Decal flags apply depth bias and suppress depth
  writes on the provided surface geometry; no projection onto an unrelated mesh
  is invented.
- Mesh `Bones` expose driving scene-node references, bind offsets and native
  skin index/weight buffer references. `decodeRaw3DSkinInfluences()` validates and
  normalizes weights without a renderer. The Three adapter constructs GPU
  `SkinnedMesh`/`Skeleton` bindings for up to four influences per vertex. Larger
  influence sets use CPU skinning with positions, normals and tangents; no
  weights are discarded. Unweighted vertices retain their mesh position.

Native channel names, bone fields and shader enums have a checked-in fixture
generated by the installed Emulate3D 2026 SDK serializer. To regenerate it on
Windows, run `./scripts/generate-native-feature-fixture.ps1`; other platforms can
run the tests using the existing fixture without that proprietary SDK.
Synthetic rigs exercise GPU/CPU deformation, bind offsets and reversible seeks.
Comparison against a captured native skinned person remains a separate parity
check; the current Bauhaus recording contains baked human geometry.

### Lossless strings and external resources

Native string arrays lose their boundaries when values containing spaces are
joined into a single attribute. Supply authoritative keys from a sidecar through
the renderer-independent parser option:

```ts
const parsed = await parseRaw3D(bytes, {
  resolveStringKeys: ({ nodeIndex, property, times, encoded, xml }) => {
    return sidecar.lookup(nodeIndex, property, times); // string[] or undefined
  },
  resolveResource: async path => resources.get(path) // Uint8Array or undefined
});
```

The resolver runs for string tracks and must return one string per timestamp,
including empty values. Incorrect lengths/types fail explicitly. Archive entries
take precedence over `resolveResource`; no filesystem/network request is made
automatically. A library-side extension also accepts `<Values><Value>...</Value>
...</Values>` children, or `ValueEncoding="json"` with a JSON array in `Value`.
These extensions are explicit conventions for this reader, not a claim that the
native serializer emits them. The original XML stays available. Missing
authoritative data still produces `RAW3D_STRING_KEYS_AMBIGUOUS`; impossible
boundaries are not guessed.

`parsed.model.streamableTextures` exposes native index, ID, name, dimensions,
path and any archived/resolved image bytes. Material `StreamableTexture` selects
the corresponding image. For video, a live camera or a recorded frame sequence,
provide Three.js textures and use asynchronous seeking:

```ts
const playback = await createRaw3DThreePlayback(parsed, {
  three: THREE,
  resolveStreamTexture: async ({ index, time, source, signal }) => {
    return frames.textureAt(index, time, signal); // Texture or undefined
  }
});
await playback.seekAsync(2.5); // false if superseded by a newer seek
```

Resolvers receive clip time, stream metadata and an abort signal. A newer seek,
synchronous seek, or disposal cancels pending requests; stale responses never
replace newer imagery. Returned textures remain caller-owned. The player owns
only its clones. Returning `undefined` restores the archived fallback or clears
the unavailable frame and reports a warning. A synchronous `seek()` retains the
currently resolved stream image; use `seekAsync()` for frame-accurate seeking.
Missing video frames still need an external source; a file reader cannot
reconstruct imagery that was never recorded. No URL or camera is opened without
an explicit host resolver.

### Relief shading and the node renderer

`NormalDepth` drives layered parallax/relief UV ray marching with 32 layers and
five binary refinements in both the WebGL shader and TSL material paths. Heights
are read from the normal image's alpha channel by default; select a different
packed channel with `parallaxHeightChannel: "r" | "g" | "b" | "a"`. Opaque alpha
represents a flat top surface. Color and normal samples share the relief offset,
and animated depth updates are reversible. Depth controls texture-coordinate
displacement; this does not add geometry or alter silhouettes. A normal image
without height data cannot supply missing surface depth by itself. The height
packing and scale may need adjustment for a particular native export.

The renderer factory automatically registers native point/spot light nodes and
node materials with `WebGPURenderer`. Native attenuation, range and cone falloff
are calculated through TSL, which supports both the WebGPU and node-renderer
WebGL backends. Existing lights and materials outside the native binding keep
their standard behavior. For a manually constructed renderer, configure it
before creating RAW3D groups:

```ts
import * as THREE from "three/webgpu";
import { configureRaw3DWebGPURenderer } from "@jfk-solutions/demo3d-file-format/three";
await configureRaw3DWebGPURenderer(renderer, THREE);
```

Unbundled hosts must map `three/tsl` alongside `three/webgpu` to their matching
Three.js release. Node rendering code is loaded on demand; importing the parser
still loads no renderer. Browser tests compare visible relief and attenuation
changes plus backward restoration under WebGL and the TSL WebGL backend. The
hardware WebGPU case runs only when an adapter is available.

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

Then open the printed `http://127.0.0.1:.../examples/three-render-smoke.html` URL and choose a `.demo3d` or `.raw3d` file.

To create a single-file version that can be opened directly from the file
system without a server, run:

```bash
npm run build:test-page
```

Open `dist/examples/three-render-smoke-standalone.html`. Three.js,
OrbitControls, and the Demo3D parser/renderer are bundled into that HTML file;
only the `.demo3d` or `.raw3d` file selected by the user remains external. The
normal `npm run build` command also generates this standalone page.

### Export an Embedded Viewer

To create a standalone HTML viewer with one model embedded inside it, run:

```bash
npm run demo:export
```

Open the printed URL, choose either a `.demo3d` or `.raw3d` file, and select
an export mode:

- **Generated Three.js objects and cameras (source-protected)** is the default.
  It converts the
  model first and creates `<model>-three-viewer.html` containing only serialized
  Three.js objects, materials, geometry, textures, layer visibility, and
  cameras. The original archive, `Model.xml`, and other Demo3D project data are
  not included, so the source `.demo3d` file cannot be extracted from the
  exported viewer. Rendered mesh data necessarily remains inspectable in any
  browser-based viewer.
- **Original Demo3D/RAW3D file (lossless)** creates `<model>-viewer.html` with
  the original file embedded.

Select **Download viewer HTML** after choosing the mode. The downloaded page can
be opened directly with `file://` and presents the model immediately without a
file-open control. The exporter itself is also available as
`dist/examples/export-embedded-viewer-standalone.html` and can be opened
directly from the file system.

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

### Enhanced Render Mode

For a more presentation-ready view, apply the optional enhanced preset after
adding the parsed group to a scene. It enables soft shadows, marks opaque model
meshes as shadow casters/receivers, adds fitted key and fill lighting, and puts
a matte contact floor below the model:

```ts
import { applyDemo3DThreeRenderMode } from "demo3d-file-format/three";

const presentation = applyDemo3DThreeRenderMode({
  three: selected.three,
  renderer: selected.renderer,
  scene,
  object: group,
  mode: "enhanced"
});

// Remove the preset and restore the previous renderer and mesh settings.
presentation.dispose();
```

Use `mode: "standard"` for the lighter-weight lighting preset. The browser
smoke-test page includes a **Better render** switch for comparing both modes.

## Current Scope

- Read-only parser.
- Outer ZIP package parsing.
- Stored and DEFLATE ZIP entries.
- Full XML tree preservation.
- Core typed classes for project header, visuals, meshes, materials, resources, and unknown typed entries.
- Demo3D 2026 `Model.xml`, flat visual hierarchies, and external mesh caches.
- Vendor-specific object types are preserved as `Demo3DUnknownObject` until explicit classes are added.
- RAW3D `Model.xml` scene metadata and external geometry/texture resources.
- RAW3D Three.js rendering with source geometry shared across scene nodes.
