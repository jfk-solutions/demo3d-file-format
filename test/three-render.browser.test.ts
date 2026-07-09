import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { test, expect } from "@playwright/test";

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

test.skip(!existsSync(samplePath), `Sample file does not exist: ${samplePath}`);

test("renders the supplied Demo3D file into a nonblank Three canvas", async ({ page }) => {
  await page.goto(`${baseUrl}/examples/three-render-smoke.html`);
  await page.locator("#demo3d-file").setInputFiles(samplePath);

  await page.waitForFunction(() => window.__demo3dRenderResult?.status === "rendered", null, {
    timeout: 120_000
  });

  const result = await page.evaluate(() => window.__demo3dRenderResult);
  expect(result.stats.meshes).toBeGreaterThan(0);
  expect(result.stats.geometries).toBeGreaterThan(0);
  expect(result.stats.serializedRenderables).toBeGreaterThan(0);
  expect(result.stats.textVisuals).toBeGreaterThan(0);
  expect(result.stats.textures).toBeGreaterThan(0);
  expect(result.stats.drawingBlocks).toBeGreaterThan(0);
  expect(result.stats.lines).toBeGreaterThan(0);

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
        Math.abs(red - 241) > 12 ||
        Math.abs(green - 243) > 12 ||
        Math.abs(blue - 244) > 12;
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
      stats: {
        meshes: number;
        geometries: number;
        textures: number;
        textVisuals: number;
        drawingBlocks: number;
        lines: number;
        serializedRenderables: number;
      };
      warnings?: number;
      message?: string;
    };
  }
}
