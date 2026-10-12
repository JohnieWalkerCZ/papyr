import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const typstDist = dirname(require.resolve("typst-wasm"));
const tldrawAssets = dirname(require.resolve("@tldraw/assets/selfHosted"));
const target = join(root, "public/typst");
const tldrawTarget = join(root, "public/tldraw");
await mkdir(join(target, "fonts"), { recursive: true });
await mkdir(tldrawTarget, { recursive: true });
for (const name of ["embed-icons", "fonts", "icons", "translations"]) {
  await cp(join(tldrawAssets, name), join(tldrawTarget, name), { recursive: true });
}
for (const name of ["engine.core.wasm", "engine.core2.wasm", "engine.core3.wasm"]) {
  await cp(join(typstDist, "engine", name), join(target, name));
}
await cp(join(typstDist, "worker/web-worker.js"), join(target, "web-worker.js"));
for (const name of [
  "LibertinusSerif-Regular.otf",
  "LibertinusSerif-Bold.otf",
  "LibertinusSerif-Italic.otf",
  "NewCMMath-Regular.otf",
]) {
  await cp(require.resolve(`@typst-wasm/fonts/${name}`), join(target, "fonts", name));
}
