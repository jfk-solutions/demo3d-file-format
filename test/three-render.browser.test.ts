import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";
import { createZip, demo3d2026Fixture, demo3dXmlFixture } from "./helpers.js";

const samplePath = "D:/5801704_DE40_Kardex_Bauhaus_REV07neu3.demo3d";
const root = resolve(".");

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestedPath = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!requestedPath.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }

    const filePath = requestedPath.endsWith("\\") || requestedPath.endsWith("/")
      ? join(requestedPath, "index.html")
      : requestedPath;

    try {
      const file = await import("node:fs/promises").then((fs) => fs.readFile(filePath));
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(file);
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise<void>((resolveServer) => {
    server.listen(0, "127.0.0.1", resolveServer);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start static server.");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

test("plays and reversibly seeks native RAW3D animation in the standalone viewer", async ({ page }) => {
  const fixture = createZip([
    { name: "Model.xml", data: `<Scene><Nodes><Node Index="0" Name="Moving" Mesh="0" Materials="0"/></Nodes>
      <Materials><Material R="1" G="0" B="0"/></Materials><Meshes><Mesh VertexBuffer="0" IndexBuffers="0"/></Meshes>
      <VertexBuffers><VertexBuffer Path="v.dat"><Attribute Usage="Position" Type="Vector3"/></VertexBuffer></VertexBuffers>
      <IndexBuffers><IndexBuffer Path="i.dat" Format="Int16"/></IndexBuffers>
      <Updates><X Node="0" Time="0 2" Value="0 2"/><Visible Node="0" Time="0 1 2" Value="true false true"/></Updates></Scene>` },
    { name: "v.dat", data: new Uint8Array(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer) },
    { name: "i.dat", data: new Uint8Array(new Uint16Array([0,1,2]).buffer) }
  ]);
  await page.goto(pathToFileURL(join(root, "dist/examples/three-render-smoke-standalone.html")).href + "?renderer=webgl");
  await page.locator("#demo3d-file").setInputFiles({ name: "animation.raw3d", mimeType: "application/zip", buffer: Buffer.from(fixture) });
  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");
  await expect(page.locator("#animation-controls")).toBeVisible();
  const snapshot = () => page.evaluate(() => {
    const root = window.__exportDemo3DThreeSnapshot().object.object as unknown as { children: Array<{ matrix: number[]; children: Array<{ visible?: boolean }> }> };
    return { x: root.children[0]!.matrix[12], visible: root.children[0]!.children[0]!.visible !== false };
  });
  expect(await snapshot()).toEqual({ x: 0, visible: true });
  await page.locator("#animation-time").fill("1");
  expect(await snapshot()).toEqual({ x: 1, visible: false });
  await page.locator("#animation-time").fill("0");
  expect(await snapshot()).toEqual({ x: 0, visible: true });
  await page.locator("#animation-play").click();
  await expect.poll(() => page.locator("#animation-time").inputValue().then(Number)).toBeGreaterThan(.05);
  await page.locator("#animation-play").click();
});

test("renders native skinning and light shader parameters while replaying UI state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const fixture = createZip([
    { name: "Model.xml", data: `<Scene><Nodes><Node Index="0" Name="Joint"/>
      <Node Index="1" Name="Skin" Mesh="0" Materials="0"/></Nodes>
      <Buttons><UIButton Index="0" Name="Recorded action"/></Buttons>
      <Materials><Material R="1" G="0.4" B="0.2"/></Materials>
      <Meshes><Mesh VertexBuffer="0" IndexBuffers="0"><Bones><Bone Parent="0" SkinIndexBuffer="1" SkinWeightsVertexBuffer="1"/></Bones></Mesh></Meshes>
      <VertexBuffers><VertexBuffer Path="v.dat"><Attribute Usage="Position" Type="Vector3"/></VertexBuffer>
      <VertexBuffer Path="w.dat"><Attribute Usage="Position" Type="Single"/></VertexBuffer></VertexBuffers>
      <IndexBuffers><IndexBuffer Path="i.dat" Format="Int16"/><IndexBuffer Path="skin.dat" Format="Int16"/></IndexBuffers>
      <Lights><Light Index="0" Node="0" Type="Point" Enabled="true" AttenuationConstant="1" AttenuationQuadratic="0.2"/>
      <Light Index="1" Node="0" Type="Spot" Enabled="true" AttenuationConstant="1" SpotlightInnerAngle="0.5" SpotlightOuterAngle="1.5" SpotlightFalloff="2"/></Lights>
      <Updates><X Node="0" Time="0 2" Value="0 0.5"/><LightCS Light="1" Time="0 2" Value="false true"/>
      <UpdateUIChecked UIButton="0" Time="0 2" Value="false true"/></Updates></Scene>` },
    { name: "v.dat", data: new Uint8Array(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer) },
    { name: "w.dat", data: new Uint8Array(new Float32Array([1,1,1]).buffer) },
    { name: "i.dat", data: new Uint8Array(new Uint16Array([0,1,2]).buffer) },
    { name: "skin.dat", data: new Uint8Array(new Uint16Array([0,1,2]).buffer) }
  ]);
  await page.goto(pathToFileURL(join(root, "dist/examples/three-render-smoke-standalone.html")).href + "?renderer=webgl");
  await page.locator("#demo3d-file").setInputFiles({ name: "skin.raw3d", mimeType: "application/zip", buffer: Buffer.from(fixture) });
  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");
  await expect(page.locator('[data-native-button="0"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator("#animation-time").fill("2");
  await expect(page.locator('[data-native-button="0"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#animation-time").fill("0");
  expect(errors.filter(error => /shader|program|webgl|error/i.test(error))).toEqual([]);
});

for (const backend of ["webgl", "node-webgl", "webgpu"] as const) {
  test(`renders relief depth and native light attenuation through ${backend}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const vertex = new Float32Array([
      -1,-1,0, 0,0,1, 0,0, 1,-1,0, 0,0,1, 1,0,
      1,1,0, 0,0,1, 1,1, -1,1,0, 0,0,1, 0,1
    ]);
    const fixture = createZip([
      { name: "Model.xml", data: `<Scene><SceneProperties ShowDefaultFloor="false" UseDefaultLighting="false" AmbientLightColor="0.15 0.15 0.15"/>
        <Nodes><Node Index="0" Mesh="0" Materials="0"/><Node Index="1" Location="0 0 3" Rotation="0 3.14159265359 0"/></Nodes>
        <Materials><Material R="1" G="1" B="1" Texture="1" NormalTexture="0" NormalDepth="0.25"/></Materials>
        <Textures><Texture Path="normal.png"/><Texture Path="color.png"/></Textures>
        <Meshes><Mesh VertexBuffer="0" IndexBuffers="0"/></Meshes>
        <VertexBuffers><VertexBuffer Path="v"><Attribute Usage="Position" Type="Vector3"/><Attribute Usage="Normal" Type="Vector3"/><Attribute Usage="Texture" Type="Vector2"/></VertexBuffer></VertexBuffers>
        <IndexBuffers><IndexBuffer Path="i" Format="Int16"/></IndexBuffers>
        <Lights><Light Index="0" Node="1" Type="Point" Enabled="true" AttenuationConstant="1"/><Light Index="1" Node="1" Type="Spot" Enabled="true" AttenuationConstant="1" SpotlightInnerAngle="0.5" SpotlightOuterAngle="2.5" SpotlightFalloff="2"/></Lights>
        <Updates><Material Node="0" Name="NormalDepth" Time="0 1 2" Value="0 0.25 0.25"/><LightAC Light="0" Time="0 1 2" Value="1 1 6"/></Updates></Scene>` },
      { name: "v", data: new Uint8Array(vertex.buffer) },
      { name: "i", data: new Uint8Array(new Uint16Array([0,1,2,0,2,3]).buffer) }
    ]);
    await page.goto(`${baseUrl}/examples/three-render-smoke.html`);
    const result = await page.evaluate(async ({archive, backend}) => {
      const GPU = await import("three/webgpu");
      const GL = await import("three");
      const format = await import("../dist/index.js");
      const adapter = await import("../dist/three/index.js");
      if (backend === "webgpu") {
        const available = await (navigator as Navigator & {gpu?: {requestAdapter():Promise<unknown>}}).gpu?.requestAdapter();
        if (!available) return { unsupported: true };
      }
      const module = backend === "webgl" ? GL : GPU;
      const canvas = document.createElement("canvas");canvas.width = canvas.height = 160;document.body.append(canvas);
      const renderer = backend === "webgl" ? new GL.WebGLRenderer({canvas, preserveDrawingBuffer:true}) : new GPU.WebGPURenderer({canvas, forceWebGL:backend === "node-webgl"});
      if ("init" in renderer) { await renderer.init();await adapter.configureRaw3DWebGPURenderer(renderer, GPU); }
      renderer.setSize(160,160);
      const makeImage = (normal: boolean) => {
        const image = document.createElement("canvas");image.width = image.height = 16;
        const context = image.getContext("2d")!, pixels = context.createImageData(16,16);
        for (let y=0;y<16;y++) for (let x=0;x<16;x++) {
          const index=(y*16+x)*4;
          pixels.data.set(normal ? [128,128,255,128] : ((x+y)%4<2 ? [255,50,20,255] : [20,220,255,255]), index);
        }
        context.putImageData(pixels,0,0);
        return new Promise<Uint8Array>(resolve => image.toBlob(async blob => resolve(new Uint8Array(await blob!.arrayBuffer()))));
      };
      const images = {"normal.png":await makeImage(true), "color.png":await makeImage(false)};
      const parsed = await format.parseRaw3D(new Uint8Array(archive), {resolveResource:path => images[path as keyof typeof images]});
      const playback = await adapter.createRaw3DThreePlayback(parsed, {three:module});
      const scene = new module.Scene();scene.background = new module.Color(0x202020);scene.add(playback.group);
      const camera = new module.PerspectiveCamera(40,1,.1,50);camera.position.set(2,1,-3);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
      const pictures: string[] = [];
      for (const time of [0,1,2,0]) {
        playback.seek(time);renderer.render(scene,camera);pictures.push(canvas.toDataURL());
      }
      const state = { unsupported:false, pictures, warnings:playback.animation.warnings.length };
      playback.dispose();renderer.dispose();canvas.remove();return state;
    }, {archive:[...fixture],backend});
    test.skip(result.unsupported, "No WebGPU adapter is available.");
    expect(errors.filter(message => /shader|program|validation|error/i.test(message))).toEqual([]);
    expect(result.pictures![1]).not.toBe(result.pictures![0]);
    expect(result.pictures![2]).not.toBe(result.pictures![1]);
    expect(result.pictures![3]).toBe(result.pictures![0]);
  });
}

test("switches an already rendered scene to the enhanced mode", async ({ page }) => {
  const fixture = createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture, method: 8 }]);
  await page.goto(`${baseUrl}/examples/three-render-smoke.html`);
  await page.locator("#demo3d-file").setInputFiles({
    name: "fixture.demo3d",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture)
  });

  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");
  expect(await page.evaluate(() => window.__demo3dRenderResult?.renderMode)).toBe("standard");
  await expect(page.locator("#saved-view")).toHaveValue("Overview");
  await expect(page.locator("#saved-view option")).toHaveCount(2);

  await page.locator("#enhanced-render").check();

  await expect.poll(async () => page.evaluate(() => window.__demo3dRenderResult?.renderMode)).toBe("enhanced");
  expect(await page.locator("#enhanced-render").getAttribute("role")).toBe("switch");
  expect(await page.evaluate(() => window.__demo3dRenderResult?.enhancedGround)).toBe(true);
  await expect(page.locator("#status")).toContainText("enhanced mode");
  expect((await page.locator("#viewport").screenshot()).byteLength).toBeGreaterThan(1_000);
});

test("shows Demo3D layers and lets the viewer toggle them", async ({ page }) => {
  const fixture = createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture, method: 8 }]);
  await page.goto(`${baseUrl}/examples/three-render-smoke.html`);
  await page.locator("#demo3d-file").setInputFiles({
    name: "fixture.demo3d",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture)
  });

  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");
  await expect(page.locator("#layers-panel")).toBeVisible();
  await expect(page.locator("#layers-list .layer-toggle")).toHaveCount(2);
  await expect(page.locator("#layers-list .layer-toggle").filter({ hasText: "Main" }).locator("input")).toBeChecked();
  await expect(page.locator("#layers-list .layer-toggle").filter({ hasText: "Hidden" }).locator("input")).not.toBeChecked();

  await page.locator("#layers-list .layer-toggle").filter({ hasText: "Main" }).locator("input").uncheck();
  await expect(page.locator("#layers-list .layer-toggle").filter({ hasText: "Main" }).locator("input")).not.toBeChecked();
});

test("switches the camera to top and side views", async ({ page }) => {
  const fixture = createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture, method: 8 }]);
  await page.goto(`${baseUrl}/examples/three-render-smoke.html`);
  await page.locator("#demo3d-file").setInputFiles({
    name: "fixture.demo3d",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture)
  });

  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");
  await expect(page.locator("#top-view")).toBeEnabled();
  await expect(page.locator("#side-view")).toBeEnabled();
  await expect(page.locator("#view-cube")).toBeVisible();

  await page.locator("#top-view").click();
  await expect.poll(async () => page.evaluate(() => window.__demo3dRenderResult?.activeView)).toBe("top");
  expect((await page.locator("#viewport").screenshot()).byteLength).toBeGreaterThan(1_000);

  await page.locator("#side-view").click();
  await expect.poll(async () => page.evaluate(() => window.__demo3dRenderResult?.activeView)).toBe("side");
  expect((await page.locator("#viewport").screenshot()).byteLength).toBeGreaterThan(1_000);

  await page.locator('.view-cube-face[data-view="right"]').dblclick({ force: true });
  await expect.poll(async () => page.evaluate(() => window.__demo3dRenderResult?.activeView)).toBe("right");

  const cube = page.locator("#view-cube");
  const bounds = await cube.boundingBox();
  if (!bounds) throw new Error("Coordinate cube is not visible.");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 25, bounds.y + bounds.height / 2 + 15);
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => window.__demo3dRenderResult?.activeView)).toBe("custom");
});

test("runs the compiled standalone page directly from the file system", async ({ page }) => {
  const fixture = createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture, method: 8 }]);
  const standalonePath = join(root, "dist/examples/three-render-smoke-standalone.html");
  await page.goto(pathToFileURL(standalonePath).href);
  await page.locator("#demo3d-file").setInputFiles({
    name: "fixture.demo3d",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture)
  });

  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");
  expect(await page.evaluate(() => window.__demo3dRenderResult?.stats.meshes)).toBeGreaterThan(0);
  await page.locator("#enhanced-render").check();
  await expect.poll(async () => page.evaluate(() => window.__demo3dRenderResult?.renderMode)).toBe("enhanced");
  expect((await page.locator("#viewport").screenshot()).byteLength).toBeGreaterThan(1_000);
});

test("renders a Demo3D 2026 external mesh cache in the standalone page", async ({ page }) => {
  const standalonePath = join(root, "dist/examples/three-render-smoke-standalone.html");
  await page.goto(pathToFileURL(standalonePath).href);
  await page.locator("#demo3d-file").setInputFiles({
    name: "fixture-2026.demo3d",
    mimeType: "application/zip",
    buffer: Buffer.from(demo3d2026Fixture())
  });

  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");
  expect(await page.evaluate(() => window.__demo3dRenderResult?.stats)).toMatchObject({
    meshes: 1,
    geometries: 1,
    serializedRenderables: 1,
    missingGeometryPlaceholders: 0
  });
  expect((await page.locator("#viewport").screenshot()).byteLength).toBeGreaterThan(1_000);
});

test("renders a model embedded in the standalone viewer without a file picker", async ({ page }) => {
  const fixture = createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture, method: 8 }]);
  const standalonePath = join(root, "dist/examples/three-render-smoke-standalone.html");
  const template = await import("node:fs/promises").then((fs) => fs.readFile(standalonePath, "utf8"));
  const embedded = JSON.stringify({ name: "embedded.demo3d", data: Buffer.from(fixture).toString("base64") });

  await page.setContent(template.replace("__DEMO3D_EMBEDDED_MODEL__", embedded));
  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");

  await expect(page.locator("#demo3d-file")).toBeHidden();
  expect(await page.evaluate(() => window.__demo3dRenderResult?.stats.meshes)).toBeGreaterThan(0);
  expect((await page.locator("#viewport").screenshot()).byteLength).toBeGreaterThan(1_000);
});

test("exports and renders a Three.js-only snapshot without the Demo3D archive", async ({ page }) => {
  const fixture = createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture, method: 8 }]);
  const standalonePath = join(root, "dist/examples/three-render-smoke-standalone.html");
  const template = await import("node:fs/promises").then((fs) => fs.readFile(standalonePath, "utf8"));
  await page.goto(pathToFileURL(standalonePath).href);
  await page.locator("#demo3d-file").setInputFiles({
    name: "fixture.demo3d",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture)
  });
  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");

  const snapshot = await page.evaluate(() => window.__exportDemo3DThreeSnapshot());
  const snapshotJson = JSON.stringify(snapshot);
  expect(snapshot.format).toBe("demo3d-three-snapshot");
  expect(snapshot.object.object.type).toBe("Group");
  expect(snapshot.cameras).toHaveLength(2);
  expect(snapshot.cameras.map((camera: { role: string }) => camera.role)).toEqual(["current", "saved"]);
  expect(snapshotJson).not.toContain(Buffer.from(fixture).toString("base64"));
  expect(snapshotJson).not.toContain("Demo3DProject");

  await page.setContent(
    template.replace("__DEMO3D_EMBEDDED_THREE__", snapshotJson.replace(/</g, "\\u003c"))
  );
  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");

  await expect(page.locator("#demo3d-file")).toBeHidden();
  await expect(page.locator("#saved-view option")).toHaveCount(2);
  expect(await page.evaluate(() => window.__demo3dRenderResult?.source)).toBe("three-snapshot");
  expect(await page.evaluate(() => window.__demo3dRenderResult?.stats.meshes)).toBeGreaterThan(0);
  expect((await page.locator("#viewport").screenshot()).byteLength).toBeGreaterThan(1_000);
});

test("offers Three.js snapshot as an additional exporter mode", async ({ page }) => {
  const fixture = createZip([{ name: "fixture.demo3d", data: demo3dXmlFixture, method: 8 }]);
  const exporterPath = join(root, "dist/examples/export-embedded-viewer-standalone.html");
  await page.goto(pathToFileURL(exporterPath).href);
  await expect(page.locator('input[name="export-mode"][value="three"]')).toBeChecked();
  await page.locator("#model-file").setInputFiles({
    name: "fixture.demo3d",
    mimeType: "application/zip",
    buffer: Buffer.from(fixture)
  });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export").click()
  ]);
  expect(download.suggestedFilename()).toBe("fixture-three-viewer.html");
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("The exported viewer download was not saved.");
  const viewerHtml = await import("node:fs/promises").then((fs) => fs.readFile(downloadPath, "utf8"));
  expect(viewerHtml).toContain('"format":"demo3d-three-snapshot"');
  expect(viewerHtml).not.toContain(Buffer.from(fixture).toString("base64"));
  expect(viewerHtml).not.toContain("Demo3DProject");

  await page.setContent(viewerHtml);
  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered");
  expect(await page.evaluate(() => window.__demo3dRenderResult?.source)).toBe("three-snapshot");
});

test("renders the supplied Demo3D file into a nonblank Three canvas", async ({ page }) => {
  test.skip(!existsSync(samplePath), `Sample file does not exist: ${samplePath}`);
  await page.goto(`${baseUrl}/examples/three-render-smoke.html`);
  await page.locator("#demo3d-file").setInputFiles(samplePath);

  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered", null, {
    timeout: 120_000
  });

  const result = await page.evaluate(() => window.__demo3dRenderResult);
  expect(["webgpu", "webgl"]).toContain(result.backend);
  expect(result.stats.meshes).toBeGreaterThan(0);
  expect(result.stats.geometries).toBeGreaterThan(0);
  expect(result.stats.materials).toBeGreaterThan(10);
  expect(result.stats.serializedRenderables).toBeGreaterThan(0);
  expect(result.stats.textVisuals).toBeGreaterThan(0);
  expect(result.stats.textures).toBeGreaterThan(0);
  expect(result.stats.drawingBlocks).toBeGreaterThan(0);
  expect(result.stats.lines).toBeGreaterThan(0);
  expect(result.stats.directVisuals).toBeGreaterThan(0);
  expect(result.stats.proceduralBelts).toBe(33);
  expect(result.stats.proceduralSupportStands).toBeGreaterThan(0);
  expect(result.stats.proceduralConveyorSides).toBeGreaterThan(0);
  expect(result.stats.proceduralPhotoEyes).toBeGreaterThan(0);
  expect(result.stats.dimensions).toBeGreaterThan(0);
  expect(result.stats.imageVisuals).toBeGreaterThan(0);
  expect(result.stats.lights).toBeGreaterThan(0);
  expect(result.stats.missingGeometryPlaceholders).toBe(0);
  expect(result.renderMode).toBe("standard");

  const screenshot = await page.locator("#viewport").screenshot();
  expect(screenshot.byteLength).toBeGreaterThan(1_000);

  const hasNonBlankPixels = await page.evaluate(async () => {
    const canvas = document.querySelector("#viewport") as HTMLCanvasElement;
    const image = new Image();
    image.src = canvas.toDataURL("image/png");
    await image.decode();
    const scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return false;
    }
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const differsFromBackground =
        Math.abs(red - 49) > 12 ||
        Math.abs(green - 87) > 12 ||
        Math.abs(blue - 104) > 12;
      if (differsFromBackground) {
        return true;
      }
    }
    return false;
  });

  expect(hasNonBlankPixels).toBe(true);
});

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

declare global {
  interface Window {
    __exportDemo3DThreeSnapshot: () => {
      format: string;
      object: { object: { type: string } };
      cameras: Array<{ role: string }>;
    };
    __demo3dRenderResult?: {
      status: string;
      source?: "three-snapshot";
      backend?: "webgpu" | "webgl";
      enhancedGround?: boolean;
      fallback?: string;
      renderMode?: "standard" | "enhanced";
      activeView?: "top" | "bottom" | "side" | "right" | "left" | "front" | "back" | "custom";
      stats: {
        meshes: number;
        geometries: number;
        materials: number;
        textures: number;
        textVisuals: number;
        drawingBlocks: number;
        lines: number;
        directVisuals: number;
        proceduralBelts: number;
        proceduralSupportStands: number;
        proceduralConveyorSides: number;
        proceduralPhotoEyes: number;
        proceduralRollers: number;
        proceduralMotors: number;
        dimensions: number;
        unreconstructedProceduralVisuals: number;
        imageVisuals: number;
        lights: number;
        missingGeometryPlaceholders: number;
        serializedRenderables: number;
      };
      warnings?: number;
      message?: string;
    };
  }
}
