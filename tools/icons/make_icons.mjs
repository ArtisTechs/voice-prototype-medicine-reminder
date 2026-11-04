// Builds every app icon from tools/icons/logo-source.png (the VOICE logo).
//   node tools/icons/make_icons.mjs        (needs `sharp`; it is installed in services/api)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const sharp = createRequire(path.join(root, 'services/api/package.json'))('sharp');
const out = path.join(root, 'apps/mobile/assets');

const BG = { r: 0x02, g: 0x54, b: 0x7a }; // the logo's blue (#02547A)
// The glyph (capsule + speech bubble + sound waves + plus) inside the source art, on a flat blue field.
const CROP = { left: 190, top: 275, width: 885, height: 710 };

/** The crop on a perfectly flat blue: the source art has a faint shading gradient that would show as a box. */
async function flatten(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - BG.r, data[i + 1] - BG.g, data[i + 2] - BG.b);
    const a = Math.max(0, Math.min(1, (d - 12) / 28));
    data[i] = Math.round(data[i] * a + BG.r * (1 - a));
    data[i + 1] = Math.round(data[i + 1] * a + BG.g * (1 - a));
    data[i + 2] = Math.round(data[i + 2] * a + BG.b * (1 - a));
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

const glyph = await flatten(await sharp(path.join(here, 'logo-source.png')).extract(CROP).png().toBuffer());

/** Square canvas of `size`, filled with blue (or transparent), glyph scaled to `ratio` of the canvas width. */
async function canvas(size, ratio, { transparent = false, input = glyph } = {}) {
  const w = Math.round(size * ratio);
  const g = await sharp(input).resize({ width: w }).png().toBuffer();
  const meta = await sharp(g).metadata();
  return sharp({
    create: { width: size, height: size, channels: 4, background: transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : { ...BG, alpha: 1 } },
  }).composite([{ input: g, left: Math.round((size - w) / 2), top: Math.round((size - meta.height) / 2) }]);
}

/** Glyph as a one-colour shape: alpha = how far each pixel is from the blue field. */
async function silhouette() {
  const { data, info } = await sharp(glyph).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - BG.r, data[i + 1] - BG.g, data[i + 2] - BG.b);
    const a = Math.max(0, Math.min(1, (d - 25) / 110));
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(a * 255);
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

const mono = await silhouette();

const jobs = {
  'icon.png': (await canvas(1024, 0.68)).flatten({ background: BG }),                // iOS / store: opaque, full bleed
  'android-icon-foreground.png': await canvas(1024, 0.5),                              // inside the adaptive-icon safe zone, blue like the background colour
  'android-icon-monochrome.png': await canvas(1024, 0.5, { transparent: true, input: mono }),
  'splash-icon.png': await canvas(1024, 0.78),
  'favicon.png': sharp(await (await canvas(1024, 0.68)).flatten({ background: BG }).png().toBuffer()).resize(196, 196),
  'notification-icon.png': sharp(await (await canvas(256, 0.82, { transparent: true, input: mono })).png().toBuffer()).resize(96, 96),
};
for (const [name, img] of Object.entries(jobs)) {
  await img.png().toFile(path.join(out, name));
  console.log('wrote', name);
}
