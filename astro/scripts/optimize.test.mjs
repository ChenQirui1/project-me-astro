import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { MAX_WIDTH, optimize } from "./optimize.mjs";

// Noise doesn't compress, so it stands in for a real photo's file size.
const noise = (width, height) =>
  sharp(Buffer.from(Array.from({ length: width * height * 3 }, () => Math.random() * 256)), {
    raw: { width, height, channels: 3 },
  });

test("downsizes a wide jpeg and keeps it a jpeg", async () => {
  const input = await noise(3000, 1500).jpeg({ quality: 100 }).toBuffer();
  const { buffer, optimized } = await optimize(input);
  const meta = await sharp(buffer).metadata();

  assert.equal(optimized, true);
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, MAX_WIDTH);
  assert.equal(meta.height, 1000);
  assert.ok(buffer.length < input.length);
});

test("never enlarges a small image", async () => {
  const input = await noise(400, 300).png().toBuffer();
  const { buffer } = await optimize(input);
  const meta = await sharp(buffer).metadata();

  assert.equal(meta.format, "png");
  assert.equal(meta.width, 400);
});

test("passes through anything that isn't a re-encodable image", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  assert.deepEqual(await optimize(svg), { buffer: svg, optimized: false });

  const pdf = Buffer.from("%PDF-1.4 not an image");
  assert.deepEqual(await optimize(pdf), { buffer: pdf, optimized: false });
});

test("leaves animated images alone rather than flattening them", async () => {
  const frame = () => noise(20, 20).png().toBuffer();
  const input = await sharp([await frame(), await frame()], { join: { animated: true } })
    .webp()
    .toBuffer();

  assert.equal((await sharp(input).metadata()).pages, 2);
  assert.deepEqual(await optimize(input), { buffer: input, optimized: false });
});
