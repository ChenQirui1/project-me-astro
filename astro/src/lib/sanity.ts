import { createClient } from "@sanity/client";
import { createImageUrlBuilder } from "@sanity/image-url";

export const sanityClient = createClient({
  projectId: "y6vzgt51",
  dataset: "production",
  useCdn: false,
  apiVersion: "2024-01-01",
});

export interface SanityProject {
  _id: string;
  projectId: string;
  title: string;
  description: string;
  medium?: string;
  year: number;
  thumbnail?: {
    asset: {
      _ref: string;
      _type: string;
    };
  };
  body?: string;
}

export async function getProjects(): Promise<SanityProject[]> {
  const query = `*[_type == "project"] | order(year desc) {
    _id,
    projectId,
    title,
    description,
    medium,
    year,
    thumbnail,
    body
  }`;

  return await sanityClient.fetch(query);
}

const builder = createImageUrlBuilder(sanityClient);

export function urlFor(source: any) {
  return builder.image(source);
}

export async function getProjectByProjectId(
  projectId: string,
): Promise<SanityProject | null> {
  const query = `*[_type == "project" && projectId == $projectId][0] {
    _id,
    projectId,
    title,
    description,
    medium,
    year,
    thumbnail,
    body
  }`;

  return await sanityClient.fetch(query, { projectId });
}

export async function getProjectIds(): Promise<string[]> {
  const query = `*[_type == "project"] {
    projectId
  }`;

  const projects = await sanityClient.fetch(query);
  return projects.map((p: { projectId: string }) => p.projectId);
}
