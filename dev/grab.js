/* 抓整个虚拟屏幕 + 用 SetWindowPos 把应用窗口精确摆到指定位置。
   GDI 的 CopyFromScreen 用的是物理像素，而 GetWindowRect 返回的是
   DIP；在 150% 缩放下两者差 1.5 倍，直接混用会截到错误区域
   （表现为「只截到窗口左上角一块」）。这里统一按物理像素换算。 */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const displays = screen.getAllDisplays();
  console.log(
    'displays: ' +
      JSON.stringify(
        displays.map((d) => ({ bounds: d.bounds, scaleFactor: d.scaleFactor, workArea: d.workArea })),
        null,
        0
      )
  );

  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    x: 40,
    y: 40,
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
  await new Promise((r) => setTimeout(r, 3200));

  const info = await win.webContents.executeJavaScript(`(function(){
    return { innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio,
             screenX: screenX, screenY: screenY, outerW: outerWidth, outerH: outerHeight };
  })()`);
  console.log('renderer: ' + JSON.stringify(info));
  console.log('win bounds (DIP): ' + JSON.stringify(win.getBounds()));
  console.log('win bounds (physical): ' + JSON.stringify(win.getBounds())); // Electron returns DIP
  console.log('contentSize: ' + JSON.stringify(win.getContentSize()));

  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(path.join(__dirname, '..', '.shots', 'geometry.txt'), JSON.stringify({ displays, info, bounds: win.getBounds() }, null, 2));
  app.exit(0);
});
