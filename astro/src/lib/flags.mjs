/**
 * Build-time feature flags. Flip one and redeploy.
 *
 * `gallery` is off because `src/content/gallery/` still holds only placeholder
 * entries pointing at Unsplash. Off means the /gallery routes are never
 * generated and nothing links to them, so there is no half-finished section to
 * stumble into — not merely an unlisted page that still answers.
 *
 * Turning it on restores /gallery and /gallery/<slug> together, via
 * integrations/feature-routes.mjs, and puts the link back in every nav.
 */
export const flags = {
  gallery: false,
};
