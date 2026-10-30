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

// A carousel, a captioned figure, a video and a collapsed block are raw HTML
// built by the passes below and have to reach the page intact. Turndown's
// default rule for an unknown block element keeps the children and drops the
// wrapper, which would leave a carousel's slides behind as loose images, a
// video as nothing at all, and an expand macro as its contents spilled onto
// the page with its title as a loose line; `keep` re-serializes the element,
// blank-line padded as a block. DETAILS covers its own SUMMARY, since keeping
// an element re-serializes its children with it.
turndown.keep(
  (node) =>
    node.nodeName === "VIDEO" ||
    node.nodeName === "FIGURE" ||
    node.nodeName === "DETAILS" ||
    (node.nodeName === "DIV" && node.getAttribute("class") === "carousel"),
);

const escapeHtml = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Attribute values need the quote escaped too, or a title containing one
// would close the attribute early.
const escapeAttr = (text) => escapeHtml(text).replace(/"/g, "&quot;");

const stripCdata = (text) =>
  text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

/** The caption field of a Confluence media node, as rich text. */
const CAPTION = /<ac:caption\b[^>]*>([\s\S]*?)<\/ac:caption>/;

/** Attachments a browser plays rather than shows. */
const PLAYABLE = /\.(?:mp4|webm|mov|m4v)$/i;

/**
 * True when this attachment is a clip. Exported so the sync can keep a clip
 * out of `thumbnail`, which feeds an `<img>` on the card and the hero.
 */
export const isPlayable = (filename) => PLAYABLE.test(filename);

/**
 * One media element: an `<img>`, or a `<video>` when the attachment is a clip.
 *
 * The caption rides along as `data-caption` rather than in markup of its own,
 * so every pass below still matches a single self-contained tag; `slide` and
 * `wrapCaptioned` are what turn it into a visible line under the visual.
 */
function mediaTag(src, { alt = "", caption = "" } = {}) {
  const data = caption ? ` data-caption="${escapeAttr(caption)}"` : "";
  if (PLAYABLE.test(src.replace(/[?#][\s\S]*$/, ""))) {
    // Controlled, because a clip is watched rather than glanced at — but muted
    // and looping, so it reads like the GIFs it sits beside.
    return `<video src="${src}"${data} controls muted loop playsinline preload="metadata"></video>`;
  }
  return `<img src="${src}" alt="${escapeHtml(alt)}"${data} />`;
}

/** Inline markup a caption keeps; any other tag is dropped, its text kept. */
const CAPTION_TAGS = /<(?!\/?(?:strong|b|em|i|code)\b)[^>]*>/g;

/**
 * A caption's own markup. The bold lead-in the pages are written with — `**The
 * panel.** Summary, Navigation and Chat.` — survives; block tags and anything
 * richer are flattened to their text. Entities are left encoded: `escapeAttr`
 * protects them for the ride in `data-caption`, and `caption` hands them back.
 */
const captionHtml = (html) =>
  html.replace(CAPTION_TAGS, " ").replace(/\s+/g, " ").trim();

/** Matches the caption attribute of a media tag, with the space before it. */
const CAPTION_ATTR = /\sdata-caption="([^"]*)"/;

/** Writes a caption attribute back out as the line under a visual. */
const caption = (value) =>
  value
    ? `<figcaption>${value.replace(/&(amp|lt|gt|quot);/g, (_full, name) => ESCAPED[name])}</figcaption>`
    : "";

const ESCAPED = { amp: "&", lt: "<", gt: ">", quot: '"' };

/** Attaches a caption to a media tag, leaving one it already carries alone. */
const withCaption = (tag, caption) =>
  CAPTION_ATTR.test(tag)
    ? tag
    : tag.replace(
        /^<(?:img|video)\b/,
        (open) => `${open} data-caption="${escapeAttr(caption)}"`,
      );

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

  // <ac:image><ri:attachment ri:filename="x.png"/></ac:image>, optionally with
  // the editor's own <ac:caption> under it. The node is the same for a clip:
  // Confluence embeds every media attachment this way, whatever its type.
  html = html.replace(
    /<ac:image\b([^>]*)>([\s\S]*?)<\/ac:image>/g,
    (_full, attrs, inner) => {
      const alt = /ac:alt="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const caption = captionHtml(CAPTION.exec(inner)?.[1] ?? "");
      const attachment = /<ri:attachment\s+ri:filename="([^"]+)"/.exec(inner)?.[1];
      if (attachment) {
        return mediaTag(attachmentUrl(attachment), { alt, caption });
      }
      const external = /<ri:url\s+ri:value="([^"]+)"/.exec(inner)?.[1];
      return external ? mediaTag(external, { alt, caption }) : "";
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
      // The parameter arrives as raw storage text, so an em dash or ampersand
      // in the title is still `&mdash;` / `&amp;` here. Escaping without
      // decoding first turns that into `&amp;mdash;` and the summary renders
      // the entity as literal text.
      const title = decodeEntities(params.title ?? "Details");
      // The classes are the stylesheet's own accordion (see `.accordion-item`
      // in src/styles/style.css), which draws the rule, the hazard-yellow
      // hover and the +/− mark from the element's open state. Without them a
      // collapsed block falls back to the browser's default triangle, which
      // is the one thing on the page that wouldn't look designed.
      return (
        `<details class="accordion-item">` +
        `<summary class="accordion-summary">${escapeHtml(title)}</summary>` +
        `<div class="accordion-body">${rich}</div>` +
        `</details>`
      );
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

/** Matches one heading element, capturing its level and inner HTML. */
const HEADING = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

/** Matches one paragraph, capturing its inner HTML. */
const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

/** Element boundaries a run of media could begin at. */
const BLOCK_START = /<(?:p|img|video)\b[^>]*>/gi;

/** One media element, image or clip. Self-contained, so a slide is one match. */
const MEDIA = /<img\b[^>]*>|<video\b[^>]*>[\s\S]*?<\/video>/g;

/** The same, unanchored and stateless, for testing a fragment. */
const HAS_MEDIA = /<(?:img|video)\b/;

/**
 * The hand-written marker: `[Gallery]`, or `[Gallery: Onboarding stills]` to
 * title it outright. `[Carousel]` reads the same. It matches the bracketed
 * notes the pages already carry (`[TBD]`, `[image of lexend font]`), which is
 * the point — it needs no macro and no particular editor.
 */
const MARKER = /\[\s*(?:gallery|carousel)\s*(?::\s*([^\]]*?))?\s*\]/i;

/** The same, anchored, for a paragraph that is nothing but the marker. */
const MARKER_ALONE = new RegExp(`^${MARKER.source}$`, "i");

/** A bold lead-in — `**Onboarding stills** — welcome, …` — used as a title. */
const BOLD_LEAD = /^\s*<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/;

/** One finished carousel, for reporting the slides back to the caller. */
const CAROUSEL = /<div class="carousel"[^>]*>[\s\S]*?<\/div>/g;

/**
 * What may precede the images in a heading's section: nothing, or a single
 * paragraph serving as the set's caption. A list, a table, a second paragraph
 * or an earlier image all mean this is a prose section that merely ends in
 * pictures.
 */
const LEADING_CAPTION = /^\s*(?:<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<\/p>\s*)?$/;

/**
 * A paragraph sitting directly above a visual, which the authoring convention
 * reads as its caption — `**Hero — onboarding.** Language is chosen first.`
 * and then the GIF. Anchored to the end of the fragment that precedes the
 * visual, and it tolerates the `<p>` the editor opens around the visual.
 */
const CAPTION_ABOVE = /<p\b[^>]*>((?:(?!<\/p>)[\s\S])*)<\/p>\s*(?:<p\b[^>]*>\s*)?$/;

/**
 * True when this fragment holds nothing but media. Paragraph wrappers and
 * line breaks are scaffolding the editor puts around them, so they don't
 * count; a single word of text does.
 */
const isMediaRun = (html) =>
  html
    .replace(MEDIA, "")
    .replace(/<\/?p\b[^>]*>|<br\s*\/?>/g, "")
    .trim() === "";

const plainText = (html) =>
  decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** Wraps a run of media as a carousel, deferring everything but the first. */
function carousel(media, title) {
  const slides = media.map((tag, i) => slide(tag, i === 0)).join("");
  const attribute = title ? ` data-title="${escapeAttr(title)}"` : "";
  return `<div class="carousel"${attribute}>${slides}</div>`;
}

/**
 * One slide: the visual, and under it the caption the visual carried.
 *
 * A figure per slide rather than one caption line the script swaps — the
 * captions are then on the page with no JavaScript, and the slides stretch to
 * a common height, so the frame doesn't resize as the captions change length.
 */
function slide(tag, first) {
  const carried = CAPTION_ATTR.exec(tag)?.[1] ?? "";
  let visual = tag.replace(CAPTION_ATTR, "");
  // The first slide is wanted up front. The rest are frequently animated GIFs,
  // which optimize.mjs passes through at full size on purpose, so loading a
  // whole set eagerly is expensive — and a clip is heavier still.
  if (!first) {
    visual = visual.startsWith("<video")
      ? visual.replace(' preload="metadata"', ' preload="none"')
      : visual.replace(/^<img\b/, '<img loading="lazy"');
  }
  return `<figure class="carousel-slide">${visual}${caption(carried)}</figure>`;
}

/**
 * Wraps media that kept a caption and never joined a carousel — a lone
 * screenshot with a caption of its own — in the same shape a slide has.
 * Slides have had their caption attribute spent by then, so this sees only
 * what is left.
 */
const wrapCaptioned = (html) =>
  html.replace(MEDIA, (tag) => {
    const carried = CAPTION_ATTR.exec(tag)?.[1];
    if (!carried) return tag;
    return `<figure class="media">${tag.replace(CAPTION_ATTR, "")}${caption(carried)}</figure>`;
  });

/**
 * Measures the run of media at the head of a fragment.
 *
 * Paragraph wrappers and line breaks are consumed along with the visuals, so
 * block images (bare, as the current editor writes them) and older
 * one-per-paragraph images measure the same. The run ends at the last visual —
 * or at the `</p>` closing it — never at the `<p>` that opens the prose after.
 *
 * @returns {{ media: string[], length: number }}
 */
function mediaRun(html) {
  const TOKEN =
    /^(?:\s+|<p\b[^>]*>|<\/p>|<br\s*\/?>|<img\b[^>]*>|<video\b[^>]*>[\s\S]*?<\/video>)/;
  const media = [];
  let at = 0;
  let end = 0;

  for (;;) {
    const match = TOKEN.exec(html.slice(at));
    if (!match) break;
    at += match[0].length;
    if (HAS_MEDIA.test(match[0])) {
      media.push(match[0]);
      end = at;
    } else if (media.length > 0 && match[0].startsWith("</p")) {
      end = at;
    }
  }
  return { media, length: end };
}

/** Applies non-overlapping edits, back to front so offsets stay valid. */
function splice(html, edits) {
  let out = html;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.html + out.slice(edit.end);
  }
  return out;
}

/**
 * Collapses every visual in a section whose heading carries the marker.
 *
 *   ### [Gallery] Onboarding stills
 *
 * The marker is stripped, so the heading renders as "Onboarding stills" and
 * titles the carousel. Being explicit, this pass is greedy and positional: it
 * takes every visual in the section wherever it sits, and does not care what
 * else is there — which is the point when a section ends in notes rather than
 * pictures, or when prose sits between the images. The carousel lands where
 * the first visual was.
 *
 * This is also the way in for a captioned set, the shape the real pages are
 * written in: a line of prose, the visual it describes, the next line, the
 * next visual. A paragraph directly above a visual is taken as that slide's
 * caption and moves into the slide; prose further from one stays in the copy.
 */
function collapseMarkedSections(html) {
  const headings = [...html.matchAll(HEADING)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    element: match[0],
    level: Number(match[1]),
    inner: match[2],
  }));

  const edits = [];

  headings.forEach((heading, index) => {
    const marker = MARKER.exec(heading.inner);
    if (!marker) return;

    // Strip it from the heading itself, along with the space it leaves behind.
    const at = heading.element.indexOf(marker[0]);
    edits.push({
      start: heading.start + at,
      end: heading.start + at + marker[0].length + (heading.element[at + marker[0].length] === " " ? 1 : 0),
      html: "",
    });

    // `[Gallery] Onboarding stills` titles itself; `[Gallery: x]` on its own
    // falls back to what the brackets carry.
    const rest = plainText(heading.inner.replace(marker[0], ""));
    const title = rest || marker[1]?.trim() || "";

    const next = headings.slice(index + 1).find((later) => later.level <= heading.level);
    const end = next ? next.start : html.length;
    const found = [...html.matchAll(MEDIA)].filter(
      (visual) => visual.index >= heading.end && visual.index < end,
    );
    if (found.length < 2) return;

    // A paragraph directly above a visual is its caption, and moves into the
    // slide with it; anything else in the section stays where it is.
    const media = found.map((visual) => {
      const above = CAPTION_ABOVE.exec(html.slice(heading.end, visual.index));
      // A paragraph holding a picture is a slide of its own, not a caption.
      if (!above || !plainText(above[1]) || HAS_MEDIA.test(above[1])) return visual[0];
      edits.push({ start: heading.end + above.index, end: visual.index, html: "" });
      return withCaption(visual[0], captionHtml(above[1]));
    });

    // The set gathers at the first visual; the others leave their places.
    edits.push({
      start: found[0].index,
      end: found[0].index + found[0][0].length,
      html: carousel(media, title),
    });
    for (const visual of found.slice(1)) {
      edits.push({ start: visual.index, end: visual.index + visual[0].length, html: "" });
    }
  });

  return splice(html, edits);
}

/**
 * Collapses the run of images after a `[Gallery]` marker.
 *
 * The marker may stand alone in its own paragraph or close the caption
 * paragraph above the images — `**Onboarding stills** — welcome, … [Gallery]`
 * — and is removed either way, so it never reaches the page. The title is
 * whatever followed a colon inside the brackets; failing that the bold lead-in
 * of the caption it sits in or follows; failing that the nearest heading above.
 *
 * Unlike the heading rule this is positional, so it doesn't care what comes
 * after the images — which is the reason to reach for it when a section ends
 * in notes rather than pictures.
 */
function collapseMarkedRuns(html) {
  const headings = [...html.matchAll(HEADING)].map((match) => ({
    start: match.index,
    title: plainText(match[2]),
  }));

  const edits = [];

  for (const paragraph of [...html.matchAll(PARAGRAPH)]) {
    const inner = paragraph[1];
    const text = plainText(inner);
    const alone = MARKER_ALONE.exec(text);
    const trailing = alone ? null : MARKER.exec(inner);
    // A marker mid-sentence is prose about galleries, not a marker.
    if (!alone && !(trailing && plainText(inner.slice(trailing.index + trailing[0].length)) === "")) {
      continue;
    }

    const paragraphEnd = paragraph.index + paragraph[0].length;
    const run = mediaRun(html.slice(paragraphEnd));
    // Always strip a marker, even when it turns out to lead nowhere, or it
    // renders as literal text on the page.
    if (alone) {
      edits.push({ start: paragraph.index, end: paragraphEnd, html: "" });
    } else {
      const at = paragraph.index + paragraph[0].indexOf(inner) + trailing.index;
      edits.push({ start: at, end: at + trailing[0].length, html: "" });
    }
    if (run.media.length < 2) continue;

    const explicit = (alone ?? trailing)[1]?.trim();
    const lead = BOLD_LEAD.exec(inner)?.[1];
    const heading = headings.filter((h) => h.start < paragraph.index).at(-1);
    // Only a paragraph in the marker's own stretch can lend its lead-in. One
    // from above the nearest heading is captioning a different section, and
    // that heading is the better title — so a heading in between ends the
    // search rather than being out-ranked by it.
    const above = [...html.slice(0, paragraph.index).matchAll(PARAGRAPH)].at(-1);
    const previous = above && above.index > (heading?.start ?? -1) ? above : null;
    const title =
      explicit ||
      (lead && plainText(lead)) ||
      (previous && plainText(BOLD_LEAD.exec(previous[1])?.[1] ?? "")) ||
      heading?.title ||
      "";

    edits.push({
      start: paragraphEnd,
      end: paragraphEnd + run.length,
      html: carousel(run.media, title),
    });
  }

  return splice(html, edits);
}

/**
 * Collapses a heading whose section is nothing but images.
 *
 * The authoring convention this implements: a heading, at most one line of
 * context, then nothing but images. Prose between or after the images
 * disqualifies the section, and so does a second paragraph before them —
 * without that limit a prose section whose last two illustrations happen to
 * sit side by side gets its tail collapsed and mistitled. Two images are the
 * minimum; one is just an illustration.
 *
 * Sections nest, so the innermost heading wins: a `## MEDIA INVENTORY`
 * holding three `### group` subsections yields three carousels, not one.
 */
function collapseImageOnlySections(html) {
  const headings = [...html.matchAll(HEADING)].map((match) => ({
    start: match.index,
    bodyStart: match.index + match[0].length,
    level: Number(match[1]),
    title: plainText(match[2]),
  }));

  const edits = [];
  // Leftmost offset already taken by a carousel. The headings are walked from
  // the end so a subsection claims its images before the section enclosing it
  // looks at them; the enclosing one then finds a heading in its body and is
  // disqualified, which is how the innermost heading comes to win.
  let claimed = html.length;

  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const heading = headings[index];
    // A section runs to the next heading at the same or a higher level.
    const next = headings
      .slice(index + 1)
      .find((later) => later.level <= heading.level);
    const end = Math.min(next ? next.start : html.length, claimed);
    const body = html.slice(heading.bodyStart, end);

    // The run is the earliest element boundary whose remainder is all images.
    // A carousel the marker pass already built is not an image, so a marked
    // section is simply passed over here.
    const offset = [...body.matchAll(BLOCK_START)]
      .map((match) => match.index)
      .find((at) => isMediaRun(body.slice(at)));
    if (offset === undefined) continue;
    if (!LEADING_CAPTION.test(body.slice(0, offset))) continue;

    const media = body.slice(offset).match(MEDIA) ?? [];
    if (media.length < 2) continue;

    edits.push({
      start: heading.bodyStart + offset,
      end: heading.bodyStart + body.length,
      html: carousel(media, heading.title),
    });
    claimed = heading.start;
  }

  return splice(html, edits);
}

/**
 * Turns media sets in a page body into carousels. Three ways in, most
 * explicit first:
 *
 *   `### [Gallery] Title`   every visual in the section, captions and all
 *   `[Gallery]` in the body the run of visuals that follows it
 *   no marker at all        a heading whose section is nothing but visuals
 *
 * A slide is a still, an animated GIF or a clip, with the caption it carried
 * under it. Whatever is left captioned and loose becomes a figure of its own.
 *
 * Runs on the lowered HTML — visuals are plain `<img>`/`<video>` and headings
 * plain `<h2>`/`<h3>` by then — and before Turndown, which keeps them whole.
 *
 * @param {string} html lowered HTML
 * @param {{ onCarousel?: (sources: string[]) => void }} options called once
 *   per carousel, in document order, with the slide URLs — the sync uses it to
 *   keep those images out of the page's flat media grid.
 */
export function collapseCarousels(html, { onCarousel } = {}) {
  // Most explicit first: a marked section is claimed whole before the other
  // two passes can take any of its images.
  const out = wrapCaptioned(
    collapseImageOnlySections(collapseMarkedRuns(collapseMarkedSections(html))),
  );

  if (onCarousel) {
    for (const match of out.matchAll(CAROUSEL)) {
      onCarousel(
        [...match[0].matchAll(/<(?:img|video)\b[^>]*\bsrc="([^"]*)"/g)].map((m) => m[1]),
      );
    }
  }
  return out;
}

/** Full pipeline: storage format in, Markdown out. */
export function storageToMarkdown(storage, options) {
  const html = lowerStorageToHtml(storage, options);
  return turndown
    .turndown(collapseCarousels(html, options))
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
