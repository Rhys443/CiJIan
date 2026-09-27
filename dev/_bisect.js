/* 可靠截图验证：窗口移到屏幕外真实显示（不是 show:false）。
   隐藏窗口只在第一次 capturePage 时给一帧，之后全是旧帧，
   用它做诊断会得出「内容没画出来」这种错误结论。 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    x: -3000,
    y: 0,
    show: true,
    skipTaskbar: true,
    frame: false,
    backgroundColor: '#f6efe6',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { search: 'noanim=1' });
  await new Promise((r) => setTimeout(r, 3000));

  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    const img = await win.webContents.capturePage();
    const bmp = img.toBitmap();
    const W = img.getSize().width;
    const set = new Set();
    for (let y = 0; y < img.getSize().height; y += 4) {
      for (let x = 0; x < W; x += 4) {
        const k = (y * W + x) * 4;
        set.add(`${bmp[k] >> 3},${bmp[k + 1] >> 3},${bmp[k + 2] >> 3}`);
      }
    }
    seen.push(set.size);
    await new Promise((r) => setTimeout(r, 700));
  }
  console.log('连续 4 次截图的颜色数量:', seen.join(', '));
  console.log(seen[3] > 60 ? '=> 画面持续渲染，诊断结果可信' : '=> 仍然拿不到真实画面');

  fs.writeFileSync(
    path.join(__dirname, '..', '.shots', 'visible-check.png'),
    (await win.webContents.capturePage()).toPNG()
  );
  console.log('已保存 .shots/visible-check.png');
  app.exit(0);
});
