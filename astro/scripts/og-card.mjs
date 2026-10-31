#!/usr/bin/env node
/**
 * Draws public/og.png, the 1200x630 card that link previews show.
 *
 * The card is the landing page's name plate, redrawn at the size the social
 * platforms crop to: ink sheet, hairline panel, the wordmark over a rule, the
 * role under it, and the origin on a hazard plate. Nothing here is fetched at
 * build time — the card is committed, because a crawler that cannot reach an
 * image falls back to no preview at all.
 *
 *   node scripts/og-card.mjs [path-to-Archivo.ttf]
 *
 * Archivo is loaded from Google Fonts in the browser, so there is no copy in
 * the repo. Pass one to draw with the real face; without it the renderer
 * falls back to whatever sans fontconfig offers, which is why the output is
 * committed rather than regenerated on every build.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "og.png");

// The tokens from src/styles/style.css, so the card cannot drift from the site.
const INK = "#000000";
const PAPER = "#ffffff";
const RULE = "#3d3d3d";
const YELLOW = "#f3d200";

const W = 1200;
const H = 630;
const PAD = 48;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${INK}"/>
  <rect x="${PAD}.5" y="${PAD}.5" width="${W - 2 * PAD - 1}" height="${H - 2 * PAD - 1}"
        fill="none" stroke="${RULE}" stroke-width="1"/>

  <text x="96" y="320" fill="${PAPER}"
        font-family="Archivo" font-weight="900" font-size="208">IVAN</text>

  <line x1="${PAD}" y1="384" x2="${W - PAD}" y2="384" stroke="${RULE}" stroke-width="1"/>

  <text x="96" y="470" fill="${PAPER}"
        font-family="Archivo" font-weight="700" font-size="46"
        letter-spacing="3">PRODUCT ENGINEER</text>

  <rect x="96" y="508" width="268" height="54" fill="${YELLOW}"/>
  <text x="116" y="545" fill="${INK}"
        font-family="Archivo" font-weight="700" font-size="28"
        letter-spacing="1">ivanchen.xyz</text>
</svg>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT);

const { width, height, size } = await sharp(OUT).metadata();
console.log(`wrote ${path.relative(ROOT, OUT)} — ${width}x${height}, ${(size / 1024).toFixed(1)} KB`);
