// Makes an Acharya portrait: centre square crop, 512×512, WebP, written to image/profile/acharya/<contributor_id>-<n>.webp.
// Encodes in headless Chrome (Playwright from ../mygita-app), since macOS sips and the local ffmpeg cannot write WebP.
// Usage: node scripts/make-portrait.cjs <photo> <contributor_id> [n=1] [quality=0.8]
// Then set the contributor's portrait_url in registry/contributors.csv and run, in this order:
//   node scripts/build-content-kit4.mjs   (inventory first: the kit refuses to open media with an uninventoried portrait)
//   node scripts/publish-media.mjs
//   pnpm validate && pnpm test
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { chromium } = require(path.resolve(root, '../mygita-app/node_modules/playwright'));
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIDE = 512;
const MAX_BYTES = 150 * 1024;

(async () => {
  const [photo, contributorId, order = '1', quality = '0.8'] = process.argv.slice(2);
  if (!photo || !contributorId) throw new Error('Usage: node scripts/make-portrait.cjs <photo> <contributor_id> [n=1] [quality=0.8]');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(contributorId)) throw new Error(`Unexpected contributor id: ${contributorId}`);
  if (!/^[1-9][0-9]*$/.test(order)) throw new Error(`n must be a positive number: ${order}`);
  const logical = `image/profile/acharya/${contributorId}-${order}.webp`;
  const output = path.join(root, logical);
  if (fs.existsSync(output)) throw new Error(`${logical} exists; choose the next n for a new version.`);

  const types = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
  const type = types[path.extname(photo).toLowerCase()];
  if (!type) throw new Error(`Unsupported photo type: ${photo}`);
  const dataUrl = `data:${type};base64,${fs.readFileSync(photo).toString('base64')}`;

  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const encoded = await page.evaluate(async ({ dataUrl, side, quality }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const crop = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2, crop, crop, 0, 0, side, side);
      return canvas.toDataURL('image/webp', Number(quality));
    }, { dataUrl, side: SIDE, quality });
    if (!encoded.startsWith('data:image/webp')) throw new Error('Chrome did not encode WebP.');
    const bytes = Buffer.from(encoded.split(',')[1], 'base64');
    if (bytes.length > MAX_BYTES) throw new Error(`Portrait is ${bytes.length} bytes, over ${MAX_BYTES}; try a lower quality.`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
    console.log(`Wrote ${logical} (${SIDE}×${SIDE}, ${bytes.length} bytes).`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error.message || error); process.exit(1); });
