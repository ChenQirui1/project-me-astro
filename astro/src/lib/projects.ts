/**
 * The catalogue's running order, shared by /projects and the index column in
 * ui/Nav.astro so the two read the same way. It lives here because the two
 * have to agree — a second copy is how they drift.
 *
 * Featured projects lead; then anything carrying an explicit `order`, which
 * always precedes a project without one; then most-recent-first, which is
 * what the synced pages fall back on since they set neither.
 */

import type { CollectionEntry } from "astro:content";

type Project = CollectionEntry<"projects">;

export function byCatalogueOrder(a: Project, b: Project): number {
  if (a.data.featured !== b.data.featured) return a.data.featured ? -1 : 1;

  // Compared before it is subtracted: `2 - Infinity` and `Infinity - Infinity`
  // are both unusable as a difference, so subtracting first let a project with
  // no order tie with one that had asked for a position.
  const aOrder = a.data.order ?? Infinity;
  const bOrder = b.data.order ?? Infinity;
  if (aOrder !== bOrder) return aOrder - bOrder;

  return b.data.year - a.data.year;
}
