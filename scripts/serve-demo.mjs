import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(".");
const requestedPage = normalize(process.argv.find((arg) => arg.endsWith(".html")) ?? "examples/three-render-smoke.html");
const requestedPort = readPort(process.argv) ?? 4173;
const pagePath = normalize(join(root, requestedPage));

if (!pagePath.startsWith(root + sep) || !existsSync(pagePath)) {
  console.error(`Cannot serve missing page: ${requestedPage}`);
  process.exit(1);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  const requestedPath = normalize(join(root, decodeURIComponent(url.pathname)));

  if (!requestedPath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  const filePath = requestedPath === root ? pagePath : requestedPath;

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
});

server.on("error", (error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
    server.listen(0, "127.0.0.1");
    return;
  }
  throw error;
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine server address.");
  }

  const url = `http://127.0.0.1:${address.port}/${requestedPage.replace(/\\/g, "/")}`;
  console.log(`Demo3D Three renderer demo: ${url}`);
  console.log("Press Ctrl+C to stop the server.");
});

function readPort(args) {
  const portArg = args.find((arg) => arg.startsWith("--port="));
  if (!portArg) {
    return undefined;
  }

  const value = Number.parseInt(portArg.slice("--port=".length), 10);
  return Number.isFinite(value) ? value : undefined;
}

function contentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
