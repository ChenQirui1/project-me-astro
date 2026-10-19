// 1. Import utilities from `astro:content`
import { defineCollection, z } from "astro:content";

// 2. Import loader(s)
import { glob, file } from "astro/loaders";

// Files carrying `confluenceId` are written by scripts/sync-confluence.mjs and
// will be overwritten on the next run; files without it are hand-authored and
// the sync leaves them alone.
const projectCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    year: z.number(),
    // Optional because a Confluence page may not have filled these in yet.
    medium: z.string().optional(),
    thumbnail: z.string().optional(),
    order: z.number().optional(),

    // Catalogue metadata, read from the block at the top of the Confluence page.
    projectType: z.string().optional(),
    disciplines: z.array(z.string()).default([]),
    context: z.string().optional(),
    // Free-form rather than an enum: the archive uses ongoing/completed/
    // archived/abandoned and shouldn't fail a build over a new value.
    status: z.string().optional(),
    documentation: z.string().optional(),
    publication: z.string().optional(),
    featured: z.boolean().default(false),
    role: z.string().optional(),
    collaborators: z.array(z.string()).default([]),

    // Position in the Confluence tree, e.g. "Digital Products" / "Tools".
    category: z.string().optional(),
    subcategory: z.string().optional(),

    gallery: z.array(z.string()).default([]),
    topics: z.array(z.string()).default([]),

    confluenceId: z.string().optional(),
    confluenceUrl: z.string().url().optional(),
    sourceUpdatedAt: z.coerce.date().optional(),
  }),
});

const galleryCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/gallery" }),
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
      socials: z.object({
        linkedin: z.string().optional(),
        instagram: z.string().optional(),
        github: z.string().optional(),
      }).optional(),
    }),
    about: z.object({
      headline: z.string(),
      bio: z.string(),
      philosophy: z.string().optional(),
      availability: z.string().optional(),
    }).optional(),
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
