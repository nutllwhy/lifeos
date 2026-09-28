import assert from "node:assert/strict";
import test from "node:test";
import { MODULES, normalizeModules } from "../lib/modules.ts";

const ALL = MODULES.map((module) => module.id);

test("an absent or malformed selection falls back to everything on", () => {
  assert.deepEqual(normalizeModules(undefined), ALL);
  assert.deepEqual(normalizeModules("deals"), ALL);
  assert.deepEqual(normalizeModules({}), ALL);
});

test("unknown module ids are dropped rather than trusted", () => {
  assert.deepEqual(normalizeModules(["deals", "billing", 42, null]), ["deals"]);
});

test("a deliberate empty selection stays empty", () => {
  assert.deepEqual(normalizeModules([]), []);
});

test("every advertised module id survives normalisation", () => {
  assert.deepEqual(normalizeModules(ALL), ALL);
});
