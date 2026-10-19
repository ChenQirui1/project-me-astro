#!/usr/bin/env node
/**
 * Syncs the local `assets/` mirror to the private R2 bucket.
 *
 *   pnpm assets:push        upload anything whose hash changed
 *   pnpm assets:push --all  re-upload everything, ignoring the manifest
 *   pnpm assets:pull <key>  fetch one object back into assets/ (the optimized
 *                          copy, not the original)
 *
 * `assets/.manifest.json` records the md5 of every object as it was uploaded,
 * so a push only moves files that actually changed. It's committed, which is
 * what lets CI push incrementally without listing the whole bucket first.
 *
 * Images are resized and recompressed on the way up (see optimize.mjs); the
 * local files stay full size. The manifest hashes the local original, so a
 * change in optimize settings needs `--all` to reach objects already in R2.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { contentTypeFor } from "./mime.mjs";
import { optimize } from "./optimize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "assets");
const MANIFEST = path.join(ASSETS, ".manifest.json");
const BUCKET = process.env.R2_BUCKET ?? "project-me-assets";

/**
 * The manifest lives in the bucket rather than in git. `assets/confluence/`
 * is rebuilt from Confluence on every CI build and is no longer committed, so
 * a manifest in the repo would go stale immediately and force a full
 * re-upload on each build. R2 is the one store both local runs and the build
 * container can agree on.
 *
 * `walk()` skips dotfiles, so this key is never itself uploaded as an asset,
 * and worker/index.ts refuses dot-prefixed keys so it is not readable at
 * /img/.manifest.json.
 */
const MANIFEST_KEY = ".manifest.json";

function scratchFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assets-manifest-"));
  return { dir, file: path.join(dir, "manifest.json") };
}

function readManifest() {
  const { dir, file } = scratchFile();
  try {
    const fetched = wrangler(
      ["r2", "object", "get", `${BUCKET}/${MANIFEST_KEY}`, "--file", file, "--remote"],
      { allowFailure: true },
    );
    if (fetched !== null) return JSON.parse(fs.readFileSync(file, "utf8"));

    // Nothing in the bucket yet. Seed from the legacy committed copy if one is
    // still around; otherwise start empty, which costs one full re-upload.
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return {};
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeManifest(manifest) {
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  const { dir, file } = scratchFile();
  try {
    fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
    wrangler([
      "r2",
      "object",
      "put",
      `${BUCKET}/${MANIFEST_KEY}`,
      "--file",
      file,
      "--content-type",
      "application/json",
      "--remote",
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function walk(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, key) : [{ key, full }];
  });
}

function md5(file) {
  return createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

function wrangler(args, { allowFailure = false } = {}) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    // A missing object is an expected outcome for the manifest's first read,
    // not a failure worth aborting the push over.
    if (allowFailure) return null;
    throw new Error(
      `wrangler ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

async function push({ all }) {
  const manifest = readManifest();
  const files = walk(ASSETS);

  if (files.length === 0) {
    console.log(`no files under ${path.relative(process.cwd(), ASSETS)}/`);
    return;
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "assets-push-"));
  let uploaded = 0;
  try {
    for (const { key, full } of files) {
      const hash = md5(full);
      if (!all && manifest[key] === hash) continue;

      process.stdout.write(`  ↑ ${key} … `);
      const original = fs.readFileSync(full);
      const { buffer, optimized } = await optimize(original);
      const upload = path.join(staging, "object");
      fs.writeFileSync(upload, buffer);

      wrangler([
        "r2",
        "object",
        "put",
        `${BUCKET}/${key}`,
        "--file",
        upload,
        "--content-type",
        contentTypeFor(key),
        "--remote",
      ]);
      manifest[key] = hash;
      uploaded += 1;
      console.log(
        optimized
          ? `ok (${kb(original.length)} → ${kb(buffer.length)})`
          : `ok (${kb(original.length)}, as-is)`,
      );
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  // Drop manifest entries whose local file is gone, so a later re-add uploads.
  const present = new Set(files.map((f) => f.key));
  for (const key of Object.keys(manifest)) {
    if (!present.has(key)) delete manifest[key];
  }

  writeManifest(manifest);
  console.log(
    uploaded === 0
      ? `everything already in sync (${files.length} objects)`
      : `pushed ${uploaded} of ${files.length} objects to r2://${BUCKET}`,
  );
}

function pull(key) {
  if (!key) throw new Error("usage: pnpm assets:pull <key>");
  const dest = path.join(ASSETS, key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", dest, "--remote"]);

  const manifest = readManifest();
  manifest[key] = md5(dest);
  writeManifest(manifest);
  console.log(`pulled ${key} -> assets/${key}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "pull") pull(rest[0]);
  else await push({ all: rest.includes("--all") || command === "--all" });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
