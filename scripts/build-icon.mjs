#!/usr/bin/env node
/**
 * アプリアイコンを作る: assets/icon.svg → assets/icon.icns（macOS の .app 用）と assets/icon.png（1024 四方）。
 *
 * macOS の iconutil は Linux に無いので、.icns は自前で組む（大きさごとの PNG を並べただけの形式）。
 * SVG を PNG にするのに Chromium（Playwright）を使う。アイコンを描き直したときだけ手で動かす（CI では動かさない）:
 *
 *   npm run icon
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

/** .icns の種類と、その PNG の大きさ（@2x も別の種類として入れる）。 */
const ENTRIES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];

const svg = await readFile(join(root, 'assets', 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const pngs = new Map();
try {
  for (const size of new Set(ENTRIES.map(([, size]) => size))) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const sized = svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    pngs.set(size, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    await page.close();
  }
} finally {
  await browser.close();
}

const chunks = ENTRIES.map(([type, size]) => {
  const data = pngs.get(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
});
const body = Buffer.concat(chunks);
const head = Buffer.alloc(8);
head.write('icns', 0, 'ascii');
head.writeUInt32BE(body.length + 8, 4);

await writeFile(join(root, 'assets', 'icon.icns'), Buffer.concat([head, body]));
await writeFile(join(root, 'assets', 'icon.png'), pngs.get(1024));
console.log('assets/icon.icns と assets/icon.png を作りました。');
