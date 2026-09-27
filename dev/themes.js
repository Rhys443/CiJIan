/* 三套外观各截一张，用来确认切换真的生效、且各自成立。
   必须让窗口真显示：隐藏窗口里 Chromium 不出新帧，截图会拿到旧帧。

   用法：electron dev/themes.js */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, '..', '.shots');

function palette(img) {
  const bmp = img.toBitmap();
  const W = img.getSize().width;
  const H = img.getSize().height;
  const set = new Set();
  let sumL = 0;
  let n = 0;
  for (let y = 0; y < H; y += 5) {
    for (let x = 0; x < W; x += 5) {
      const i = (y * W + x) * 4;
      const l = (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3;
      sumL += l;
      n += 1;
      set.add(`${bmp[i] >> 4},${bmp[i + 1] >> 4},${bmp[i + 2] >> 4}`);
    }
  }
  return { colors: set.size, meanLum: Math.round(sumL / (n || 1)) };
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.min(1400, Math.round(d.bounds.width - 60)),
    height: Math.min(880, Math.round(d.bounds.height - 80)),
    x: 24,
    y: 24,
    show: true,
    frame: false,
    backgroundColor: '#f6efe6',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 2600));

  const CASES = [
    ['light', 'home'],
    ['dark', 'home'],
    ['spatial', 'home'],
    ['spatial', 'review'],
    ['spatial', 'checkin'],
  ];

  for (const [mode, route] of CASES) {
    await win.webContents.executeJavaScript(`(async function(){
      window.CJ.Store.state.settings.mode = ${JSON.stringify(mode)};
      window.Router.applyMode();
      window.Router.go(${JSON.stringify(route)});
      return 'ok';
    })()`);
    await new Promise((r) => setTimeout(r, route === 'review' ? 3600 : 2200));

    const modeNow = await win.webContents.executeJavaScript("document.documentElement.dataset.mode");
    const file = `theme-${mode}-${route}.png`;
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS, file), img.toPNG());
    const p = palette(img);
    const flag = modeNow === mode ? '  ' : '!!';
    console.log(
      `${flag}${file.padEnd(26)} mode=${String(modeNow).padEnd(8)} colours=${String(p.colors).padStart(5)}  meanLum=${p.meanLum}`
    );
  }

  app.exit(0);
});
