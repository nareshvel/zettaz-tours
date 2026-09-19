import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const assets = path.join(root, "apps/mobile/assets");
const store = path.join(root, "apps/mobile/store");
const svgPath = path.join(root, "apps/web/public/brand/app-icon.svg");

await mkdir(assets, { recursive: true });
await mkdir(store, { recursive: true });

const svg = await readFile(svgPath);
const navy = { r: 17, g: 52, b: 59 };
const icon = await sharp(svg)
  .resize(1024, 1024)
  .flatten({ background: navy })
  .removeAlpha()
  .png()
  .toBuffer();
await writeFile(path.join(assets, "icon.png"), icon);

const adaptive = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: navy },
})
  .composite([
    {
      input: await sharp(svg)
        .resize(640, 640)
        .flatten({ background: navy })
        .png()
        .toBuffer(),
      gravity: "center",
    },
  ])
  .png()
  .toBuffer();
await writeFile(path.join(assets, "adaptive-icon.png"), adaptive);

const splashMark = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: navy },
})
  .composite([
    {
      input: await sharp(svg)
        .resize(360, 360)
        .flatten({ background: navy })
        .png()
        .toBuffer(),
      top: 250,
      left: 332,
    },
    {
      input: Buffer.from(`<svg width="1024" height="140" xmlns="http://www.w3.org/2000/svg">
  <text x="512" y="90" text-anchor="middle" font-family="Helvetica" font-size="52" font-weight="700" fill="#71E2C7">ZETTAZ CREW</text>
</svg>`),
      top: 760,
      left: 0,
    },
  ])
  .png()
  .toBuffer();
await writeFile(path.join(assets, "splash-icon.png"), splashMark);
await writeFile(
  path.join(assets, "favicon.png"),
  await sharp(svg).resize(48, 48).flatten({ background: navy }).png().toBuffer(),
);

const feature = await sharp({
  create: { width: 1024, height: 500, channels: 3, background: navy },
})
  .composite([
    {
      input: await sharp(svg)
        .resize(280, 280)
        .flatten({ background: navy })
        .png()
        .toBuffer(),
      top: 110,
      left: 372,
    },
  ])
  .png()
  .toBuffer();
await writeFile(path.join(store, "feature-graphic.png"), feature);

console.log("Wrote crew app icons to apps/mobile/assets and store/feature-graphic.png");
