// Fails the build when private material survives into the open-source tree.
// Two layers: structural checks that are safe to run in public CI, plus an
// author-specific term list kept in a gitignored file — a committed blocklist
// would itself disclose the very thing it is trying to hide.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TERMS_FILE = path.join(ROOT, "scripts", "private-terms.json");

const BANNED_PATTERNS = [
  { pattern: "chatgpt-team.site", why: "internal hosting remote" },
  { pattern: "appgprj_", why: "internal hosting project id" },
  { pattern: ".openai/hosting.json", why: "managed hosting config" },
  { pattern: "feishu-deals.json", why: "commercial deal export" },
  { pattern: "obsidian-index.json", why: "personal vault index" },
  { pattern: "WORKBUDDY_HANDOFF.md", why: "private handover notes" },
];

// Binary assets that carried personal branding; replace them to clear this.
const PRIVATE_ASSET_HASHES = new Map([
  ["public/og.png", "62cb16a84ad032086d31470c0d84ee7a9eb888b1c50ab7c0fa512e407ccc1ce8"],
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".wrangler", "release",
  ".vinext", ".next", ".openai", "build-node", "build-runtime",
]);
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".sql", ".yml", ".yaml"]);
const HOME_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//g;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (SCAN_EXT.has(path.extname(entry.name))) {
      yield path.relative(ROOT, full);
    }
  }
}

let privateTerms = [];
let termsLoaded = false;
try {
  const parsed = JSON.parse(await readFile(TERMS_FILE, "utf8"));
  privateTerms = (parsed.terms ?? []).filter((term) => typeof term === "string" && term.length >= 2);
  termsLoaded = true;
} catch {}

const TERMS_FILE_REL = path.relative(ROOT, TERMS_FILE);
// The checker's own rule table and the gitignored term list are the scan's
// inputs, not product content; only their definition lines are exempt.
const SELF_FILE = "scripts/check-privacy.mjs";

const findings = [];
for await (const file of walk(ROOT)) {
  if (file === TERMS_FILE_REL) continue;
  const lines = (await readFile(path.join(ROOT, file), "utf8")).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (file === SELF_FILE && (line.includes("why:") || line.includes("private-terms.json"))) continue;
    for (const { pattern, why } of BANNED_PATTERNS) {
      if (line.includes(pattern)) findings.push(`${file}:${index + 1}  ${why}: ${pattern}`);
    }
    for (const match of line.matchAll(HOME_PATH)) {
      findings.push(`${file}:${index + 1}  absolute personal home path ${match[0]}`);
    }
    for (const term of privateTerms) {
      if (line.toLowerCase().includes(term.toLowerCase())) {
        findings.push(`${file}:${index + 1}  private term: ${term}`);
      }
    }
  }
}

for (const [file, digest] of PRIVATE_ASSET_HASHES) {
  try {
    const bytes = await readFile(path.join(ROOT, file));
    if (createHash("sha256").update(bytes).digest("hex") === digest) {
      findings.push(`${file} is still the previous owner's artwork`);
    }
  } catch {}
}

if (findings.length) {
  const unique = [...new Set(findings)];
  console.error("Privacy check failed:\n" + unique.map((f) => "  " + f).join("\n"));
  console.error(`\n${unique.length} finding(s). Remove them before publishing.`);
  process.exit(1);
}

console.log(
  termsLoaded
    ? `privacy check passed (${privateTerms.length} private terms + structure)`
    : "privacy check passed (structure only — scripts/private-terms.json absent)"
);
