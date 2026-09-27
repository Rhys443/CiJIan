/* 隔离验证 @avenra/liquid-glass：确认它在 Electron 里能真正做折射，
   而不是静默降级成纯模糊。

   用法：electron dev/glass-test.js */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#050505}
  /* 造一个「缓慢漂移的彩色光斑」背景 —— 必须能看出玻璃在折射它 */
  .bg{position:fixed;inset:0;overflow:hidden}
  .blob{position:absolute;width:46vw;height:46vw;border-radius:50%;filter:blur(60px);opacity:.9;
        will-change:transform}
  .b1{background:radial-gradient(circle,#0a84ff,transparent 68%);left:6%;top:8%}
  .b2{background:radial-gradient(circle,#bf5af2,transparent 68%);right:8%;top:26%}
  .b3{background:radial-gradient(circle,#32d74b,transparent 68%);left:34%;bottom:-6%}
  @keyframes d1{to{transform:translate(14vw,10vh) scale(1.2)}}
  @keyframes d2{to{transform:translate(-12vw,14vh) scale(1.15)}}
  @keyframes d3{to{transform:translate(10vw,-12vh) scale(1.25)}}
  .b1{animation:d1 6s ease-in-out infinite alternate}
  .b2{animation:d2 7.5s ease-in-out infinite alternate}
  .b3{animation:d3 9s ease-in-out infinite alternate}
  /* 背景上再放几条直线，用来肉眼判断「直线在玻璃边缘有没有被弯折」 */
  .lines{position:fixed;inset:0;background:repeating-linear-gradient(90deg,
        rgba(255,255,255,.5) 0 2px, transparent 2px 42px)}
  .stage{position:fixed;inset:0;display:grid;place-items:center}
  #card{width:420px;height:260px;border-radius:24px;color:#fff;
        display:grid;place-items:center;font:400 15px/1.6 system-ui;
        background:rgba(255,255,255,.04);
        box-shadow:0 30px 60px -20px rgba(0,0,0,.7)}
</style></head><body>
  <div class="bg"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i></div>
  <div class="lines"></div>
  <div class="stage"><div id="card">LIQUID GLASS<br><span id="mode">检测中…</span></div></div>
  <script src="../renderer/vendor/liquid-glass.umd.min.js"></script>
  <script>
    window.__r = { loaded: false };
    try {
      const LG = window.LiquidGlass;
      window.__r.loaded = !!LG;
      window.__r.exports = LG ? Object.keys(LG) : null;
      window.__r.hasChrome = !!window.chrome;
      const probe = document.createElement('div').style;
      window.__r.backdropInUrlSupport = typeof probe.backdropFilter === 'string' &&
        probe.backdropFilter !== undefined;
      // 库自己的能力探测
      if (LG && typeof LG.supportsBackdropFilter === 'function') {
        window.__r.supportsBackdropFilter = LG.supportsBackdropFilter();
      }
      if (LG && typeof LG.createLiquidGlass === 'function') {
        window.__r.handle = LG.createLiquidGlass('#card', { blur: 6, glassThickness: 90 });
        window.__r.mode = 'refraction';
        document.getElementById('mode').textContent = 'createLiquidGlass 已调用';
      } else {
        window.__r.mode = 'no-api';
        document.getElementById('mode').textContent = '没有 createLiquidGlass';
      }
    } catch (e) {
      window.__r.error = e.message + ' | ' + (e.stack || '').split('\\n')[1];
      document.getElementById('mode').textContent = 'ERR: ' + e.message;
    }
  </script>
</body></html>`;

app.whenReady().then(async () => {
  const tmp = path.join(__dirname, '..', '.shots', '_glass-test.html');
  fs.writeFileSync(tmp, PAGE, 'utf8');

  const d = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.min(1200, Math.round(d.bounds.width - 80)),
    height: Math.min(800, Math.round(d.bounds.height - 120)),
    x: 30,
    y: 30,
    show: true,
    frame: false,
    backgroundColor: '#050505',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  win.webContents.on('console-message', (...args) => {
    const e = args[0] || {};
    console.log('[console:' + (e.level || args[1]) + '] ' + (e.message || args[2]));
  });

  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 3000));

  const report = await win.webContents.executeJavaScript('window.__r');
  console.log('\n=== 库自检 ===');
  console.log(JSON.stringify(report, null, 2));

  // 看玻璃上是否真的挂了 url(#...) 的 backdrop-filter
  const dom = await win.webContents.executeJavaScript(`(function(){
    const card = document.getElementById('card');
    const out = { cardChildren: card ? card.children.length : 0, filters: [] };
    if (card) {
      Array.from(card.querySelectorAll('*')).slice(0, 12).forEach((el) => {
        const cs = getComputedStyle(el);
        const bd = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
        if (bd && bd !== 'none') out.filters.push({ tag: el.tagName.toLowerCase(), cls: el.className, bd });
      });
      const cs2 = getComputedStyle(card);
      out.cardBackdrop = cs2.backdropFilter || cs2.webkitBackdropFilter || 'none';
    }
    out.svgFilters = Array.from(document.querySelectorAll('filter')).map((f) => f.id);
    out.feDisplacement = document.querySelectorAll('feDisplacementMap').length;
    out.feImage = document.querySelectorAll('feImage').length;
    return out;
  })()`);
  console.log('\n=== DOM 检查 ===');
  console.log(JSON.stringify(dom, null, 2));

  fs.writeFileSync(path.join(__dirname, '..', '.shots', 'glass-test.png'), (await win.webContents.capturePage()).toPNG());
  console.log('\n截图: .shots/glass-test.png');

  const ok =
    report.loaded &&
    (report.supportsBackdropFilter === true) &&
    dom.feDisplacement > 0;
  console.log('\n判定: ' + (ok ? '✓ 折射链路已建立' : '✗ 未能建立折射（可能降级成纯模糊）'));
  app.exit(ok ? 0 : 1);
});
