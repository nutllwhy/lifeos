// Downloads the official Node.js runtime for the build target so the packaged
// app can run `wrangler dev` without asking users to install Node themselves.
// Wrangler's CLI does not work under ELECTRON_RUN_AS_NODE, hence a real binary.
import { spawnSync } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const NODE_VERSION = "22.18.0";
const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "build-node");

const TARGETS = {
  "darwin-arm64": { ext: "tar.xz", dirSuffix: "darwin-arm64" },
  "darwin-x64": { ext: "tar.xz", dirSuffix: "darwin-x64" },
  "win32-x64": { ext: "zip", dirSuffix: "win-x64" },
  "linux-x64": { ext: "tar.xz", dirSuffix: "linux-x64" },
};

const targetKey = process.env.LOCALDECK_NODE_TARGET
  || (process.platform === "win32" ? "win32-x64" : `${process.platform}-${process.arch}`);
const target = TARGETS[targetKey];
if (!target) throw new Error(`unsupported Node target: ${targetKey}`);

const fileBase = `node-v${NODE_VERSION}-${target.dirSuffix}`;
const archive = `${fileBase}.${target.ext}`;
const sources = [
  `https://nodejs.org/dist/v${NODE_VERSION}/${archive}`,
  `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${archive}`,
];

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
const download = path.join(OUTPUT, archive);

let fetched = false;
for (const url of sources) {
  console.log(`fetching ${url}`);
  const curl = spawnSync("curl", ["-fsSL", "--retry", "2", "-o", download, url], { stdio: "inherit" });
  if (curl.status === 0) { fetched = true; break; }
}
if (!fetched) throw new Error(`could not download ${archive} from any mirror`);

const extract = spawnSync("tar", ["-xf", download, "-C", OUTPUT], { stdio: "inherit" });
if (extract.status !== 0) throw new Error("extraction failed");

const binaryName = targetKey.startsWith("win32") ? "node.exe" : "node";
// macOS/Linux tarballs nest the binary under bin/, Windows puts it at the root.
const source = target.ext === "zip"
  ? path.join(OUTPUT, fileBase, binaryName)
  : path.join(OUTPUT, fileBase, "bin", binaryName);
const destination = path.join(OUTPUT, binaryName);
const move = spawnSync("mv", [source, destination], { stdio: "inherit" });
if (move.status !== 0) throw new Error("could not place the node binary");
await chmod(destination, 0o755);
await rm(path.join(OUTPUT, fileBase), { recursive: true, force: true });
await rm(download, { force: true });
await writeFile(path.join(OUTPUT, "RUNTIME.txt"), `node v${NODE_VERSION} for ${targetKey}\n`);

const probe = spawnSync(destination, ["-v"], { stdio: "inherit" });
if (probe.status !== 0) throw new Error("the downloaded node binary did not run");
console.log(`node runtime staged at ${path.relative(ROOT, destination)}`);
