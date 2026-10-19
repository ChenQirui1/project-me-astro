/**
 * Confluence "storage format" -> Markdown.
 *
 * Storage format is XHTML carrying Confluence's own namespaced elements
 * (`ac:` for macros, `ri:` for resource identifiers). Turndown only
 * understands vanilla HTML, and the DOM parser it uses in Node mangles
 * namespaced tags — so the `ac:`/`ri:` constructs are lowered to plain HTML
 * first, and only then handed to Turndown.
 */

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
});
turndown.use(gfm);

// Confluence emits <br /> inside table cells and headings; keep them harmless.
turndown.addRule("lineBreak", {
  filter: "br",
  replacement: () => "\n",
});

const escapeHtml = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const stripCdata = (text) =>
  text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

// Confluence writes typographic characters as named entities (&mdash;, &bull;,
// &hellip;). Turndown decodes them for body content, but the description is
// built by stripping tags directly, so it needs its own decoder — otherwise
// raw entity text ends up in the frontmatter and renders literally.
const NAMED_ENTITIES = {
  amp: "&", apos: "'", bull: "•", copy: "©", deg: "°", gt: ">",
  hellip: "…", laquo: "«", ldquo: "“", lsquo: "‘", lt: "<", mdash: "—",
  middot: "·", nbsp: " ", ndash: "–", quot: '"', raquo: "»", rdquo: "”",
  reg: "®", rsquo: "’", times: "×", trade: "™",
};

// Accented letters are the other family Confluence emits — it writes "café" as
// "caf&eacute;" — so without these any project touching a non-ASCII name leaks
// raw entity text. These are the names for U+00C0–U+00FF in order, so the table
// builds itself rather than spelling out sixty-odd mechanical entries.
const LATIN1_NAMES = (
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc " +
  "Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml " +
  "times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc " +
  "euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml " +
  "divide oslash ugrave uacute ucirc uuml yacute thorn yuml"
).split(" ");

for (const [index, name] of LATIN1_NAMES.entries()) {
  NAMED_ENTITIES[name] ??= String.fromCodePoint(0xc0 + index);
}

export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Reject anything outside the Unicode range rather than throwing.
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    // Case-sensitive first: &Eacute; and &eacute; are different letters. The
    // lowercase fallback keeps the punctuation names working when shouted.
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Pulls `<ac:parameter ac:name="x">v</ac:parameter>` values out of a macro. */
function macroParams(body) {
  const params = {};
  const re = /<ac:parameter\s+ac:name="([^"]+)"\s*>([\s\S]*?)<\/ac:parameter>/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    params[match[1]] = stripCdata(match[2]).trim();
  }
  return params;
}

/** Matches one whole `<ac:structured-macro …>…</ac:structured-macro>` block. */
const MACRO = /<ac:structured-macro\s+([^>]*?)>([\s\S]*?)<\/ac:structured-macro>/g;
const SELF_CLOSING_MACRO = /<ac:structured-macro\s+[^>]*?\/>/g;

const PANEL_LABELS = {
  info: "ℹ️ ",
  note: "📝 ",
  tip: "💡 ",
  warning: "⚠️ ",
};

/**
 * Lowers Confluence macros/images/links into ordinary HTML.
 *
 * @param {string} storage raw storage-format XHTML
 * @param {object} options
 * @param {(filename: string) => string} options.attachmentUrl resolves an
 *   attachment filename to the URL it will be served from
 * @param {(title: string) => string | null} options.pageLink resolves an
 *   internal page title to a site-relative URL, or null if it isn't synced
 */
export function lowerStorageToHtml(storage, { attachmentUrl, pageLink }) {
  let html = storage;

  // <ac:image><ri:attachment ri:filename="x.png"/></ac:image>
  html = html.replace(
    /<ac:image\b([^>]*)>([\s\S]*?)<\/ac:image>/g,
    (_full, attrs, inner) => {
      const alt = /ac:alt="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const attachment = /<ri:attachment\s+ri:filename="([^"]+)"/.exec(inner)?.[1];
      if (attachment) {
        return `<img src="${attachmentUrl(attachment)}" alt="${escapeHtml(alt)}" />`;
      }
      const external = /<ri:url\s+ri:value="([^"]+)"/.exec(inner)?.[1];
      return external ? `<img src="${external}" alt="${escapeHtml(alt)}" />` : "";
    },
  );
  // Self-closing form, seen on some older pages.
  html = html.replace(/<ac:image\b[^>]*\/>/g, "");

  // Macros with bodies.
  html = html.replace(MACRO, (full, attrs, body) => {
    const name = /ac:name="([^"]+)"/.exec(attrs)?.[1];

    if (name === "code") {
      const params = macroParams(body);
      const code = stripCdata(
        /<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/.exec(body)?.[1] ?? "",
      );
      const language = params.language ?? "";
      const cls = language ? ` class="language-${language}"` : "";
      return `<pre><code${cls}>${escapeHtml(code)}</code></pre>`;
    }

    if (name in PANEL_LABELS) {
      const rich =
        /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/.exec(body)?.[1] ?? "";
      return `<blockquote><p>${PANEL_LABELS[name]}</p>${rich}</blockquote>`;
    }

    if (name === "expand") {
      const params = macroParams(body);
      const rich =
        /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/.exec(body)?.[1] ?? "";
      const title = params.title ?? "Details";
      return `<details><summary>${escapeHtml(title)}</summary>${rich}</details>`;
    }

    // Layout-ish macros carry content worth keeping; everything else
    // (toc, children, jira, …) has no meaning on a static site.
    const rich =
      /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/.exec(body)?.[1] ?? "";
    return rich;
  });
  html = html.replace(SELF_CLOSING_MACRO, "");

  // <ac:link><ri:page ri:content-title="Other"/><ac:link-body>text</ac:link-body></ac:link>
  html = html.replace(
    /<ac:link\b[^>]*>([\s\S]*?)<\/ac:link>/g,
    (_full, inner) => {
      const title = /<ri:page\s+[^>]*ri:content-title="([^"]+)"/.exec(inner)?.[1];
      const bodyText =
        /<ac:(?:link-body|plain-text-link-body)>([\s\S]*?)<\/ac:(?:link-body|plain-text-link-body)>/
          .exec(inner)?.[1] ?? title ?? "";
      const text = stripCdata(bodyText);
      if (!title) return text;
      const href = pageLink(title);
      return href ? `<a href="${href}">${text}</a>` : text;
    },
  );

  // Layout scaffolding contributes nothing to a single-column article.
  html = html
    .replace(/<\/?ac:layout(?:-section|-cell)?\b[^>]*>/g, "")
    .replace(/<ac:task-list\b[^>]*>([\s\S]*?)<\/ac:task-list>/g, "$1")
    .replace(/<ac:task\b[^>]*>([\s\S]*?)<\/ac:task>/g, "<p>$1</p>")
    .replace(/<\/?ac:task-(?:id|uuid|status|body)\b[^>]*>/g, "")
    .replace(/<ac:placeholder\b[^>]*>[\s\S]*?<\/ac:placeholder>/g, "");

  // Anything namespaced that survived is structural noise — drop the tags,
  // keep whatever text sat inside them.
  html = html.replace(/<\/?(?:ac|ri):[^>]*>/g, "");

  return html;
}

/** Full pipeline: storage format in, Markdown out. */
export function storageToMarkdown(storage, options) {
  const html = lowerStorageToHtml(storage, options);
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text of the first real paragraph, for the description frontmatter. */
export function firstParagraphText(storage) {
  const withoutMacros = storage.replace(MACRO, "").replace(SELF_CLOSING_MACRO, "");
  const match = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(withoutMacros);
  if (!match) return "";
  return decodeEntities(match[1].replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
