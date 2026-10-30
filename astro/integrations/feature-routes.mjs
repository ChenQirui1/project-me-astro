import { flags } from "../src/lib/flags.mjs";

/**
 * Routes that exist only while their flag is on.
 *
 * The gallery's pages live in `src/features/gallery/` rather than
 * `src/pages/`, so Astro's file router never picks them up by itself. This
 * injects them when `flags.gallery` is set, which means a disabled feature
 * emits no HTML at all rather than shipping pages that merely aren't linked.
 */
export default function featureRoutes() {
  return {
    name: "feature-routes",
    hooks: {
      "astro:config:setup": ({ injectRoute }) => {
        if (!flags.gallery) return;

        injectRoute({
          pattern: "/gallery",
          entrypoint: "./src/features/gallery/index.astro",
        });
        injectRoute({
          pattern: "/gallery/[slug]",
          entrypoint: "./src/features/gallery/[slug].astro",
        });
      },
    },
  };
}
