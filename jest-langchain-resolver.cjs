/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

/**
 * Custom Jest resolver: forces @langchain/* sub-paths to their CJS bundles.
 *
 * Jest's default resolver does not honour package `exports` maps, so it
 * resolves `@langchain/core/messages` → dist/messages/index.js (ESM).
 * This resolver intercepts those imports, walks the package's exports map
 * under the `require` condition, and returns the matching .cjs path.
 */

const fs = require("fs");
const path = require("path");

// Packages we want to force through the exports → require path.
const LANGCHAIN_SCOPES = ["@langchain/core", "@langchain/langgraph", "@langchain/google-genai"];

/**
 * Walk an exports-map value and return the first string found under
 * the `require` condition (or `default` as fallback).
 */
function resolveExportsValue(value) {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;
  if (value.require) return resolveExportsValue(value.require);
  if (value.default) return resolveExportsValue(value.default);
  return null;
}

/**
 * Look up `subpath` (e.g. "./messages") in the package's exports map and
 * return an absolute path to the CJS bundle, or null if not found.
 */
function cjsFromExports(pkgDir, subpath) {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const exportsMap = pkg.exports;
    if (!exportsMap || typeof exportsMap !== "object") return null;

    const entry = exportsMap[subpath];
    if (!entry) return null;

    const relative = resolveExportsValue(entry);
    if (!relative) return null;

    return path.join(pkgDir, relative);
  } catch {
    return null;
  }
}

/**
 * Find the node_modules root for a scoped package by searching from the
 * basedir (file being resolved) up to the filesystem root.
 */
function findPkgDir(scope, basedir) {
  let dir = basedir;
  while (true) {
    const candidate = path.join(dir, "node_modules", scope);
    const pkgJson = path.join(candidate, "package.json");
    if (fs.existsSync(pkgJson)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

module.exports = (request, options) => {
  const { defaultResolver, basedir } = options;

  for (const scope of LANGCHAIN_SCOPES) {
    if (!request.startsWith(scope)) continue;

    // Only intercept exact package imports or sub-path imports (not relative paths)
    const suffix = request.slice(scope.length); // "" | "/messages" | "/language_models/chat_models" …
    if (suffix !== "" && !suffix.startsWith("/")) break; // e.g. "@langchain/coreX" — not our scope

    const subpath = suffix === "" ? "." : `.${suffix}`;

    const searchFrom = basedir || process.cwd();
    const pkgDir = findPkgDir(scope, searchFrom);

    if (pkgDir) {
      const cjsPath = cjsFromExports(pkgDir, subpath);
      if (cjsPath && fs.existsSync(cjsPath)) {
        return cjsPath;
      }
    }
    break;
  }

  return defaultResolver(request, options);
};
