/* 一次性诊断：最小化画布测试 —— 判断 capture 管线本身是否可靠。
   用法：CJ_DIAG=1 electron . */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function findColor(img, rgb, tol = 20) {
  const size = img.getSize();
  const bmp = img.toBitmap();
  const W = size.width;
  const H = size.height;
  let count = 0;
  let firstAt = null;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      if (
        Math.abs(bmp[i] - rgb[2]) < tol &&
        Math.abs(bmp[i + 1] - rgb[1]) < tol &&
        Math.abs(bmp[i + 2] - rgb[0]) < tol
      ) {
        count += 1;
        if (!firstAt) firstAt = [x, y];
      }
    }
  }
  return `${count}@${firstAt}`;
}

const MINIMAL = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#f0eadf}
  .bar{height:60px;background:#ff0000}
  .mid{height:200px;background:#00ff00;margin:40px}
  .low{height:300px;background:#0000ff;margin-top:1200px}
</style></head><body>
  <div class="bar"></div><div class="mid"></div><div class="low"></div>
</body></html>`;

async function run() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  // 1) 最小 HTML：capture 管线是否可靠？
  const tmp = path.join(__dirname, '..', '.probe', 'minimal.html');
  fs.writeFileSync(tmp, MINIMAL, 'utf8');
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 1200));
  let img = await win.webContents.capturePage();
  let size = img.getSize();
  console.log(`minimal: size=${size.width}x${size.height} red=${findColor(img, [255, 0, 0])} green=${findColor(img, [0, 255, 0])} blue=${findColor(img, [0, 0, 255])}`);

  // 2) 真实应用：注入纯色标记（同时去掉所有 backdrop-filter）
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { search: 'noanim=1' });
  await new Promise((r) => setTimeout(r, 2600));
  const markers = `
    *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;animation:none!important;transition:none!important}
    .hero{background:#ff0000!important}
    .side .panel{background:#00ff00!important}
    .titlebar{background:#0000ff!important}
    .view{background:#00ffff!important}
    .rail{background:#ff00ff!important}
  `;
  await win.webContents.insertCSS(markers, { cssOrigin: 'user' });
  await new Promise((r) => setTimeout(r, 1000));
  const dom = await win.webContents.executeJavaScript(`(function(){
    const g = (s) => { const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect();
      const c=getComputedStyle(e); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bg:c.backgroundColor,op:c.opacity}; };
    return { innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio,
      view: g('.view'), stage: g('.stage'), hero: g('.hero'), panel: g('.side .panel'), titlebar: g('.titlebar'), rail: g('.rail') };
  })()`);
  img = await win.webContents.capturePage();
  size = img.getSize();
  fs.writeFileSync(path.join(__dirname, '..', '.probe', 'mark-app.png'), img.toPNG());
  console.log('app dom: ' + JSON.stringify(dom));
  console.log(
    `app: size=${size.width}x${size.height} red(hero)=${findColor(img, [255, 0, 0])} green(panel)=${findColor(img, [0, 255, 0])} ` +
      `blue(titlebar)=${findColor(img, [0, 0, 255])} cyan(view)=${findColor(img, [0, 255, 255])} magenta(rail)=${findColor(img, [255, 0, 255])}`
  );
  app.exit(0);
}

module.exports = { run };
