import { defineCollection, z } from 'astro:content';

const projectsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    medium: z.string(),
    year: z.number(),
    thumbnail: z.string(),
    order: z.number(),
  }),
});

const galleryCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    caption: z.string(),
    description: z.string(),
    medium: z.string(),
    year: z.number(),
    image: z.string(),
    aspectRatio: z.enum(['3x4', '4x3', '1x1', '16x9']).default('4x3'),
    order: z.number().optional(),
  }),
});

export const collections = {
  projects: projectsCollection,
  gallery: galleryCollection,
};
