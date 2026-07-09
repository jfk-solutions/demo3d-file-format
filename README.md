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

When parsing outside the browser, pass `parseXml` if `DOMParser` is not available.

## Current Scope

- Read-only parser.
- Outer ZIP package parsing.
- Stored and DEFLATE ZIP entries.
- Full XML tree preservation.
- Core typed classes for project header, visuals, meshes, materials, resources, and unknown typed entries.
- Vendor-specific object types are preserved as `Demo3DUnknownObject` until explicit classes are added.
