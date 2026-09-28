// Post-pack trim: the `workerd` launcher package and the platform-specific
// @cloudflare/workerd-* package each ship an identical ~112 MB binary. Point the
// launcher at the platform copy instead of carrying both.
const fs = require("node:fs");
const path = require("node:path");

function appNodeModules(appOutDir) {
  const binary = process.platform === "win32" ? "workerd.exe" : "workerd";
  const candidates = [
    path.join(appOutDir, "resources", "app", "node_modules"),
    path.join(appOutDir, "resources", "app.asar.unpacked", "node_modules"),
  ];
  try {
    for (const entry of fs.readdirSync(appOutDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
      candidates.push(path.join(appOutDir, entry.name, "Contents", "Resources", "app", "node_modules"));
    }
  } catch {}
  return candidates.find((dir) => fs.existsSync(path.join(dir, "workerd", "bin", binary)));
}

module.exports = async function afterPack(context) {
  const binary = process.platform === "win32" ? "workerd.exe" : "workerd";
  const modules = appNodeModules(context.appOutDir);
  if (!modules) {
    console.warn("workerd dedup skipped: no bundled workerd launcher found");
    return;
  }

  const scopedRoot = path.join(modules, "@cloudflare");
  const scoped = fs.existsSync(scopedRoot)
    ? fs.readdirSync(scopedRoot).find((name) => name.startsWith("workerd-"))
    : undefined;
  if (!scoped) return;

  const keep = path.join(scopedRoot, scoped, "bin", binary);
  const launcher = path.join(modules, "workerd", "bin", binary);
  if (!fs.existsSync(keep) || fs.statSync(launcher).isSymbolicLink()) return;

  try {
    fs.rmSync(launcher, { force: true });
    fs.symlinkSync(path.relative(path.dirname(launcher), keep), launcher);
    console.log(`workerd deduped: ${path.relative(modules, launcher)} -> ${path.relative(modules, keep)}`);
  } catch (error) {
    // Windows symlinks need elevated rights; ship the duplicate rather than break.
    if (!fs.existsSync(launcher)) fs.copyFileSync(keep, launcher);
    console.warn(`workerd dedup skipped: ${error.message}`);
  }
};
