/**
 * Shrinks an image before it goes to R2.
 *
 * The local file is never touched — originals stay full size in assets/ (and
 * in Confluence). Only the bytes uploaded are optimized.
 *
 * The key and format are preserved on purpose: every reference in frontmatter
 * and synced Markdown points at `/img/<key>`, so a .png must stay a .png.
 */

import sharp from "sharp";

/** Wider than any layout on the site renders an image, with room for 2x screens. */
export const MAX_WIDTH = 2000;

const ENCODERS = {
  jpeg: (image) => image.jpeg({ quality: 82, mozjpeg: true }),
  png: (image) => image.png({ compressionLevel: 9, effort: 10 }),
  webp: (image) => image.webp({ quality: 82, effort: 6 }),
  avif: (image) => image.avif({ quality: 60, effort: 6 }),
};

/**
 * Returns `{ buffer, optimized }`. `optimized` is false when the input is
 * passed through unchanged — not a raster format we re-encode, animated, or
 * already smaller than anything we'd produce.
 */
export async function optimize(input) {
  let metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    return { buffer: input, optimized: false };
  }

  const encode = ENCODERS[metadata.format];
  // Re-encoding an animation through sharp keeps only the first frame.
  if (!encode || (metadata.pages ?? 1) > 1) {
    return { buffer: input, optimized: false };
  }

  const output = await encode(
    sharp(input)
      // Bake in EXIF orientation, since the metadata carrying it is stripped.
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true }),
  ).toBuffer();

  return output.length < input.length
    ? { buffer: output, optimized: true }
    : { buffer: input, optimized: false };
}
