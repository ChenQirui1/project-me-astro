// 1. Import utilities from `astro:content`
import { defineCollection, z } from "astro:content";

// 2. Import loader(s)
import { glob, file } from "astro/loaders";

const projectCollection = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    medium: z.string(),
    year: z.number(),
    status: z.enum(["completed", "ongoing", "paused"]).optional(),
    thumbnail: z.string(),
    order: z.number().optional(),
  }),
});

export const collections = {
  projects: projectCollection,
};
