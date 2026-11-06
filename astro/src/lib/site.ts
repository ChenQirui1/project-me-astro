/**
 * The things every page's <head> needs and no page should restate.
 *
 * These are the defaults a link preview falls back to. A page that can say
 * something better — a project knows its own description — passes its own.
 */

export const SITE_NAME = "IVAN.C";

/**
 * The homepage's title — the clickable line in a search result, and the
 * headline on a pasted link. Interior pages build their own from the page
 * name and SITE_NAME (see Layout.astro); the landing page has no page name
 * to build from, so it says this.
 *
 * It lives here rather than in LandingLayout.astro because it is read twice
 * — once for <title>, once for og:title — and the two had drifted apart.
 * Keep it under ~60 characters or Google truncates it.
 */
export const HOME_TITLE = "Hi, I'm Ivan — Product Engineer";

/** Shown under the title in a link preview, and to search engines. */
export const SITE_DESCRIPTION =
  "Ivan Chen — product engineer. Selected work in applied AI, retrieval systems and digital products.";

/** 1200x630, drawn by scripts/og-card.mjs. Site-relative; Meta.astro makes it absolute. */
export const OG_IMAGE = "/og.png";
export const OG_IMAGE_ALT = "IVAN — Product Engineer, ivanchen.xyz";
