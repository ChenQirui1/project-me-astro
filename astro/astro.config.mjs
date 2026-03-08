// @ts-check
import { defineConfig } from "astro/config";

import mdx from "@astrojs/mdx";

import tailwindcss from "@tailwindcss/vite";

import sanity from "@sanity/astro";
import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  integrations: [
    mdx(),
    sanity({
      projectId: "y6vzgt51",
      dataset: "production",
      // Set useCdn to false if you're building statically.
      useCdn: false,
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
