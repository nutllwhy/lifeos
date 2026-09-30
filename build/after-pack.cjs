// Post-pack trim. At runtime wrangler picks the workerd binary from the
// @cloudflare/workerd-<platform> package that matches the *user's* machine, so a
// bundle only ever needs one — but every platform copy present in node_modules
// gets collected, and the `workerd` launcher package carries a second identical
// ~112 MB binary that nothing in this app execs.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const PLATFORM_PACKAGES = {
  "darwin-arm64": "workerd-darwin-arm64",
  "darwin-x64": "workerd-darwin-64",
  "linux-arm64": "workerd-linux-arm64",
  "linux-x64": "workerd-linux-64",
  "win32-x64": "workerd-windows-64",
};

// electron-builder hands over its numeric Arch enum rather than a string:
// ia32=0, x64=1, armv7l=2, arm64=3, universal=4.
const ARCH_NAMES = ["ia32", "x64", "armv7l", "arm64", "universal"];

function nodeModulesDirs(appOutDir) {
  const candidates = [path.join(appOutDir, "resources", "app", "node_modules")];
  try {
    for (const entry of fs.readdirSync(appOutDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith(".app")) {
        candidates.push(path.join(appOutDir, entry.name, "Contents", "Resources", "app", "node_modules"));
      }
      if (entry.name === "resources") {
        candidates.push(path.join(appOutDir, "resources", "app.asar.unpacked", "node_modules"));
      }
    }
  } catch {}
  return candidates.filter((dir) => fs.existsSync(path.join(dir, "workerd")));
}

module.exports = async function afterPack(context) {
  const arch = typeof context.arch === "number" ? ARCH_NAMES[context.arch] : context.arch;
  const targetKey = `${context.electronPlatformName}-${arch}`;
  const keep = PLATFORM_PACKAGES[targetKey];
  if (!keep) {
    console.warn(`workerd trim skipped: no workerd package for ${targetKey}`);
    return;
  }

  for (const modules of nodeModulesDirs(context.appOutDir)) {
    const scopedRoot = path.join(modules, "@cloudflare");
    const wanted = path.join(scopedRoot, keep, "bin");
    // Pruning everything else is only safe once the one binary the app will
    // actually load is present; otherwise the bundle ships unable to start.
    if (!fs.existsSync(wanted)) {
      throw new Error(
        `${keep} is not installed, so the ${targetKey} bundle has no workerd runtime. ` +
        `Install it before packing this target (npm i ${keep}@<version> --no-save).`,
      );
    }

    let removed = 0;
    if (fs.existsSync(scopedRoot)) {
      for (const entry of fs.readdirSync(scopedRoot)) {
        if (!entry.startsWith("workerd-") || entry === keep) continue;
        fs.rmSync(path.join(scopedRoot, entry), { recursive: true, force: true });
        removed += 1;
      }
    }

    // The launcher package is still required for its JS entry point; only the
    // duplicated binary inside it goes.
    const launcher = path.join(modules, "workerd", "bin");
    if (fs.existsSync(launcher)) {
      for (const entry of fs.readdirSync(launcher)) {
        fs.rmSync(path.join(launcher, entry), { force: true });
        removed += 1;
      }
    }

    console.log(`workerd trimmed for ${targetKey}: kept ${keep}, removed ${removed} entr${removed === 1 ? "y" : "ies"}`);

    // The bundled Node runtime is per-architecture too, so it is placed here
    // rather than through extraResources, which cannot vary by target.
    const nodeBinary = targetKey.startsWith("win32") ? "node.exe" : "node";
    const nodeSource = path.join(ROOT, "build-node", targetKey, nodeBinary);
    if (!fs.existsSync(nodeSource)) {
      throw new Error(`${nodeSource} is missing; run node scripts/fetch-node.mjs with LIFEOS_NODE_TARGET=all before packing`);
    }
    const resourcesRoot = path.resolve(modules, "..", "..");
    const nodeDir = path.join(resourcesRoot, "node");
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.copyFileSync(nodeSource, path.join(nodeDir, nodeBinary));
    fs.chmodSync(path.join(nodeDir, nodeBinary), 0o755);
    fs.writeFileSync(path.join(nodeDir, "RUNTIME.txt"), fs.readFileSync(path.join(ROOT, "build-node", targetKey, "RUNTIME.txt")));
    console.log(`node runtime placed for ${targetKey}`);
  }
};
