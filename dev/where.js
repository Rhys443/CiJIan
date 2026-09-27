/* 打印窗口的 DIP 与物理像素位置，确认 GDI 抓屏该用哪个矩形。
   用法：electron dev/where.js */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  console.log('primary display  bounds(DIP)=' + JSON.stringify(d.bounds) + '  scaleFactor=' + d.scaleFactor);
  const sf = d.scaleFactor;
  console.log(
    'primary display  bounds(physical)=' +
      JSON.stringify({
        x: Math.round(d.bounds.x * sf),
        y: Math.round(d.bounds.y * sf),
        w: Math.round(d.bounds.width * sf),
        h: Math.round(d.bounds.height * sf),
      })
  );

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    x: 60,
    y: 60,
    show: true,
    frame: false,
    backgroundColor: '#f6efe6',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 2500));

  const b = win.getBounds();
  const cb = win.getContentBounds();
  console.log('win.getBounds()        = ' + JSON.stringify(b) + '   (DIP)');
  console.log('win.getContentBounds() = ' + JSON.stringify(cb) + '   (DIP)');
  console.log(
    '  -> expected physical  = ' +
      JSON.stringify({
        x: Math.round(b.x * sf),
        y: Math.round(b.y * sf),
        right: Math.round((b.x + b.width) * sf),
        bottom: Math.round((b.y + b.height) * sf),
      })
  );

  const r = await win.webContents.executeJavaScript('({ sx: screenX, sy: screenY, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio })');
  console.log('renderer screenX/Y     = ' + JSON.stringify(r));

  app.exit(0);
});
