/**
 * Reads the catalogue metadata block off the top of a Confluence project page.
 *
 * Two shapes are accepted, because the archive is mid-migration:
 *
 *   a two-column table      | Slug | clearweb |
 *   a run of labelled lines  Slug: clearweb<br/>Year: 2021
 *
 * The line form also tolerates the bullet prefixes the existing pages use
 * (`&bull; Year: [TBD]`). Whichever block is found is removed from the body so
 * the metadata doesn't render twice.
 *
 * Placeholder values ([TBD], TBD, —, n/a, blank) are treated as absent, so a
 * scaffolded page yields no field rather than the literal string "[TBD]".
 */

import { decodeEntities } from "./confluence-storage.mjs";

/** Canonical field name for each label the pages might use. */
const FIELD_ALIASES = new Map(
  Object.entries({
    slug: "slug",
    year: "year",
    type: "projectType",
    projecttype: "projectType",
    discipline: "disciplines",
    disciplines: "disciplines",
    disciplineprojecttype: "disciplines",
    context: "context",
    status: "status",
    documentation: "documentation",
    documentationstatus: "documentation",
    publication: "publication",
    publicationstatus: "publication",
    featured: "featured",
    heromedia: "heroMedia",
    hero: "heroMedia",
    summary: "summary",
    onesentencesummary: "summary",
    role: "role",
    collaborators: "collaborators",
    duration: "duration",
    disclosurelimits: "disclosureLimits",
  }),
);

const PLACEHOLDER = /^(?:\[?tbd\]?|n\/?a|none|—|-|–)$/i;

const normalizeKey = (raw) =>
  raw
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]/g, "");

const stripTags = (html) => decodeEntities(html.replace(/<[^>]+>/g, " "));

/**
 * Splits "a, b and c" into a clean list.
 *
 * Separators inside brackets are left alone, so a qualified entry like
 * "website redesign (information architecture, UI mockups)" stays one
 * discipline instead of breaking into two unbalanced halves.
 */
export function parseList(value) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const token of value.split(/(\(|\)|,|;|\/|\band\b)/i)) {
    if (token === "(") depth += 1;
    else if (token === ")") depth = Math.max(0, depth - 1);

    const isSeparator = depth === 0 && /^(?:,|;|\/|and)$/i.test(token);
    if (isSeparator) {
      parts.push(current);
      current = "";
      continue;
    }
    current += token;
  }
  parts.push(current);

  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !PLACEHOLDER.test(part));
}

export function parseBoolean(value) {
  return /^(?:yes|true|y|✓|x)$/i.test(value.trim());
}

/**
 * Recognizes a label/value pair.
 *
 * Whether a block *is* the metadata block is decided by its labels, not its
 * values — a freshly scaffolded page is all [TBD] and must still be recognized
 * (and stripped), otherwise the placeholders render as body content. So this
 * returns an entry for any known label, with `value: null` when the value is
 * only a placeholder.
 */
function toField(rawKey, rawValue) {
  const field = FIELD_ALIASES.get(normalizeKey(rawKey));
  if (!field) return null;

  const value = rawValue.replace(/\s+/g, " ").trim();
  const usable = value.length > 0 && !PLACEHOLDER.test(value);

  return { field, value: usable ? value : null };
}

/** Metadata held in a leading two-column table. */
function fromTable(storage) {
  const tableMatch = /<table\b[\s\S]*?<\/table>/i.exec(storage);
  if (!tableMatch) return null;

  const rows = tableMatch[0].match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const fields = new Map();
  let recognized = 0;

  for (const row of rows) {
    const cells = row.match(/<t[hd]\b[\s\S]*?<\/t[hd]>/gi) ?? [];
    if (cells.length !== 2) continue;
    const entry = toField(stripTags(cells[0]), stripTags(cells[1]));
    if (!entry) continue;
    recognized += 1;
    if (entry.value !== null) fields.set(entry.field, entry.value);
  }

  // Only claim the table if it really is the metadata block and not, say, a
  // comparison table that happens to lead the page.
  if (recognized < 2) return null;

  return {
    fields,
    storage: storage.replace(tableMatch[0], ""),
  };
}

/** Metadata held in labelled lines inside one or more paragraphs. */
function fromLines(storage) {
  const paragraphs = storage.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [];
  const fields = new Map();
  const consumed = [];

  for (const paragraph of paragraphs) {
    const lines = paragraph
      .replace(/<\/?p\b[^>]*>/gi, "")
      .split(/<br\s*\/?>/i)
      .map((line) => stripTags(line).trim())
      .filter(Boolean);

    const matched = [];
    for (const line of lines) {
      // Strip a leading bullet, then split on the first colon.
      const cleaned = line.replace(/^[•·*\-]\s*/, "");
      const split = /^([^:]{1,40}):\s*(.*)$/.exec(cleaned);
      if (!split) continue;
      const entry = toField(split[1], split[2]);
      if (entry) matched.push(entry);
    }

    // A paragraph is a metadata block only if it is mostly labelled fields,
    // counted by label so an all-[TBD] scaffold still qualifies.
    if (matched.length >= 2 && matched.length >= lines.length / 2) {
      for (const { field, value } of matched) {
        if (value !== null && !fields.has(field)) fields.set(field, value);
      }
      consumed.push(paragraph);
    }
  }

  // Keyed on blocks consumed, not fields captured: an all-placeholder block
  // yields no fields but must still be stripped from the body.
  if (consumed.length === 0) return null;

  let stripped = storage;
  for (const paragraph of consumed) stripped = stripped.replace(paragraph, "");
  return { fields, storage: stripped };
}

/**
 * Metadata held in a bulleted list, one field per item.
 *
 * Confluence's editor writes a bullet list as `<li><p>Year: 2026</p></li>`, so
 * every field sits alone in its own paragraph. `fromLines` cannot see those —
 * it needs two or more fields inside a single paragraph — so the list gets its
 * own shape, with the whole `<ul>` as the candidate block rather than the
 * paragraphs inside it.
 */
function fromList(storage) {
  const lists = storage.match(/<ul\b[\s\S]*?<\/ul>/gi) ?? [];
  const fields = new Map();
  const consumed = [];

  for (const list of lists) {
    const items = (list.match(/<li\b[\s\S]*?<\/li>/gi) ?? [])
      .map((item) => stripTags(item).replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const matched = [];
    for (const item of items) {
      const cleaned = item.replace(/^[•·*\-]\s*/, "");
      const split = /^([^:]{1,40}):\s*(.*)$/.exec(cleaned);
      if (!split) continue;
      const entry = toField(split[1], split[2]);
      if (entry) matched.push(entry);
    }

    // The same test the paragraph form uses: mostly labelled fields, counted
    // by label so an all-[TBD] scaffold still qualifies. It keeps prose lists
    // whose items happen to contain a colon from being claimed.
    if (matched.length >= 2 && matched.length >= items.length / 2) {
      for (const { field, value } of matched) {
        if (value !== null && !fields.has(field)) fields.set(field, value);
      }
      consumed.push(list);
    }
  }

  if (consumed.length === 0) return null;

  let stripped = storage;
  for (const list of consumed) stripped = stripped.replace(list, "");
  return { fields, storage: stripped };
}

/**
 * @returns {{ fields: Map<string,string>, storage: string }} the metadata found
 *   and the body with that block removed.
 */
export function extractMetadata(storage) {
  return (
    fromTable(storage) ??
    fromLines(storage) ??
    fromList(storage) ?? { fields: new Map(), storage }
  );
}

/** Shapes raw fields into the values the content schema expects. */
export function normalizeMetadata(fields) {
  const get = (name) => fields.get(name) ?? null;
  const year = get("year");
  const parsedYear = year ? Number.parseInt(year.replace(/\D/g, ""), 10) : null;

  return {
    slug: get("slug")?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? null,
    year: Number.isFinite(parsedYear) ? parsedYear : null,
    projectType: get("projectType"),
    disciplines: get("disciplines") ? parseList(get("disciplines")) : [],
    context: get("context"),
    status: get("status")?.toLowerCase() ?? null,
    documentation: get("documentation")?.toLowerCase() ?? null,
    publication: get("publication")?.toLowerCase() ?? null,
    featured: get("featured") ? parseBoolean(get("featured")) : false,
    heroMedia: get("heroMedia"),
    summary: get("summary"),
    role: get("role"),
    collaborators: get("collaborators") ? parseList(get("collaborators")) : [],
  };
}

/**
 * Headed sections of the page template that are notes to the editor, not
 * copy for the reader. Each is dropped from the body along with its heading.
 */
const INTERNAL_SECTIONS = new Set([
  "currentdocumentationcondition",
  "documentationcondition",
  "jirastory",
  "projectmetadata",
]);

/** Headed sections whose text becomes a field, then leaves the body. */
const FIELD_SECTIONS = new Map([
  ["onesentencesummary", "summary"],
  ["summary", "summary"],
]);

const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

/**
 * Removes the template's editor-facing sections, and lifts the one-sentence
 * summary into a field so it becomes the description rather than whatever
 * paragraph happens to lead the page.
 *
 * A section runs from its heading to the next heading at the same or a higher
 * level. Run this after `extractMetadata`: the metadata block sits under the
 * "Project metadata" heading and must be read before that section is dropped.
 *
 * @returns {{ fields: Map<string,string>, storage: string }}
 */
export function extractSections(storage) {
  const headings = [...storage.matchAll(HEADING)].map((match) => ({
    start: match.index,
    bodyStart: match.index + match[0].length,
    level: Number(match[1]),
    key: normalizeKey(stripTags(match[2])),
  }));

  const fields = new Map();
  const cuts = [];

  headings.forEach((heading, i) => {
    const internal = INTERNAL_SECTIONS.has(heading.key);
    const field = FIELD_SECTIONS.get(heading.key);
    if (!internal && !field) return;

    const next = headings
      .slice(i + 1)
      .find((later) => later.level <= heading.level);
    const end = next ? next.start : storage.length;

    if (field && !fields.has(field)) {
      const text = stripTags(storage.slice(heading.bodyStart, end))
        .replace(/\s+/g, " ")
        // Tags strip to a space, which strands punctuation after inline markup.
        .replace(/\s+([.,;:!?)])/g, "$1")
        .trim();
      if (text && !PLACEHOLDER.test(text)) fields.set(field, text);
    }
    cuts.push([heading.start, end]);
  });

  // Cut from the back so earlier offsets stay valid.
  let stripped = storage;
  for (const [start, end] of cuts.reverse()) {
    stripped = stripped.slice(0, start) + stripped.slice(end);
  }
  return { fields, storage: stripped };
}
