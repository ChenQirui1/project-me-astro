// @ts-check
import { defineConfig } from "astro/config";

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

import tailwindcss from "@tailwindcss/vite";

import react from "@astrojs/react";

import devAssets from "./integrations/dev-assets.mjs";
import featureRoutes from "./integrations/feature-routes.mjs";
import rehypeSections from "./src/lib/rehype-sections.mjs";

// https://astro.build/config
export default defineConfig({
  // Canonical origin. Astro needs it to build absolute URLs (canonical links,
  // sitemap, feeds) rather than site-relative ones.
  site: "https://ivanchen.xyz",

  // `sitemap` writes /sitemap-index.xml and /sitemap-0.xml at build time,
  // listing every static route off `site` above. public/robots.txt points at
  // it, which is the only way a crawler finds pages that nothing links to.
  // 404 is excluded: it is a real file in the output but not a page anyone
  // should be sent to from a search result.
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.endsWith("/404/") && !page.endsWith("/404"),
    }),
    devAssets(),
    featureRoutes(),
  ],

  markdown: {
    rehypePlugins: [rehypeSections],
  },

  vite: {
    plugins: [tailwindcss()],
    // Pre-bundle masonry at startup. Left to on-demand discovery, Vite
    // re-optimizes mid-session and the gallery's import 504s as an outdated
    // dep, so the layout never runs.
    optimizeDeps: {
      include: ["masonry-layout"],
    },
  },
});
