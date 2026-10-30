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
  assert.match(md, /<\/details>/);
});

test("expand macro title decodes entities before escaping", () => {
  const md = convert(
    `<ac:structured-macro ac:name="expand">` +
      `<ac:parameter ac:name="title">Editorial TODO &mdash; not public</ac:parameter>` +
      `<ac:rich-text-body><p>Body.</p></ac:rich-text-body>` +
      `</ac:structured-macro>`,
  );
  // Confluence hands the parameter back as raw storage text, so escaping it
  // without decoding first renders `&amp;mdash;` as literal text in the
  // summary rather than the dash the author typed.
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

// --- Carousels -----------------------------------------------------------
// A heading whose section is nothing but images becomes one carousel, titled
// by that heading. See `collapseCarousels` for the convention.

const img = (name) => `<ac:image><ri:attachment ri:filename="${name}" /></ac:image>`;

test("a heading over a run of images becomes one carousel", () => {
  const md = convert(`<h3>Onboarding stills</h3>${img("a.png")}${img("b.png")}`);
  assert.match(md, /^### Onboarding stills$/m);
  assert.match(md, /<div class="carousel" data-title="Onboarding stills">/);
  assert.match(md, /src="\/img\/confluence\/12345\/a\.png"/);
  assert.match(md, /src="\/img\/confluence\/12345\/b\.png"/);
  // No loose markdown images left beside the carousel.
  assert.doesNotMatch(md, /!\[/);
});

test("only the first slide loads eagerly", () => {
  const md = convert(`<h3>Set</h3>${img("a.gif")}${img("b.gif")}${img("c.gif")}`);
  assert.equal((md.match(/loading="lazy"/g) ?? []).length, 2);
  // The eager one is the first.
  assert.match(md, /<img src="[^"]*a\.gif"/);
  assert.doesNotMatch(md, /<img loading="lazy" src="[^"]*a\.gif"/);
});

test("every slide is a figure, so a caption can sit under the visual", () => {
  const md = convert(`<h3>Set</h3>${img("a.png")}${img("b.png")}`);
  assert.equal((md.match(/<figure class="carousel-slide">/g) ?? []).length, 2);
});

test("a caption above the images survives as an intro", () => {
  const md = convert(
    `<h3>Side panel stills</h3><p>Summary, Navigation and Chat.</p>` +
      img("one.png") +
      img("two.png"),
  );
  assert.match(md, /Summary, Navigation and Chat\./);
  assert.match(md, /<div class="carousel"/);
});

test("a prose section that merely ends in two images is not a carousel", () => {
  // The real shape on agung-keramik-redesign's LIVE BUILD section: paragraph,
  // image, paragraph, image … and the last two images adjacent. Collapsing
  // that tail would title two unrelated illustrations after the whole section.
  const md = convert(
    `<h2>Live build</h2><p>The catalogue is exchanged for a contact.</p>` +
      img("form.jpg") +
      `<p>A small, deliberate range.</p>` +
      img("line-up.jpg") +
      img("detail.jpg"),
  );
  assert.doesNotMatch(md, /carousel/);
});

test("only one paragraph may precede the images", () => {
  const md = convert(
    `<h3>Stills</h3><p>One.</p><p>Two.</p>${img("a.png")}${img("b.png")}`,
  );
  assert.doesNotMatch(md, /carousel/);
});

test("prose between the images disqualifies the section", () => {
  const md = convert(`<h3>Demos</h3>${img("a.gif")}<p>A note.</p>${img("b.gif")}`);
  assert.doesNotMatch(md, /carousel/);
  assert.equal((md.match(/!\[/g) ?? []).length, 2);
});

test("prose after the images disqualifies the section", () => {
  const md = convert(`<h3>Demos</h3>${img("a.gif")}${img("b.gif")}<p>Trailing note.</p>`);
  assert.doesNotMatch(md, /carousel/);
  assert.match(md, /Trailing note\./);
});

test("a lone image stays an image", () => {
  const md = convert(`<h3>Hero</h3>${img("solo.png")}`);
  assert.doesNotMatch(md, /carousel/);
  assert.match(md, /!\[\]\(\/img\/confluence\/12345\/solo\.png\)/);
});

test("images with no heading above them are left alone", () => {
  const md = convert(`<p>Intro.</p>${img("a.png")}${img("b.png")}`);
  assert.doesNotMatch(md, /carousel/);
});

test("each image in its own paragraph still reads as a run", () => {
  // Confluence writes block images bare, but older pages wrap them in <p>.
  const md = convert(
    `<h3>Stills</h3><p>${img("a.png")}</p><p>${img("b.png")}</p>`,
  );
  assert.match(md, /<div class="carousel" data-title="Stills">/);
  assert.equal((md.match(/<img/g) ?? []).length, 2);
});

test("the innermost heading wins when sections nest", () => {
  // The shape of the real MEDIA INVENTORY section: prose and standalone GIFs
  // under an h2, then three h3 groups. Three carousels, not one.
  const md = convert(
    `<h2>Media inventory</h2><p>All media is attached to this page.</p>` +
      img("onboarding.gif") +
      `<p>The panel against a real page.</p>` +
      img("panel.gif") +
      `<h3>Onboarding stills</h3>${img("o1.png")}${img("o2.png")}${img("o3.png")}` +
      `<h3>Side panel stills</h3>${img("s1.png")}${img("s2.png")}` +
      `<h3>Content script</h3>${img("c1.png")}${img("c2.png")}`,
  );
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 3);
  assert.match(md, /data-title="Onboarding stills"/);
  assert.match(md, /data-title="Side panel stills"/);
  assert.match(md, /data-title="Content script"/);
  // The two standalone GIFs above the subsections stay inline images.
  assert.match(md, /!\[\]\(\/img\/confluence\/12345\/onboarding\.gif\)/);
  assert.match(md, /!\[\]\(\/img\/confluence\/12345\/panel\.gif\)/);
  assert.doesNotMatch(md, /carousel[^>]*>\s*<img src="[^"]*onboarding/);
});

// `[Gallery]` in the heading is the explicit way in: the section is claimed
// whole, whatever else is in it.

test("a [Gallery] heading claims every image in its section", () => {
  const md = convert(
    `<h3>[Gallery] Onboarding stills</h3>${img("a.png")}${img("b.png")}`,
  );
  assert.match(md, /^### Onboarding stills$/m);
  assert.match(md, /data-title="Onboarding stills"/);
  assert.doesNotMatch(md, /Gallery/);
});

test("two [Gallery] headings make two carousels", () => {
  const md = convert(
    `<h3>[Gallery] Something 1</h3>${img("a.png")}${img("b.png")}` +
      `<h3>[Gallery] Something 2</h3>${img("c.png")}${img("d.png")}`,
  );
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 2);
  assert.match(md, /data-title="Something 1"/);
  assert.match(md, /data-title="Something 2"/);
});

test("a marked section keeps notes that follow the images", () => {
  // The shape that defeats the unmarked rule: a section ending in notes.
  const md = convert(
    `<h3>[Gallery] Content script</h3>${img("a.png")}${img("b.png")}` +
      `<ul><li>Video: demo.mkv</li></ul>`,
  );
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 1);
  assert.match(md, /Video: demo\.mkv/);
});

test("a marked section gathers images that prose sits between", () => {
  const md = convert(
    `<h3>[Gallery] Demos</h3><p>The panel.</p>${img("a.gif")}` +
      `<p>The magnifier.</p>${img("b.gif")}`,
  );
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 1);
  assert.equal((md.match(/<img/g) ?? []).length, 2);
  // The paragraph above a visual is its caption, and travels with it.
  assert.match(md, /<img src="[^"]*a\.gif"[^>]*><figcaption>The panel\.<\/figcaption>/);
  assert.match(md, /<figcaption>The magnifier\.<\/figcaption>/);
  // And is gone from the copy, where it would otherwise read twice.
  assert.doesNotMatch(md, /^The panel\.$/m);
});

test("prose that is not a caption stays in a marked section", () => {
  // Only the paragraph directly above a visual is read as its caption; the
  // section's own intro is a paragraph away from the first one.
  const md = convert(
    `<h3>[Gallery] Demos</h3><p>All media is attached to this page.</p>` +
      `<p>The panel.</p>${img("a.gif")}${img("b.gif")}`,
  );
  assert.match(md, /^All media is attached to this page\.$/m);
  assert.match(md, /<figcaption>The panel\.<\/figcaption>/);
});

test("a Confluence caption becomes the slide's caption", () => {
  const captioned = (name, caption) =>
    `<ac:image><ri:attachment ri:filename="${name}" />` +
    `<ac:caption><p>${caption}</p></ac:caption></ac:image>`;
  const md = convert(
    `<h3>Stills</h3>${captioned("a.png", "The welcome step.")}` +
      captioned("b.png", "Visual preferences, previewed live."),
  );
  assert.match(md, /<figcaption>The welcome step\.<\/figcaption>/);
  assert.match(md, /<figcaption>Visual preferences, previewed live\.<\/figcaption>/);
  // The caption is a line on the page, never an attribute left on the tag.
  assert.doesNotMatch(md, /data-caption/);
});

test("a caption keeps its bold lead-in and its typographic entities", () => {
  // How the real pages are written: a bold lead, an em dash, then the detail.
  const md = convert(
    `<h3>[Gallery] Demos</h3>` +
      `<p><strong>The panel</strong> &mdash; Summary, Navigation and Chat.</p>` +
      img("a.gif") +
      `<p><strong>The magnifier</strong> &mdash; no API call at all.</p>` +
      img("b.gif"),
  );
  assert.match(
    md,
    /<figcaption><strong>The panel<\/strong> — Summary, Navigation and Chat\.<\/figcaption>/,
  );
  // Richer markup than emphasis is flattened rather than carried through.
  const flattened = convert(
    `<h3>[Gallery] Demos</h3><p><span style="color: red">Red</span> note.</p>` +
      img("a.gif") +
      `<p>Second.</p>${img("b.gif")}`,
  );
  assert.match(flattened, /<figcaption>Red note\.<\/figcaption>/);
});

test("a Confluence caption beats the paragraph above the visual", () => {
  const md = convert(
    `<h3>[Gallery] Demos</h3><p>The panel.</p>` +
      `<ac:image><ri:attachment ri:filename="a.gif" />` +
      `<ac:caption><p>The panel, against a real page.</p></ac:caption></ac:image>` +
      img("b.gif"),
  );
  assert.match(md, /<figcaption>The panel, against a real page\.<\/figcaption>/);
});

test("a lone captioned visual becomes a figure of its own", () => {
  const md = convert(
    `<ac:image><ri:attachment ri:filename="hero.gif" />` +
      `<ac:caption><p>Onboarding, start to finish.</p></ac:caption></ac:image>`,
  );
  assert.doesNotMatch(md, /carousel/);
  assert.match(
    md,
    /<figure class="media"><img src="[^"]*hero\.gif"[^>]*><figcaption>Onboarding, start to finish\.<\/figcaption><\/figure>/,
  );
});

// Confluence embeds every media attachment as <ac:image>, clips included.

test("a clip attachment becomes a video", () => {
  const md = convert(img("demo.mp4"));
  assert.match(md, /<video src="\/img\/confluence\/12345\/demo\.mp4"/);
  assert.match(md, /controls/);
  assert.doesNotMatch(md, /!\[/);
});

test("a set mixing stills and clips is one carousel", () => {
  const md = convert(`<h3>Runs</h3>${img("a.png")}${img("run.mp4")}${img("b.gif")}`);
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 1);
  assert.equal((md.match(/<figure class="carousel-slide">/g) ?? []).length, 3);
  // A clip off screen fetches nothing until it is reached.
  assert.match(md, /<video[^>]*preload="none"/);
});

test("a clip leading a set keeps its metadata preload", () => {
  const md = convert(`<h3>Runs</h3>${img("run.mp4")}${img("b.gif")}`);
  assert.match(md, /<video[^>]*preload="metadata"/);
});

test("onCarousel reports a clip's URL alongside the stills", () => {
  const seen = [];
  storageToMarkdown(`<h3>Runs</h3>${img("a.png")}${img("run.mp4")}`, {
    ...options,
    onCarousel: (sources) => seen.push(sources),
  });
  assert.deepEqual(seen, [
    ["/img/confluence/12345/a.png", "/img/confluence/12345/run.mp4"],
  ]);
});

test("a marked heading with one image drops the marker and nothing else", () => {
  const md = convert(`<h3>[Gallery] Hero</h3>${img("solo.png")}`);
  assert.doesNotMatch(md, /carousel/);
  assert.match(md, /^### Hero$/m);
});

test("a marked section does not reach into the next section", () => {
  const md = convert(
    `<h3>[Gallery] First</h3>${img("a.png")}${img("b.png")}` +
      `<h3>Second</h3><p>Prose.</p>${img("c.png")}`,
  );
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 1);
  assert.match(md, /!\[\]\(\/img\/confluence\/12345\/c\.png\)/);
});

test("a marked h2 covers its subsections", () => {
  // Deliberate: the marker is explicit, so it claims the whole section.
  const md = convert(
    `<h2>[Gallery] Media</h2>${img("a.png")}<h3>More</h3>${img("b.png")}`,
  );
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 1);
  assert.match(md, /data-title="Media"/);
});

// A hand-written `[Gallery]` marker is the other way in: positional, so it
// doesn't care what follows the images, and it needs no macro.

test("a [Gallery] marker collapses the run of images after it", () => {
  const md = convert(`<p>[Gallery]</p>${img("a.png")}${img("b.png")}`);
  assert.match(md, /<div class="carousel">/);
  assert.doesNotMatch(md, /\[Gallery\]/);
});

test("[Carousel] reads the same", () => {
  const md = convert(`<p>[Carousel]</p>${img("a.png")}${img("b.png")}`);
  assert.match(md, /<div class="carousel">/);
});

test("a colon inside the brackets titles the set outright", () => {
  const md = convert(`<p>[Gallery: Onboarding stills]</p>${img("a.png")}${img("b.png")}`);
  assert.match(md, /data-title="Onboarding stills"/);
});

test("a marker closing the caption keeps the caption and takes its bold lead", () => {
  // How the real pages are written: a bold lead-in, the caption, the marker.
  const md = convert(
    `<p><strong>Onboarding stills</strong> &mdash; welcome, visual preferences. [Gallery]</p>` +
      img("a.png") +
      img("b.png"),
  );
  assert.match(md, /data-title="Onboarding stills"/);
  assert.match(md, /welcome, visual preferences\./);
  assert.doesNotMatch(md, /\[Gallery\]/);
});

test("a standalone marker takes the bold lead of the caption above it", () => {
  const md = convert(
    `<p><strong>Side panel stills</strong> &mdash; Summary, Navigation, Chat.</p>` +
      `<p>[Gallery]</p>${img("a.png")}${img("b.png")}`,
  );
  assert.match(md, /data-title="Side panel stills"/);
});

test("a marker with no caption falls back to the nearest heading", () => {
  const md = convert(`<h2>Live build</h2><p>[Gallery]</p>${img("a.png")}${img("b.png")}`);
  assert.match(md, /data-title="Live build"/);
});

test("a heading between the caption and the marker wins over that caption", () => {
  // The bold lead belongs to the section above, so it is not this set's title.
  const md = convert(
    `<p><strong>Scope</strong> &mdash; what the build covers.</p>` +
      `<h2>Live build</h2><p>[Gallery]</p>${img("a.png")}${img("b.png")}`,
  );
  assert.match(md, /data-title="Live build"/);
});

test("a marked run ignores whatever follows the images", () => {
  // The case the heading rule cannot take: a section that ends in notes.
  const md = convert(
    `<h3>Content script</h3><p>[Gallery]</p>${img("a.png")}${img("b.png")}` +
      `<ul><li>Video: demo.mkv</li><li>Captions: [TBD]</li></ul>`,
  );
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 1);
  assert.match(md, /Video: demo\.mkv/);
});

test("a marker leading nowhere is still removed", () => {
  const md = convert(`<p>[Gallery]</p>${img("solo.png")}`);
  assert.doesNotMatch(md, /carousel/);
  assert.doesNotMatch(md, /\[Gallery\]/);
  assert.match(md, /!\[\]\(\/img\/confluence\/12345\/solo\.png\)/);
});

test("a marker mid-sentence is prose, and stays", () => {
  const md = convert(
    `<p>The [Gallery] macro was the other option.</p>${img("a.png")}${img("b.png")}`,
  );
  assert.doesNotMatch(md, /carousel/);
  // Turndown escapes a bracket in prose, so it reaches the page as text.
  assert.match(md, /The \\?\[Gallery\\?\] macro was the other option\./);
});

test("a marked run is not wrapped twice by the heading rule", () => {
  const md = convert(`<h3>Stills</h3><p>[Gallery]</p>${img("a.png")}${img("b.png")}`);
  assert.equal((md.match(/<div class="carousel"/g) ?? []).length, 1);
  assert.doesNotMatch(md, /<div class="carousel"[^>]*><div/);
});

test("onCarousel reports each carousel's slides in document order", () => {
  const seen = [];
  storageToMarkdown(
    `<h3>First</h3>${img("a.png")}${img("b.png")}` +
      `<h3>Second</h3>${img("c.png")}${img("d.png")}`,
    { ...options, onCarousel: (sources) => seen.push(sources) },
  );
  assert.deepEqual(seen, [
    ["/img/confluence/12345/a.png", "/img/confluence/12345/b.png"],
    ["/img/confluence/12345/c.png", "/img/confluence/12345/d.png"],
  ]);
});

test("a quote in a heading cannot break out of the title attribute", () => {
  const md = convert(`<h3>The "good" set</h3>${img("a.png")}${img("b.png")}`);
  assert.match(md, /data-title="The &quot;good&quot; set"/);
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
