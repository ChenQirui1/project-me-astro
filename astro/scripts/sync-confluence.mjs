#!/usr/bin/env node
/**
 * Pulls curated Confluence project pages into the `projects` collection.
 *
 *   pnpm sync:confluence            write changes
 *   pnpm sync:confluence --dry-run  report what would change, touch nothing
 *
 * Confluence is the working archive; this script is the curated publishing
 * layer on top of it. Two things decide what crosses over, and they answer
 * different questions:
 *
 *   the page tree    is this a project page at all? Only descendants of
 *                    CONFLUENCE_ROOT are considered, so notes and scratch
 *                    pages elsewhere in the space never enter.
 *   the page status  is it ready? Confluence's own status lozenge, set from
 *                    the page header — only CONFLUENCE_PUBLISH_STATUS
 *                    publishes.
 *
 * Both are CQL clauses, so Confluence does the filtering and only publishable
 * pages are ever fetched. A page with no status is withheld, which makes a
 * fresh page safe by default; change the status away from the publish one and
 * the project is deleted from the site on the following run.
 *
 * Required env (astro/.env locally, repo secrets in CI):
 *   CONFLUENCE_BASE_URL   https://your-site.atlassian.net/wiki
 *   CONFLUENCE_EMAIL      Atlassian account email
 *   CONFLUENCE_API_TOKEN  id.atlassian.com/manage-profile/security/api-tokens
 *   CONFLUENCE_ROOT       portfolio root page, as a page id or an exact title
 * Optional:
 *   CONFLUENCE_PUBLISH_STATUS  page status that publishes
 *                              (default: Ready for Publish)
 *   CONFLUENCE_SPACE_KEY       restrict the search to one space
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  storageToMarkdown,
  firstParagraphText,
  isPlayable,
} from "./confluence-storage.mjs";
import {
  extractMetadata,
  extractSections,
  normalizeMetadata,
} from "./confluence-metadata.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS_DIR = path.join(ROOT, "src", "content", "projects");
const ASSETS_DIR = path.join(ROOT, "assets", "confluence");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // No .env file — fall back to the ambient environment (this is the CI path).
}

const DRY_RUN = process.argv.includes("--dry-run");

const BASE_URL = (process.env.CONFLUENCE_BASE_URL ?? "").replace(/\/+$/, "");
const EMAIL = process.env.CONFLUENCE_EMAIL ?? "";
const TOKEN = process.env.CONFLUENCE_API_TOKEN ?? "";
const ROOT_REF = process.env.CONFLUENCE_ROOT ?? "";
const PUBLISH_STATUS = process.env.CONFLUENCE_PUBLISH_STATUS ?? "Ready for Publish";
const SPACE_KEY = process.env.CONFLUENCE_SPACE_KEY ?? "";

const missing = [
  ["CONFLUENCE_BASE_URL", BASE_URL],
  ["CONFLUENCE_EMAIL", EMAIL],
  ["CONFLUENCE_API_TOKEN", TOKEN],
  ["CONFLUENCE_ROOT", ROOT_REF],
].filter(([, value]) => !value);

if (missing.length > 0) {
  console.error(
    `missing required env: ${missing.map(([name]) => name).join(", ")}\n` +
      `set them in astro/.env (see .env.example) or export them before running`,
  );
  process.exit(1);
}

const AUTH = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;

async function confluence(pathname, { raw = false } = {}) {
  const url = pathname.startsWith("http") ? pathname : `${BASE_URL}${pathname}`;
  const response = await fetch(url, {
    headers: { authorization: AUTH, accept: raw ? "*/*" : "application/json" },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `GET ${url} -> ${response.status} ${response.statusText}\n${detail.slice(0, 500)}`,
    );
  }
  return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
}

/**
 * Turns CONFLUENCE_ROOT into a page id. A run of digits is taken as the id
 * itself; anything else is looked up as an exact page title, so the variable
 * can be the human name of the page rather than a number to go hunting for.
 */
async function resolveRootId() {
  if (/^\d+$/.test(ROOT_REF)) return ROOT_REF;

  const clauses = [`type = page`, `title = ${JSON.stringify(ROOT_REF)}`];
  if (SPACE_KEY) clauses.push(`space = "${SPACE_KEY}"`);
  const cql = encodeURIComponent(clauses.join(" and "));

  const result = await confluence(`/rest/api/content/search?cql=${cql}&limit=5`);
  const matches = result.results ?? [];

  if (matches.length === 0) {
    throw new Error(
      `no page titled "${ROOT_REF}" — check CONFLUENCE_ROOT, or set it to the page id`,
    );
  }
  // Titles are only unique per space, so an ambiguous one has to be resolved
  // by hand rather than guessed at.
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} pages are titled "${ROOT_REF}" (ids ${matches
        .map((match) => match.id)
        .join(", ")}) — set CONFLUENCE_ROOT to the id you want, or set CONFLUENCE_SPACE_KEY`,
    );
  }
  return matches[0].id;
}

/** Walks a CQL search to the end, following the `next` links. */
async function searchAll(cql, { expand = "", limit = 100 } = {}) {
  const pages = [];
  let next =
    `/rest/api/content/search?cql=${encodeURIComponent(cql)}` +
    `${expand ? `&expand=${expand}` : ""}&limit=${limit}`;

  while (next) {
    const page = await confluence(next);
    pages.push(...(page.results ?? []));
    next = page._links?.next ?? null;
  }
  return pages;
}

/** The CQL that scopes a query to the portfolio, minus the status clause. */
function withinPortfolio(rootId) {
  // `ancestor` matches descendants at any depth and excludes the root itself,
  // so the root page is a container and never becomes a project.
  const clauses = [`type = page`, `ancestor = ${rootId}`];
  if (SPACE_KEY) clauses.push(`space = "${SPACE_KEY}"`);
  return clauses.join(" and ");
}

/**
 * Every page below the root carrying the publish status.
 *
 * `pageStatus` is Confluence's own status lozenge — the one set from the page
 * header, not anything in the body — so the gate is a property of the page
 * rather than text the sync has to parse and trust.
 */
async function fetchReadyPages(rootId) {
  const cql = `${withinPortfolio(rootId)} and pageStatus = ${JSON.stringify(PUBLISH_STATUS)}`;
  const expand = "body.storage,version,history,metadata.labels,space,ancestors";
  return searchAll(cql, { expand, limit: 50 });
}

/**
 * Every page below the root, ids and titles only.
 *
 * Used purely to report what was considered and withheld: without it a page
 * that loses its status just vanishes from the run with nothing said.
 */
async function fetchDescendants(rootId) {
  return searchAll(withinPortfolio(rootId));
}

async function fetchAttachments(pageId) {
  const result = await confluence(
    `/rest/api/content/${pageId}/child/attachment?limit=100`,
  );
  const byFilename = new Map();
  for (const item of result.results ?? []) {
    byFilename.set(item.title, item._links?.download);
  }
  return byFilename;
}

const slugify = (text) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";

/** YAML-safe scalar. Double-quoted YAML shares JSON's escape rules. */
const yaml = (value) => JSON.stringify(String(value));

const yamlList = (name, values) =>
  values.length > 0
    ? `${name}:\n${values.map((value) => `  - ${yaml(value)}`).join("\n")}`
    : null;

const isoDate = (value) =>
  value ? new Date(value).toISOString() : new Date().toISOString();

function labelNames(page) {
  return (page.metadata?.labels?.results ?? []).map((label) => label.name);
}

/**
 * The catalogue section a project sits in, taken from its place in the tree:
 * `Portfolio Home > Digital Products > Tools > ClearWeb` yields
 * category "Digital Products", subcategory "Tools".
 *
 * Measured from the portfolio root rather than from the top of the space, so
 * it reads the same whether or not that root is the space homepage.
 */
function readAncestry(page, rootId) {
  const ancestors = page.ancestors ?? [];
  const rootIndex = ancestors.findIndex((ancestor) => ancestor.id === rootId);
  const below = ancestors.slice(rootIndex + 1).map((ancestor) => ancestor.title);
  return {
    category: below[0] ?? null,
    subcategory: below.length > 1 ? below[below.length - 1] : null,
  };
}

/** Existing synced files, keyed by the Confluence page id in their frontmatter. */
function syncedProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return new Map();
  const byId = new Map();
  for (const name of fs.readdirSync(PROJECTS_DIR)) {
    if (!name.endsWith(".md")) continue;
    const file = path.join(PROJECTS_DIR, name);
    const id = /^confluenceId:\s*"?(\d+)"?/m.exec(fs.readFileSync(file, "utf8"))?.[1];
    if (id) byId.set(id, file);
  }
  return byId;
}

/** True when a file exists and was NOT written by this script. */
function isHandAuthored(file) {
  if (!fs.existsSync(file)) return false;
  return !/^confluenceId:/m.test(fs.readFileSync(file, "utf8"));
}

/**
 * Decides whether a page publishes and under what slug, without doing any I/O.
 *
 * Runs for every page before anything is written, so that cross-links between
 * project pages can be resolved against the set that will actually exist.
 */
function prepare(page, rootId) {
  const pageId = page.id;
  const labels = labelNames(page);
  const metadata = extractMetadata(page.body?.storage?.value ?? "");
  const sections = extractSections(metadata.storage);
  const storage = sections.storage;
  // A labelled field in the metadata block wins over a headed section.
  const fields = new Map([...sections.fields, ...metadata.fields]);
  const meta = normalizeMetadata(fields);

  // No status check here: the CQL query returned only pages already carrying
  // the publish status, so everything reaching this point is ready.
  const slugLabel = labels.find((name) => name.startsWith("slug-"));
  const slug =
    meta.slug ?? (slugLabel ? slugLabel.slice("slug-".length) : slugify(page.title));

  const file = path.join(PROJECTS_DIR, `${slug}.md`);
  if (isHandAuthored(file)) {
    return {
      page,
      pageId,
      skipped: `src/content/projects/${slug}.md is hand-authored — delete it to hand this slug over to Confluence`,
    };
  }

  return { page, pageId, labels, meta, storage, slug, file, rootId };
}

async function writeProject(prepared, titleToSlug) {
  const { page, pageId, labels, meta, storage, slug, file, rootId } = prepared;

  const attachments = await fetchAttachments(pageId);
  const usedAttachments = new Set();
  const attachmentUrl = (filename) => {
    usedAttachments.add(filename);
    return `/img/confluence/${pageId}/${filename}`;
  };

  // Slides of a carousel, by URL. They render in the body, so they must not
  // also land in `gallery` and show a second time in the page's media grid.
  const inCarousels = new Set();

  const markdown = storageToMarkdown(storage, {
    attachmentUrl,
    onCarousel: (sources) => {
      for (const source of sources) inCarousels.add(source);
    },
    // Only link to pages that will actually be published — an unpublished
    // target degrades to plain text rather than becoming a dead link.
    pageLink: (title) => {
      const target = titleToSlug.get(title);
      return target ? `/projects/${target}` : null;
    },
  });

  // Hero media may be named in the metadata block; otherwise take the first
  // image the page actually renders. A clip is never the hero — `thumbnail`
  // is rendered as an `<img>` by both the catalogue card and the page header,
  // so a page carrying only clips gets no hero rather than a broken one, and
  // falls back to the skeleton those two already draw.
  const stills = [...usedAttachments].filter((filename) => !isPlayable(filename));
  let heroName = stills[0];
  if (meta.heroMedia && attachments.has(meta.heroMedia)) {
    if (isPlayable(meta.heroMedia)) {
      console.warn(
        `    ! hero media "${meta.heroMedia}" is a clip — using a still instead`,
      );
    } else {
      heroName = meta.heroMedia;
    }
  }
  if (heroName) usedAttachments.add(heroName);

  const localDir = path.join(ASSETS_DIR, pageId);
  let downloaded = 0;
  for (const filename of usedAttachments) {
    const download = attachments.get(filename);
    if (!download) {
      console.warn(`    ! referenced attachment "${filename}" not found`);
      continue;
    }
    const dest = path.join(localDir, filename);
    if (fs.existsSync(dest)) continue;

    const bytes = await confluence(`${BASE_URL}${download}`, { raw: true });
    if (!DRY_RUN) {
      fs.mkdirSync(localDir, { recursive: true });
      fs.writeFileSync(dest, bytes);
    }
    downloaded += 1;
  }

  const assetUrl = (filename) => `/img/confluence/${pageId}/${filename}`;
  const gallery = [...usedAttachments]
    .filter((filename) => filename !== heroName)
    .map(assetUrl)
    .filter((url) => !inCarousels.has(url));

  const ancestry = readAncestry(page, rootId);
  const description = meta.summary ?? firstParagraphText(storage).slice(0, 240);
  const year = meta.year ?? new Date(page.history?.createdDate ?? Date.now()).getFullYear();

  // `medium` drives the existing tag strip on the project page.
  const medium =
    meta.disciplines.length > 0
      ? meta.disciplines.join(", ")
      : (meta.projectType ?? null);

  // `publish-*` labels may linger on pages from when labels were the gate.
  // They no longer decide anything, but they aren't topics either.
  const topics = labels.filter(
    (name) => !name.startsWith("publish-") && !name.startsWith("slug-"),
  );

  const frontmatter = [
    "---",
    `title: ${yaml(page.title)}`,
    `description: ${yaml(description)}`,
    `year: ${year}`,
    medium ? `medium: ${yaml(medium)}` : null,
    heroName ? `thumbnail: ${yaml(assetUrl(heroName))}` : null,
    meta.projectType ? `projectType: ${yaml(meta.projectType)}` : null,
    yamlList("disciplines", meta.disciplines),
    meta.context ? `context: ${yaml(meta.context)}` : null,
    meta.status ? `status: ${yaml(meta.status)}` : null,
    meta.documentation ? `documentation: ${yaml(meta.documentation)}` : null,
    meta.publication ? `publication: ${yaml(meta.publication)}` : null,
    meta.featured ? "featured: true" : null,
    meta.role ? `role: ${yaml(meta.role)}` : null,
    yamlList("collaborators", meta.collaborators),
    ancestry.category ? `category: ${yaml(ancestry.category)}` : null,
    ancestry.subcategory ? `subcategory: ${yaml(ancestry.subcategory)}` : null,
    yamlList("gallery", gallery),
    yamlList("topics", topics),
    `confluenceId: ${yaml(pageId)}`,
    `confluenceUrl: ${yaml(`${BASE_URL}${page._links?.webui ?? ""}`)}`,
    `sourceUpdatedAt: ${isoDate(page.version?.when)}`,
    "---",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const contents = `${frontmatter}\n${markdown}\n`;
  const unchanged =
    fs.existsSync(file) && fs.readFileSync(file, "utf8") === contents;

  if (!unchanged && !DRY_RUN) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    fs.writeFileSync(file, contents);
  }

  return { pageId, slug, file, unchanged, downloaded, featured: meta.featured };
}

async function main() {
  const rootId = await resolveRootId();
  console.log(
    `syncing pages under "${ROOT_REF}" (${rootId}) marked "${PUBLISH_STATUS}"` +
      `${SPACE_KEY ? ` in space ${SPACE_KEY}` : ""} from ${BASE_URL}`,
  );

  const pages = await fetchReadyPages(rootId);
  const considered = await fetchDescendants(rootId);
  const ready = new Set(pages.map((page) => page.id));
  const withheld = considered.filter((page) => !ready.has(page.id));

  console.log(
    `  ${considered.length} pages under the root, ${pages.length} marked "${PUBLISH_STATUS}"`,
  );
  // Section pages and drafts are withheld on every single run, so naming them
  // each time would bury the actual changes. On demand only.
  if (DRY_RUN) {
    for (const page of withheld) {
      console.log(`  ~ ${page.title} withheld: not marked "${PUBLISH_STATUS}"`);
    }
  }

  if (pages.length === 0) {
    console.log(`nothing is marked "${PUBLISH_STATUS}" — nothing to publish`);
  }

  // Pass 1: decide what publishes, so cross-links resolve against that set.
  // Not `pages.map(prepare)` — map would pass the index as the root id.
  const prepared = pages.map((page) => prepare(page, rootId));
  const titleToSlug = new Map(
    prepared
      .filter((entry) => !entry.skipped)
      .map((entry) => [entry.page.title, entry.slug]),
  );

  // Pass 2: fetch attachments and write.
  const results = [];
  for (const entry of prepared) {
    if (entry.skipped) {
      results.push(entry);
      console.log(`  ~ ${entry.page.title} skipped: ${entry.skipped}`);
      continue;
    }

    const result = await writeProject(entry, titleToSlug);
    results.push(result);
    const state = result.unchanged ? "unchanged" : "written";
    const extra = [
      result.downloaded > 0 ? `${result.downloaded} attachments` : null,
      result.featured ? "featured" : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`  · ${result.slug} (${state}${extra ? `, ${extra}` : ""})`);
  }

  // Anything previously synced that is no longer published should leave the
  // site — whether its status changed or the page left the tree.
  const live = new Set(results.filter((r) => !r.skipped).map((r) => r.pageId));
  let removed = 0;
  for (const [id, file] of syncedProjects()) {
    if (live.has(id)) continue;
    if (!DRY_RUN) {
      fs.rmSync(file);
      fs.rmSync(path.join(ASSETS_DIR, id), { recursive: true, force: true });
    }
    removed += 1;
    console.log(`  − ${path.basename(file)} (unpublished)`);
  }

  const written = results.filter((r) => !r.skipped && !r.unchanged).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(
    DRY_RUN
      ? `dry run: ${written} would change, ${removed} would be removed, ${skipped} skipped`
      : `done: ${written} written, ${removed} removed, ${skipped} skipped`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
