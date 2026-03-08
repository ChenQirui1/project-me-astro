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

const galleryCollection = defineCollection({
  type: "content",
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

const cvCollection = defineCollection({
  type: "data",
  schema: z.object({
    personalInfo: z.object({
      name: z.string(),
      email: z.string().email(),
      phone: z.string(),
    }),
    education: z.array(z.object({
      institution: z.string(),
      degree: z.string(),
      period: z.string(),
      highlights: z.array(z.string()).optional(),
    })),
    experience: z.array(z.object({
      company: z.string(),
      position: z.string(),
      period: z.string(),
      responsibilities: z.array(z.object({
        title: z.string().optional(),
        details: z.array(z.string()),
      })),
    })),
    competitions: z.array(z.object({
      name: z.string(),
      achievement: z.string(),
      details: z.array(z.string()).optional(),
    })).optional(),
    activities: z.array(z.object({
      organization: z.string(),
      details: z.array(z.string()),
    })).optional(),
    skills: z.object({
      technical: z.array(z.object({
        category: z.string(),
        items: z.array(z.string()),
      })),
      aesthetic: z.array(z.string()).optional(),
      soft: z.array(z.string()).optional(),
    }),
    interests: z.array(z.string()).optional(),
  }),
});

export const collections = {
  projects: projectCollection,
  gallery: galleryCollection,
  cv: cvCollection,
};
