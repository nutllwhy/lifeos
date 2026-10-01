// Downloads the official Node.js runtimes the packaged apps need so users never
// have to install Node themselves (Wrangler's CLI does not initialise under
// ELECTRON_RUN_AS_NODE, hence a real binary).
//
// Each target is staged under build-node/<platform>-<arch>/ and after-pack copies
// the matching one into the bundle, because a single folder cannot serve both an
// arm64 and an x64 app built in the same run.
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

const hostKey = process.platform === "win32" ? "win32-x64" : `${process.platform}-${process.arch}`;
// A single electron-builder run can emit several architectures, so the whole
// family is staged rather than just the host one. LIFEOS_NODE_TARGET overrides.
const HOST_FAMILY = {
  darwin: ["darwin-arm64", "darwin-x64"],
  win32: ["win32-x64"],
  linux: ["linux-x64"],
};
const requested = process.env.LIFEOS_NODE_TARGET || (HOST_FAMILY[process.platform] || [hostKey]).join(",");
const keys = requested.split(",").map((key) => key.trim()).filter(Boolean);

async function download(url, destination) {
  const curl = spawnSync("curl", ["-fsSL", "--retry", "2", "-o", destination, url], { stdio: "inherit" });
  return curl.status === 0;
}

async function stage(targetKey) {
  const target = TARGETS[targetKey];
  if (!target) throw new Error(`unsupported Node target: ${targetKey}`);

  const binaryName = targetKey.startsWith("win32") ? "node.exe" : "node";
  const destination = path.join(OUTPUT, targetKey, binaryName);
  const stamp = path.join(OUTPUT, targetKey, "RUNTIME.txt");
  const staged = await readFile(stamp, "utf8").catch(() => "");
  if (staged.trim() === `node v${NODE_VERSION} for ${targetKey}`) {
    console.log(`node v${NODE_VERSION} for ${targetKey} already staged`);
    return destination;
  }

  const fileBase = `node-v${NODE_VERSION}-${target.dirSuffix}`;
  const archive = `${fileBase}.${target.ext}`;
  const work = path.join(OUTPUT, `.tmp-${targetKey}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const packed = path.join(work, archive);

  let fetched = false;
  for (const url of [
    `https://nodejs.org/dist/v${NODE_VERSION}/${archive}`,
    `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${archive}`,
  ]) {
    console.log(`fetching ${url}`);
    if (await download(url, packed)) { fetched = true; break; }
  }
  if (!fetched) throw new Error(`could not download ${archive} from any mirror`);

  const extract = spawnSync("tar", ["-xf", packed, "-C", work], { stdio: "inherit" });
  if (extract.status !== 0) throw new Error("extraction failed");

  // macOS/Linux tarballs nest the binary under bin/, Windows puts it at the root.
  const source = path.join(work, fileBase, targetKey.startsWith("win32") ? binaryName : path.join("bin", binaryName));
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { force: true });
  await rename(source, destination);
  await chmod(destination, 0o755);
  await writeFile(stamp, `node v${NODE_VERSION} for ${targetKey}\n`);
  await rm(work, { recursive: true, force: true });
  return destination;
}

function verify(targetKey, destination) {
  if (targetKey === hostKey) {
    const probe = spawnSync(destination, ["-v"], { stdio: "inherit" });
    if (probe.status !== 0) throw new Error(`${destination} did not run`);
    return;
  }
  // A foreign binary cannot be executed here, so check the container instead of
  // pretending the smoke test ran.
  const head = Buffer.alloc(4);
  const fd = openSync(destination, "r");
  try {
    readSync(fd, head, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  const BINARY_MAGICS = {
    win32: ["MZ"],
    // Mach-O thin 64/32 and fat archives, both byte orders.
    darwin: ["\xcf\xfa\xed\xfe", "\xce\xfa\xed\xfe", "\xca\xfe\xba\xbe", "\xfe\xed\xfa\xcf", "\xfe\xed\xfa\xce", "\xbe\xba\xfe\xca"],
    linux: ["\x7fELF"],
  };
  const family = targetKey.split("-")[0];
  const magic = head.toString("latin1");
  if (!(BINARY_MAGICS[family] || []).some((expected) => magic.startsWith(expected))) {
    throw new Error(`${destination} is not a ${targetKey} binary (magic ${JSON.stringify(magic)})`);
  }
  console.log(`staged ${targetKey} (not executed here)`);
}

for (const key of keys) {
  verify(key, await stage(key));
}
console.log(`node runtime staged for: ${keys.join(", ")}`);
