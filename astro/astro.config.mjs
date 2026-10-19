// @ts-check
import { defineConfig } from "astro/config";

import mdx from "@astrojs/mdx";

import tailwindcss from "@tailwindcss/vite";

import react from "@astrojs/react";

import devAssets from "./integrations/dev-assets.mjs";
import rehypeSections from "./src/lib/rehype-sections.mjs";

// https://astro.build/config
export default defineConfig({
  integrations: [mdx(), devAssets()],

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
