/* ============================================================
   生成应用图标：用 Electron 把 SVG 渲染成多尺寸 PNG，再手工封装成 ICO。
   —— 不依赖任何第三方二进制（没有 ImageMagick 也能出图标）

   用法：npm run icon      （或 electron dev/build-icon.js）

   设计：暖纸底 + 陶土橘红印章 + 白色宋体「此」。
   小尺寸（16/24/32）没有空间承载笔画，自动切换成「双层方印」简形。
   ============================================================ */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'build');
const SIZES = [256, 128, 64, 48, 32, 24, 16];

/* ---------------- SVG 设计 ---------------- */
/** 大尺寸：圆角方印 + 白色宋体「此」 */
function markSVG(size) {
  const r = size * 0.2237; // 接近 squircle 的圆角比例
  const cx = size / 2;
  const cy = size / 2;
  const inset = size * 0.052;
  const ir = r * 0.62;
  const fontSize = size * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="seal" x1="0.12" y1="0" x2="0.88" y2="1">
      <stop offset="0" stop-color="#e57a55"/>
      <stop offset="0.52" stop-color="#cf6438"/>
      <stop offset="1" stop-color="#a94a24"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="0.46" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="${(size * 0.018).toFixed(2)}" stdDeviation="${(size * 0.022).toFixed(2)}" flood-color="#4a3726" flood-opacity="0.30"/>
    </filter>
  </defs>
  <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${r}"
        fill="url(#seal)" filter="url(#soft)"/>
  <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${r}"
        fill="url(#gloss)"/>
  <rect x="${(inset + size * 0.075).toFixed(2)}" y="${(inset + size * 0.075).toFixed(2)}"
        width="${(size - (inset + size * 0.075) * 2).toFixed(2)}" height="${(size - (inset + size * 0.075) * 2).toFixed(2)}"
        rx="${ir}" fill="none" stroke="#fff8f2" stroke-opacity="0.30" stroke-width="${Math.max(1, size * 0.012).toFixed(2)}"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
        font-family="'Source Han Serif SC','Noto Serif SC','Songti SC','SimSun',serif"
        font-size="${fontSize}" font-weight="600" fill="#fff8f2"
        style="paint-order:stroke fill">此</text>
</svg>`;
}

/** 小尺寸：笔画糊掉，改用克制的双层方印 */
function smallSVG(size) {
  const inset = size * 0.07;
  const r = size * 0.235;
  const barH = Math.max(1.6, size * 0.115);
  const barW = size * 0.44;
  const gap = size * 0.14;
  const cx = size / 2;
  const cy = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="seal" x1="0.12" y1="0" x2="0.88" y2="1">
      <stop offset="0" stop-color="#e57a55"/>
      <stop offset="0.52" stop-color="#cf6438"/>
      <stop offset="1" stop-color="#a94a24"/>
    </linearGradient>
  </defs>
  <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${r}" fill="url(#seal)"/>
  <rect x="${inset + size * 0.11}" y="${inset + size * 0.11}" width="${size - (inset + size * 0.11) * 2}" height="${size - (inset + size * 0.11) * 2}"
        rx="${r * 0.6}" fill="none" stroke="#fff8f2" stroke-opacity="0.55" stroke-width="${Math.max(1, size * 0.035).toFixed(2)}"/>
  <rect x="${(cx - barW / 2).toFixed(2)}" y="${(cy - gap / 2 - barH).toFixed(2)}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" rx="${(barH / 2).toFixed(2)}" fill="#fff8f2"/>
  <rect x="${(cx - barW / 2).toFixed(2)}" y="${(cy + gap / 2).toFixed(2)}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" rx="${(barH / 2).toFixed(2)}" fill="#fff8f2"/>
</svg>`;
}

/* ---------------- PNG 编码（纯 Node，无依赖） ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** BGRA 像素 → PNG（8 位 RGBA） */
function encodePNG(bgra, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y += 1) {
    raw[o] = 0; // filter: None
    o += 1;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      raw[o] = bgra[i + 2]; // R
      raw[o + 1] = bgra[i + 1]; // G
      raw[o + 2] = bgra[i]; // B
      raw[o + 3] = bgra[i + 3]; // A
      o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 多尺寸 PNG → ICO（Vista 起支持 PNG 压缩条目，256 尺寸必须用 PNG） */
function buildICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir[b] = e.size >= 256 ? 0 : e.size;
    dir[b + 1] = e.size >= 256 ? 0 : e.size;
    dir[b + 2] = 0; // palette
    dir[b + 3] = 0; // reserved
    dir.writeUInt16LE(1, b + 4); // color planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32BE(0, b + 8);
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* ---------------- 渲染 ---------------- */
async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = new BrowserWindow({
    width: 400,
    height: 400,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, offscreen: true },
  });

  const entries = [];
  const report = [];

  for (const size of SIZES) {
    const svg = size <= 32 ? smallSVG(size) : markSVG(size);
    const page =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
      'html,body{margin:0;padding:0;background:transparent;width:' + size + 'px;height:' + size + 'px;overflow:hidden}' +
      'svg{display:block}</style></head><body>' + svg + '</body></html>';

    const tmp = path.join(OUT_DIR, `_icon-${size}.html`);
    fs.writeFileSync(tmp, page, 'utf8');
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, size <= 32 ? 160 : 320));

    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const bitmap = img.toBitmap();
    const real = img.getSize();
    const png = encodePNG(bitmap, real.width, real.height);
    fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), png);
    entries.push({ size: real.width, png });
    report.push(`${real.width}x${real.height}  ${(png.length / 1024).toFixed(1)} KB`);
    fs.unlinkSync(tmp);
  }

  const ico = buildICO(entries);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);

  console.log('=== 图标生成完成 ===');
  report.forEach((r) => console.log('  ' + r));
  console.log(`icon.ico  ${(ico.length / 1024).toFixed(1)} KB  (${entries.length} 个尺寸)`);
  console.log(`输出目录  ${OUT_DIR}`);

  app.exit(0);
}

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  run().catch((err) => {
    console.error('图标生成失败:', err);
    app.exit(1);
  });
});
