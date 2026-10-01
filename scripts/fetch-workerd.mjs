// Installs every @cloudflare/workerd-* package the host OS family needs.
//
// npm only installs the package matching the machine it ran on, so a macOS
// runner never has the Intel binary and a build for the other architecture would
// ship without a runtime. after-pack refuses to build such a bundle, so this runs
// first. Versions come from the workerd package wrangler already pinned, so the
// binaries can never drift from it.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const pinned = JSON.parse(readFileSync(path.join(ROOT, "node_modules/workerd/package.json"), "utf8"));
const versions = pinned.optionalDependencies || {};

const FAMILY = {
  darwin: ["@cloudflare/workerd-darwin-arm64", "@cloudflare/workerd-darwin-64"],
  win32: ["@cloudflare/workerd-windows-64"],
  linux: ["@cloudflare/workerd-linux-arm64", "@cloudflare/workerd-linux-64"],
};

const wanted = FAMILY[process.platform];
if (!wanted) throw new Error(`no workerd package list for ${process.platform}`);

const missing = wanted.filter((name) => !existsSync(path.join(ROOT, "node_modules", name)));
if (!missing.length) {
  console.log(`workerd binaries already present for ${process.platform}`);
} else {
  const specs = missing.map((name) => {
    const version = versions[name];
    if (!version) throw new Error(`${name} is not pinned by workerd@${pinned.version}`);
    return `${name}@${version}`;
  });
  console.log(`installing ${specs.join(" ")}`);
  const install = spawnSync("npm", ["i", ...specs, "--no-save", "--no-package-lock", "--force"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (install.status !== 0) throw new Error("could not install the workerd binaries for this platform family");
}

for (const name of wanted) {
  if (!existsSync(path.join(ROOT, "node_modules", name))) throw new Error(`${name} is still missing after install`);
}
