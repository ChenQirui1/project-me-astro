import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractMetadata,
  extractSections,
  normalizeMetadata,
} from "./confluence-metadata.mjs";

const read = (storage) => {
  const { fields, storage: body } = extractMetadata(storage);
  return { meta: normalizeMetadata(fields), body };
};

test("reads a two-column metadata table", () => {
  const { meta, body } = read(
    "<table><tbody>" +
      "<tr><td>Slug</td><td>take-a-seat</td></tr>" +
      "<tr><td>Year</td><td>2023</td></tr>" +
      "<tr><td>Project type</td><td>VR artwork</td></tr>" +
      "<tr><td>Featured</td><td>Yes</td></tr>" +
      "</tbody></table><p>Body text.</p>",
  );
  assert.equal(meta.slug, "take-a-seat");
  assert.equal(meta.year, 2023);
  assert.equal(meta.projectType, "VR artwork");
  assert.equal(meta.featured, true);
  // The block is removed so it doesn't render twice.
  assert.doesNotMatch(body, /<table/);
  assert.match(body, /Body text\./);
});

test("reads the bullet-and-break format the existing pages use", () => {
  const { meta, body } = read(
    "<h2>PROJECT METADATA</h2>" +
      "<p>&bull; Year: 2021<br />&bull; Context: Independent<br />" +
      "&bull; Discipline / project type: VR, 3D<br />" +
      "&bull; Publication status: Private draft</p><p>Real body.</p>",
  );
  assert.equal(meta.year, 2021);
  assert.equal(meta.context, "Independent");
  assert.deepEqual(meta.disciplines, ["VR", "3D"]);
  assert.equal(meta.publication, "private draft");
  assert.match(body, /Real body\./);
  assert.doesNotMatch(body, /Year: 2021/);
});

test("[TBD] placeholders are treated as absent", () => {
  const { meta } = read(
    "<p>Year: [TBD]<br />Context: [TBD]<br />Status: completed<br />Role: —</p>",
  );
  assert.equal(meta.year, null);
  assert.equal(meta.context, null);
  assert.equal(meta.role, null);
  assert.equal(meta.status, "completed");
});

test("a non-metadata leading table is left alone", () => {
  const storage =
    "<table><tbody><tr><td>Apples</td><td>3</td></tr>" +
    "<tr><td>Pears</td><td>4</td></tr></tbody></table>";
  const { meta, body } = read(storage);
  assert.equal(meta.year, null);
  assert.equal(body, storage);
});

test("a prose paragraph containing a colon is not mistaken for metadata", () => {
  const storage = "<p>The brief: make something honest. It worked.</p>";
  const { body } = read(storage);
  assert.equal(body, storage);
});

test("disciplines split on commas and slashes", () => {
  const { meta } = read(
    "<p>Slug: x<br />Discipline: moving image / sound, projection</p>",
  );
  assert.deepEqual(meta.disciplines, ["moving image", "sound", "projection"]);
});

test("featured is false unless explicitly affirmative", () => {
  assert.equal(read("<p>Slug: a<br />Featured: no</p>").meta.featured, false);
  assert.equal(read("<p>Slug: a<br />Featured: Yes</p>").meta.featured, true);
  assert.equal(read("<p>Slug: a<br />Year: 2020</p>").meta.featured, false);
});

test("slug is normalized to a URL-safe form", () => {
  const { meta } = read("<p>Slug: Take A Seat!<br />Year: 2023</p>");
  assert.equal(meta.slug, "take-a-seat-");
});

test("entities in values are decoded", () => {
  const { meta } = read(
    "<p>Slug: x<br />Summary: Sound &amp; vision &mdash; a study</p>",
  );
  assert.equal(meta.summary, "Sound & vision — a study");
});

test("reads a bulleted metadata list, one field per item", () => {
  const { meta, body } = read(
    "<h2>PROJECT METADATA</h2>" +
      "<ul>" +
      "<li><p>Year: 2026</p></li>" +
      "<li><p>Duration: Two weeks</p></li>" +
      "<li><p>Context: Client engagement with Agung Keramik</p></li>" +
      "<li><p>Discipline / project type: UX research, website redesign</p></li>" +
      "<li><p>Role: UX audit and information architecture</p></li>" +
      "<li><p>Collaborators: Ng Wei Yan, Ivan Chen</p></li>" +
      "<li><p>Publication status: Public draft</p></li>" +
      "</ul><p>Real body.</p>",
  );
  assert.equal(meta.year, 2026);
  assert.equal(meta.context, "Client engagement with Agung Keramik");
  assert.deepEqual(meta.disciplines, ["UX research", "website redesign"]);
  assert.equal(meta.role, "UX audit and information architecture");
  assert.deepEqual(meta.collaborators, ["Ng Wei Yan", "Ivan Chen"]);
  assert.equal(meta.publication, "public draft");
  // The block is removed so the fields don't render as body text too.
  assert.match(body, /Real body\./);
  assert.doesNotMatch(body, /Year: 2026/);
  assert.doesNotMatch(body, /Collaborators/);
});

test("a prose list whose items contain colons is left alone", () => {
  const storage =
    "<ul>" +
    "<li><p>What worked: triangulating five evidence streams.</p></li>" +
    "<li><p>What did not: the survey only reached existing customers.</p></li>" +
    "<li><p>What changed: the brief narrowed to discovery.</p></li>" +
    "</ul>";
  const { meta, body } = read(storage);
  assert.equal(meta.year, null);
  assert.equal(body, storage);
});

test("an all-placeholder bulleted block is still stripped", () => {
  const { meta, body } = read(
    "<ul><li><p>Year: [TBD]</p></li><li><p>Role: [TBD]</p></li>" +
      "<li><p>Context: TBD</p></li></ul><p>Body.</p>",
  );
  assert.equal(meta.year, null);
  assert.equal(meta.role, null);
  assert.doesNotMatch(body, /TBD/);
});

test("separators inside brackets do not split a list entry", () => {
  const { meta } = read(
    "<ul><li><p>Year: 2026</p></li>" +
      "<li><p>Discipline: UX research, website redesign (information " +
      "architecture, UI mockups), SEO</p></li></ul>",
  );
  assert.deepEqual(meta.disciplines, [
    "UX research",
    "website redesign (information architecture, UI mockups)",
    "SEO",
  ]);
});

test("accented entities decode in metadata values", () => {
  const { meta } = read(
    "<ul><li><p>Year: 2026</p></li>" +
      "<li><p>Context: caf&eacute;s in Z&uuml;rich, run by &Eacute;lodie</p></li></ul>",
  );
  assert.equal(meta.context, "cafés in Zürich, run by Élodie");
});

test("editor-facing template sections are dropped with their headings", () => {
  const { storage } = extractSections(
    "<h2>CURRENT DOCUMENTATION CONDITION</h2><p>Confirm status first.</p>" +
      "<h2>JIRA STORY</h2><p>[TBD &mdash; add story key/link]</p>" +
      "<h2>PROJECT METADATA</h2>" +
      "<h2>PROBLEM OR BRIEF</h2><p>Real body.</p>",
  );
  assert.doesNotMatch(storage, /DOCUMENTATION|Confirm status|JIRA|TBD|METADATA/);
  assert.match(storage, /<h2>PROBLEM OR BRIEF<\/h2><p>Real body\.<\/p>/);
});

test("the one-sentence summary section becomes the summary field", () => {
  const { fields, storage } = extractSections(
    "<h2>ONE-SENTENCE SUMMARY</h2><p>A two-week <strong>diagnostic</strong>.</p>" +
      "<h2>BRIEF</h2><p>Body.</p>",
  );
  assert.equal(fields.get("summary"), "A two-week diagnostic.");
  assert.doesNotMatch(storage, /SUMMARY|diagnostic/);
  assert.match(storage, /Body\./);
});

test("a section keeps its lower-level subheadings and stops at a peer", () => {
  const { storage } = extractSections(
    "<h2>JIRA STORY</h2><p>x</p><h3>Sub</h3><p>y</p>" +
      "<h2>Kept</h2><h3>Kept sub</h3><p>z</p>",
  );
  assert.equal(storage, "<h2>Kept</h2><h3>Kept sub</h3><p>z</p>");
});

test("a placeholder summary section yields no field", () => {
  const { fields } = extractSections("<h2>Summary</h2><p>[TBD]</p>");
  assert.equal(fields.has("summary"), false);
});
