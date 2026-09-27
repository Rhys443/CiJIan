/* 实机截图（可靠版）。
 *
 * 两条踩过的坑：
 * 1. capturePage() 对隐藏窗口只会返回一帧旧帧，用它验证渲染会得出完全错误的结论
 *    —— 所以这里必须把窗口真显示出来。
 * 2. 本机显示器是 150% 缩放，BrowserWindow 的 width/height 是 DIP、x/y 却是物理像素；
 *    GDI 抓屏还会再混一层，于是「截图只截到左上角一块」。既然窗口真显示了，
 *    直接让 Electron 自己截，坐标系问题就消失了。
 *
 * 用法：electron dev/shots.js
 */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, '..', '.shots');

const VIEWS = [
  { key: 'home', label: '今天', wait: 4200 },
  { key: 'draw', label: '抽卡', wait: 4200 },
  { key: 'checkin', label: '打卡', wait: 8000 },
  { key: 'review', label: '回顾', wait: 7000 },
  { key: 'settings', label: '设置', wait: 4200 },
];

function stats(img) {
  const bmp = img.toBitmap();
  const W = img.getSize().width;
  const H = img.getSize().height;
  const set = new Set();
  let min = 255;
  let max = 0;
  for (let y = 0; y < H; y += 5) {
    for (let x = 0; x < W; x += 5) {
      const i = (y * W + x) * 4;
      const l = (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3;
      if (l < min) min = l;
      if (l > max) max = l;
      set.add(`${bmp[i] >> 4},${bmp[i + 1] >> 4},${bmp[i + 2] >> 4}`);
    }
  }
  return { w: W, h: H, colors: set.size, lum: `${Math.round(min)}-${Math.round(max)}` };
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const sf = d.scaleFactor;
  // 留出边距，窗口完整落在屏幕内
  const dipW = Math.min(1420, Math.round(d.bounds.width - 40));
  const dipH = Math.min(900, Math.round(d.bounds.height - 60));

  const win = new BrowserWindow({
    width: dipW,
    height: dipH,
    x: 20,
    y: 20,
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
  await new Promise((r) => setTimeout(r, 4000)); // 等开屏动画走完

  const report = [];
  for (const v of VIEWS) {
    // 用应用自己的路由切换（等价于按数字键），比 SendKeys 可靠
    await win.webContents.executeJavaScript(`window.Router.go(${JSON.stringify(v.key)}); "ok"`);
    await new Promise((r) => setTimeout(r, v.wait));
    // 校验：真的切过去了才截图，否则会拍到上一页（之前就踩过这个坑）
    const actual = await win.webContents.executeJavaScript('window.Router.current');
    const img = await win.webContents.capturePage();
    const file = `live-${v.key}.png`;
    fs.writeFileSync(path.join(SHOTS, file), img.toPNG());
    const s = stats(img);
    const flag = actual === v.key ? '  ' : '!!';
    report.push(
      `${flag} ${file.padEnd(22)} route=${String(actual).padEnd(9)} ${s.w}x${s.h}  colours=${String(s.colors).padStart(5)}  lum=${s.lum}`
    );
    console.log(report[report.length - 1]);
  }

  // 关掉动效后再截一张，方便看静态构图（动画中途截图会看到半透明中间态）
  await win.webContents.executeJavaScript(
    `document.documentElement.dataset.noanim='on'; window.CJ.Store.state.settings.mode='dark'; window.Router.applyMode(); window.Router.go('home'); "ok"`
  );
  await new Promise((r) => setTimeout(r, 2500));
  const dark = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SHOTS, 'live-dark.png'), dark.toPNG());
  console.log(`live-dark.png         ${JSON.stringify(stats(dark))}`);
  void sf;

  app.exit(0);
});
