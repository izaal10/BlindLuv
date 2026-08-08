/**
 * Turns the watercolour source artwork into the asset set the app needs.
 *
 *   node scripts/build-logo.mjs
 *
 * The source is red ink on an opaque white background with a lot of padding.
 * Dropped straight into the header it would render as a white square on the
 * blush page background, so this script:
 *
 *   1. derives an alpha channel from ink density, keeping the watercolour's
 *      soft edges instead of hard-thresholding them into a sticker,
 *   2. trims the transparent margin so the mark optically fills its box,
 *   3. emits header / apple-icon / OG variants.
 *
 * The browser-tab favicon is deliberately NOT generated here. At 16px the
 * watercolour collapses into a pink smudge — the strokes are too fine and the
 * washes too light to survive. `src/app/icon.svg` holds a flat reduction of
 * the same mark for that one size; everything above ~28px uses the real
 * artwork.
 *
 * Apple icons get flattened onto the brand background because iOS composites
 * transparent icons onto black, which would turn the mark into a bruise.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const SRC = new URL("../../assets/logo-source.png", import.meta.url).pathname;
const BRAND_BG = "#FFF6F3";

/**
 * Alpha from ink density: a white pixel has min(r,g,b) = 255 and becomes fully
 * transparent; saturated red ink has a low minimum and stays opaque. Using the
 * channel minimum rather than luminance keeps the reds strong — luminance
 * would treat bright red as "light" and fade it out.
 */
async function knockOutWhite(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  for (let i = 0; i < data.length; i += channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const ink = 255 - Math.min(r, g, b);
    // Slight lift so the faint paper texture around the strokes disappears
    // instead of leaving a grey wash.
    data[i + 3] = ink < 10 ? 0 : Math.min(255, Math.round(ink * 1.15));
  }

  return sharp(data, { raw: { width, height, channels } }).png();
}

async function main() {
  await mkdir(new URL("../public", import.meta.url).pathname, { recursive: true });

  const transparent = await (await knockOutWhite(SRC)).toBuffer();
  const trimmed = await sharp(transparent).trim({ threshold: 1 }).toBuffer();

  const meta = await sharp(trimmed).metadata();
  console.log(`trimmed to ${meta.width}x${meta.height}`);

  // Square it so every downstream resize keeps the mark centred.
  const size = Math.max(meta.width, meta.height);
  const square = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: trimmed, gravity: "center" }])
    .png()
    .toBuffer();

  const out = [
    // Palette-quantised: this is a 34px header mark and an OG input, not a
    // print asset. Full-depth RGBA was ~300KB for no visible gain.
    ["public/logo.png", sharp(square).resize(512, 512).png({ palette: true, quality: 90, effort: 10 })],
    [
      "src/app/apple-icon.png",
      sharp(square)
        .resize(160, 160)
        .extend({ top: 10, bottom: 10, left: 10, right: 10, background: BRAND_BG })
        .flatten({ background: BRAND_BG })
        .png(),
    ],
  ];

  for (const [path, pipeline] of out) {
    const info = await pipeline.toFile(new URL(`../${path}`, import.meta.url).pathname);
    console.log(`${path} → ${info.width}x${info.height} (${(info.size / 1024).toFixed(0)}KB)`);
  }

  // ---- OG card: real artwork on the brand background -------------------
  const logoForOg = await sharp(square).resize(340, 340).toBuffer();

  const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <radialGradient id="g1" cx="10%" cy="0%" r="60%">
        <stop offset="0%" stop-color="#E8232F" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#E8232F" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="g2" cx="95%" cy="15%" r="50%">
        <stop offset="0%" stop-color="#D98F1F" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="#D98F1F" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="${BRAND_BG}"/>
    <rect width="1200" height="630" fill="url(#g1)"/>
    <rect width="1200" height="630" fill="url(#g2)"/>
    <text x="462" y="252" font-family="Georgia, serif" font-size="78" font-weight="600" fill="#3A0A10">Blind<tspan fill="#E8232F">Luv</tspan></text>
    <text x="462" y="316" font-family="Georgia, serif" font-size="34" font-style="italic" fill="#8A4650">Anonymous until both of you commit.</text>
    <text x="464" y="388" font-family="monospace" font-size="21" fill="#B98890">AI matchmaking · x402 payments · Monad settlement</text>
    <rect x="462" y="424" width="222" height="46" rx="23" fill="none" stroke="rgba(122,18,32,0.30)"/>
    <text x="487" y="454" font-family="monospace" font-size="18" fill="#8A4650">Claude via 9Router</text>
    <rect x="700" y="424" width="192" height="46" rx="23" fill="none" stroke="rgba(122,18,32,0.30)"/>
    <text x="725" y="454" font-family="monospace" font-size="18" fill="#8A4650">Monad Testnet</text>
  </svg>`);

  const og = await sharp(text)
    .composite([{ input: logoForOg, top: 145, left: 78 }])
    .png()
    .toFile(new URL("../src/app/opengraph-image.png", import.meta.url).pathname);
  console.log(`src/app/opengraph-image.png → ${og.width}x${og.height} (${(og.size / 1024).toFixed(0)}KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
