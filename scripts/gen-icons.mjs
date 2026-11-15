// Renders the app icons with the pre-installed Chromium (npm run icons).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// resolved via require so a globally installed Playwright (NODE_PATH) works too
const { chromium } = createRequire(import.meta.url)('playwright');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const html = (size, pad) => `<html><body style="margin:0;background:#000">
<div style="width:${size}px;height:${size}px;position:relative;overflow:hidden;background:
 radial-gradient(60% 60% at 70% 25%, #ff2bd6 0%, transparent 70%),
 radial-gradient(60% 60% at 25% 80%, #00c8ff 0%, transparent 70%),
 radial-gradient(40% 40% at 60% 70%, #ffe14a55 0%, transparent 70%), #07030c;">
 <div style="position:absolute;inset:${pad}%;display:flex;flex-direction:column;align-items:center;justify-content:center;
   font-family:'Arial Narrow',Arial,sans-serif;font-weight:900;color:#f2efe9;line-height:.86;letter-spacing:.02em;
   font-size:${size * (0.3 - pad / 250)}px;text-shadow:${size * 0.012}px 0 #ff2bd6, -${size * 0.012}px 0 #00f0ff;">
   <span>BAD</span><span>TRIP</span></div></div></body></html>`;

const browser = await chromium.launch();
for (const [name, size, pad] of [['icon-192', 192, 8], ['icon-512', 512, 8], ['icon-maskable-512', 512, 18], ['apple-touch-icon', 180, 8]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html(size, pad));
  await page.screenshot({ path: path.join(out, name + '.png') });
  await page.close();
}
await browser.close();
console.log('icons written to', out);
