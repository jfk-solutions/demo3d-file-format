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
    __demo3dRenderResult?: {
      status: string;
      backend?: "webgpu" | "webgl";
      enhancedGround?: boolean;
      fallback?: string;
      renderMode?: "standard" | "enhanced";
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
