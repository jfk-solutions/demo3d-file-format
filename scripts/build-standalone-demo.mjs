import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const sourcePath = resolve("examples/three-render-smoke.html");
const outputPath = resolve("dist/examples/three-render-smoke-standalone.html");
const exporterSourcePath = resolve("examples/export-embedded-viewer.html");
const exporterOutputPath = resolve("dist/examples/export-embedded-viewer-standalone.html");
const sourceHtml = await readFile(sourcePath, "utf8");
const moduleScriptPattern = /<script\s+type=["']module["']>([\s\S]*?)<\/script>/i;
const importMapPattern = /\s*<script\s+type=["']importmap["']>[\s\S]*?<\/script>\s*/i;
const moduleScript = sourceHtml.match(moduleScriptPattern)?.[1];

if (!moduleScript) {
  throw new Error(`Could not find the inline module script in ${sourcePath}.`);
}

const result = await build({
  bundle: true,
  format: "iife",
  minify: true,
  platform: "browser",
  target: "es2022",
  write: false,
  stdin: {
    contents: moduleScript,
    loader: "js",
    resolveDir: dirname(sourcePath),
    sourcefile: "three-render-smoke.entry.js"
  }
});
const bundledJavaScript = result.outputFiles[0]?.text;

if (!bundledJavaScript) {
  throw new Error("The standalone demo bundle did not produce JavaScript output.");
}

// An escaped closing tag keeps JavaScript strings/comments from terminating the
// inline HTML script early.
const safeJavaScript = bundledJavaScript.replace(/<\/script/gi, "<\\/script");
const outputHtml = sourceHtml
  .replace(importMapPattern, () => "\n")
  // A callback is required here: minified dependencies can contain `$&`, `$\``
  // or `$'`, which have special expansion semantics in a string replacement.
  .replace(moduleScriptPattern, () => `<script>\n${safeJavaScript}</script>`);

if (/\b(?:src|href)=["'][^"']+\.js(?:[?#][^"']*)?["']/i.test(outputHtml)) {
  throw new Error("The standalone demo still contains an external JavaScript reference.");
}
if (/^\s*import\s.+\sfrom\s+["']/m.test(outputHtml)) {
  throw new Error("Unbundled module imports leaked into the standalone demo.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, outputHtml, "utf8");

const exporterSource = await readFile(exporterSourcePath, "utf8");
const viewerTemplateBase64 = Buffer.from(outputHtml, "utf8").toString("base64");
const exporterHtml = exporterSource.replace("__DEMO3D_VIEWER_TEMPLATE_BASE64__", viewerTemplateBase64);
if (exporterHtml === exporterSource) {
  throw new Error("The embedded-viewer exporter does not contain a template marker.");
}
await writeFile(exporterOutputPath, exporterHtml, "utf8");

const sizeMiB = Buffer.byteLength(outputHtml) / 1024 / 1024;
console.log(`Standalone demo: ${outputPath} (${sizeMiB.toFixed(2)} MiB)`);
console.log(`Standalone exporter: ${exporterOutputPath}`);
