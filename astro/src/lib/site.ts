/**
 * The things every page's <head> needs and no page should restate.
 *
 * These are the defaults a link preview falls back to. A page that can say
 * something better — a project knows its own description — passes its own.
 */

export const SITE_NAME = "IVAN.C";

/** Shown under the title in a link preview, and to search engines. */
export const SITE_DESCRIPTION =
  "Ivan Chen — product engineer. Selected work in applied AI, retrieval systems and digital products.";

/** 1200x630, drawn by scripts/og-card.mjs. Site-relative; Meta.astro makes it absolute. */
export const OG_IMAGE = "/og.png";
export const OG_IMAGE_ALT = "IVAN — Product Engineer, ivanchen.xyz";
