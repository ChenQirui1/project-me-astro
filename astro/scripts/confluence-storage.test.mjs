import assert from "node:assert/strict";
import { test } from "node:test";
import { storageToMarkdown, firstParagraphText } from "./confluence-storage.mjs";

const options = {
  attachmentUrl: (filename) => `/img/confluence/12345/${filename}`,
  // Mirrors sync-confluence.mjs, which hands back a site-relative URL.
  pageLink: (title) => (title === "Known Page" ? "/blog/known-page" : null),
};

const convert = (storage) => storageToMarkdown(storage, options);

test("headings and paragraphs", () => {
  const md = convert("<h2>Section</h2><p>Body text.</p>");
  assert.equal(md, "## Section\n\nBody text.");
});

test("code macro keeps language and body", () => {
  const md = convert(
    `<ac:structured-macro ac:name="code">` +
      `<ac:parameter ac:name="language">javascript</ac:parameter>` +
      `<ac:plain-text-body><![CDATA[const x = 1 < 2;]]></ac:plain-text-body>` +
      `</ac:structured-macro>`,
  );
  assert.match(md, /```javascript/);
  assert.match(md, /const x = 1 < 2;/);
});

test("code macro without a language still fences", () => {
  const md = convert(
    `<ac:structured-macro ac:name="code">` +
      `<ac:plain-text-body><![CDATA[plain]]></ac:plain-text-body>` +
      `</ac:structured-macro>`,
  );
  assert.match(md, /```\nplain\n```/);
});

test("attachment images resolve to the R2 proxy URL", () => {
  const md = convert(
    `<p><ac:image ac:alt="A diagram">` +
      `<ri:attachment ri:filename="diagram.png" />` +
      `</ac:image></p>`,
  );
  assert.equal(md, "![A diagram](/img/confluence/12345/diagram.png)");
});

test("external images pass through untouched", () => {
  const md = convert(
    `<p><ac:image><ri:url ri:value="https://example.com/a.png" /></ac:image></p>`,
  );
  assert.equal(md, "![](https://example.com/a.png)");
});

test("info panel becomes a blockquote", () => {
  const md = convert(
    `<ac:structured-macro ac:name="info">` +
      `<ac:rich-text-body><p>Heads up.</p></ac:rich-text-body>` +
      `</ac:structured-macro>`,
  );
  assert.match(md, /^> /m);
  assert.match(md, /Heads up\./);
});

test("expand macro survives as the stylesheet's accordion", () => {
  const md = convert(
    `<ac:structured-macro ac:name="expand">` +
      `<ac:parameter ac:name="title">What the evidence forced</ac:parameter>` +
      `<ac:rich-text-body><p>Only 2 named it.</p></ac:rich-text-body>` +
      `</ac:structured-macro>`,
  );
  // Turndown's default rule for an unknown block drops the wrapper and keeps
  // the children, which would spill a collapsed block onto the page with its
  // title as a loose line. The element has to reach the page whole, carrying
  // the accordion classes style.css draws the disclosure from.
  assert.match(md, /<details class="accordion-item">/);
  assert.match(md, /<summary class="accordion-summary">What the evidence forced<\/summary>/);
  assert.match(md, /<div class="accordion-body"><p>Only 2 named it\.<\/p><\/div>/);
});

test("expand macro title decodes entities before escaping", () => {
  const md = convert(
    `<ac:structured-macro ac:name="expand">` +
      `<ac:parameter ac:name="title">Editorial TODO &mdash; not public</ac:parameter>` +
      `<ac:rich-text-body><p>Body.</p></ac:rich-text-body>` +
      `</ac:structured-macro>`,
  );
  assert.match(md, /<summary class="accordion-summary">Editorial TODO — not public<\/summary>/);
  assert.doesNotMatch(md, /&amp;mdash;/);
});

test("expand macro without a title still collapses", () => {
  const md = convert(
    `<ac:structured-macro ac:name="expand">` +
      `<ac:rich-text-body><p>No title given.</p></ac:rich-text-body>` +
      `</ac:structured-macro>`,
  );
  assert.match(md, /<summary class="accordion-summary">Details<\/summary>/);
});

test("internal link resolves when the target is synced", () => {
  const md = convert(
    `<p><ac:link><ri:page ri:content-title="Known Page" />` +
      `<ac:link-body>see this</ac:link-body></ac:link></p>`,
  );
  assert.equal(md, "[see this](/blog/known-page)");
});

test("internal link degrades to plain text when the target is not synced", () => {
  const md = convert(
    `<p><ac:link><ri:page ri:content-title="Private Page" />` +
      `<ac:link-body>see this</ac:link-body></ac:link></p>`,
  );
  assert.equal(md, "see this");
});

test("tables convert to GFM", () => {
  const md = convert(
    "<table><tbody>" +
      "<tr><th>Name</th><th>Value</th></tr>" +
      "<tr><td>alpha</td><td>1</td></tr>" +
      "</tbody></table>",
  );
  assert.match(md, /\| Name \| Value \|/);
  assert.match(md, /\| alpha \| 1 \|/);
});

test("lists survive", () => {
  const md = convert("<ul><li>one</li><li>two</li></ul>");
  assert.equal(md, "-   one\n-   two");
});

test("unknown macros are dropped but their rich body is kept", () => {
  const md = convert(
    `<ac:structured-macro ac:name="some-future-macro">` +
      `<ac:rich-text-body><p>kept</p></ac:rich-text-body>` +
      `</ac:structured-macro>`,
  );
  assert.equal(md, "kept");
});

test("self-closing macros vanish entirely", () => {
  const md = convert(`<p>before</p><ac:structured-macro ac:name="toc" /><p>after</p>`);
  assert.equal(md, "before\n\nafter");
});

test("no stray ac:/ri: markup survives a mixed document", () => {
  const md = convert(
    `<ac:layout><ac:layout-section ac:type="single"><ac:layout-cell>` +
      `<h1>Title</h1><p>Text with <ac:image><ri:attachment ri:filename="x.png" /></ac:image></p>` +
      `<ac:structured-macro ac:name="toc" />` +
      `</ac:layout-cell></ac:layout-section></ac:layout>`,
  );
  assert.doesNotMatch(md, /ac:|ri:/);
  assert.match(md, /# Title/);
});

test("firstParagraphText decodes typographic entities", () => {
  // Regression: only five entities used to be decoded, so a real page's
  // "Scaffold &mdash; documentation" leaked raw entity text into frontmatter.
  const text = firstParagraphText(
    "<p>Scaffold &mdash; docs &bull; more &hellip; &#8212; &#x2014;</p>",
  );
  assert.equal(text, "Scaffold — docs • more … — —");
});

test("firstParagraphText leaves unknown entities alone", () => {
  assert.equal(firstParagraphText("<p>a &nope; b</p>"), "a &nope; b");
});

test("firstParagraphText skips macros and decodes entities", () => {
  const text = firstParagraphText(
    `<ac:structured-macro ac:name="toc"><ac:parameter ac:name="x">y</ac:parameter></ac:structured-macro>` +
      `<p>Real &amp; first <strong>paragraph</strong>.</p><p>Second.</p>`,
  );
  assert.equal(text, "Real & first paragraph.");
});
