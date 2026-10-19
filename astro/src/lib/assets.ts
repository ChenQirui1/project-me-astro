/**
 * Resolves an image reference to the URL the browser should request.
 *
 * Everything stored in R2 is served from the same origin under /img/, so a
 * content key like `projects/clearweb.png` (or `/projects/clearweb.png`, which
 * is how the existing frontmatter writes it) becomes `/img/projects/clearweb.png`.
 *
 * References that already point somewhere absolute — the gallery's Unsplash
 * URLs, data URIs — are passed through untouched.
 */

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

export function asset(reference: string): string;
export function asset(reference: undefined): undefined;
export function asset(reference: string | undefined): string | undefined;
export function asset(reference: string | undefined): string | undefined {
  if (!reference) return reference;
  if (ABSOLUTE.test(reference) || reference.startsWith("data:")) {
    return reference;
  }

  const key = reference.replace(/^\/+/, "").replace(/^img\//, "");
  return `/img/${key}`;
}

/** The R2 key behind a reference, for tooling that needs the key not the URL. */
export function assetKey(reference: string): string {
  return reference.replace(/^\/+/, "").replace(/^img\//, "");
}
