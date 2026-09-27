/* ============================================================
   把三张程序化预设底图导出成图片，单独看一眼。

   为什么需要：预设画完之后还要依次穿过「压暗层 → 玻璃模糊 → 暗色令牌」
   三层，在应用截图里根本判断不出底图本身画得好不好。
   判断一张底图必须看它自己。

   用法：
     electron dev/presets.js [outDir]
   ============================================================ */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = process.argv[2] || (process.env.CJ_SHOT_DIR || 'D:\\legion\\Documents\\harness');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });

  // 空白页里直接注入 background.js —— 它是个 IIFE，只依赖 window 和 document
  await win.loadURL('data:text/html,<html><body></body></html>');
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'background.js'), 'utf8');
  await win.webContents.executeJavaScript(src + '; "loaded"');

  const ids = await win.webContents.executeJavaScript('window.Background.PALETTES && Object.keys(window.Background.PALETTES)');
  console.log('PRESETS', JSON.stringify(ids));

  for (const id of ids) {
    const dataUrl = await win.webContents.executeJavaScript(`(() => {
      /* 顺手把绘制耗时量出来。预设是**启动时同步画**的（restore() 里
         直接 setPreset），所以这段时间会实打实挡住第一帧 ——
         用户说的「开启速度有点缓慢」很可能就是它。 */
      const t0 = performance.now();
      const api = window.Background.create({});
      const t1 = performance.now();
      api.setPreset(${JSON.stringify(id)});
      const t2 = performance.now();
      const c = api.element;
      window.__paintMs = { create: t1 - t0, paint: t2 - t1 };
      return c && c.toDataURL ? c.toDataURL('image/jpeg', 0.88) : null; })()`);

    const ms = await win.webContents.executeJavaScript('JSON.stringify(window.__paintMs)');
    console.log('TIMING ' + id + ' ' + ms);

    if (!dataUrl) { console.log('FAIL', id); continue; }
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const file = path.join(OUT, 'preset-' + id + '.jpg');
    fs.writeFileSync(file, buf);
    console.log('WROTE', file, Math.round(buf.length / 1024) + 'KB');
  }

  app.exit(0);
});
