/* 探明 @avenra/liquid-glass 的真实 API：导出清单 + createLiquidGlass 的实际参数。
   不猜，直接读 dist 产物。
   用法：electron dev/_api.js */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#111}
#panel{position:absolute;left:60px;top:60px;width:360px;height:200px;border-radius:24px;color:#fff}
</style></head><body>
<div id="panel">panel</div>
<script src="../renderer/vendor/liquid-glass.umd.min.js"></script>
<script>
window.__r = {};
try {
  const LG = window.LiquidGlass;
  window.__r.hasLib = !!LG;
  window.__r.keys = LG ? Object.keys(LG).sort() : null;
  window.__r.types = LG ? Object.fromEntries(Object.keys(LG).map(k => [k, typeof LG[k]])) : null;
  if (LG && typeof LG.createLiquidGlass === 'function') {
    // 读函数签名（形参名）——比猜可靠
    window.__r.createSrc = String(LG.createLiquidGlass).slice(0, 400);
  }
  if (LG && LG.PROFILES) window.__r.profiles = Object.keys(LG.PROFILES);
  // 探测能力
  try {
    const probe = document.createElement('div').style;
    probe.backdropFilter = 'url("#x")';
    window.__r.backdropUrlAccepted = probe.backdropFilter;
  } catch(e) { window.__r.backdropUrlErr = e.message; }
  window.__r.hasWindowChrome = !!window.chrome;
  if (LG && typeof LG.supportsBackdropFilter === 'function') {
    window.__r.libSupports = LG.supportsBackdropFilter();
  }
  // 尝试高层 API，先给最保守的参数
  if (LG && typeof LG.createLiquidGlass === 'function') {
    try {
      window.__r.handle = LG.createLiquidGlass('#panel', { bezelWidth: 22, glassThickness: 130 });
      window.__r.handleType = typeof window.__r.handle;
      // 只看纯数据：handle 是实例，直接回传会让 IPC 序列化失败
      window.__r.handleKeys = window.__r.handle ? Object.keys(window.__r.handle) : null;
      window.__r.handleProto = window.__r.handle
        ? Object.getOwnPropertyNames(Object.getPrototypeOf(window.__r.handle) || {})
        : null;
      window.__r.hasOn = !!(window.__r.handle && typeof window.__r.handle.on === 'function');
      delete window.__r.handle;
      // 看它往 DOM 里插了什么
      const p = document.getElementById('panel');
      window.__r.childrenAfter = Array.from(p.children).map(c => c.tagName.toLowerCase() + '.' + String(c.className));
      window.__r.ownBackdrop = getComputedStyle(p).backdropFilter;
      window.__r.filtersInDoc = Array.from(document.querySelectorAll('filter')).map(f => f.id);
      window.__r.feDisp = document.querySelectorAll('feDisplacementMap').length;
      window.__r.feImage = document.querySelectorAll('feImage').length;
      // 子元素上有没有 backdrop-filter: url(...)
      window.__r.urlBackdrops = Array.from(p.querySelectorAll('*')).map(el => {
        const cs = getComputedStyle(el);
        const bd = cs.backdropFilter || cs.webkitBackdropFilter || '';
        return bd.includes('url(') ? { tag: el.tagName.toLowerCase(), cls: String(el.className), bd } : null;
      }).filter(Boolean);
    } catch (e) {
      window.__r.createError = e.message;
    }
  }
} catch (e) {
  window.__r.fatal = e.message + ' | ' + (e.stack||'').split('\\n').slice(1,3).join(' <- ');
}
</script></body></html>`;

app.whenReady().then(async () => {
  const tmp = path.join(__dirname, '..', '.shots', '_api.html');
  fs.writeFileSync(tmp, PAGE, 'utf8');

  const win = new BrowserWindow({
    width: 900,
    height: 520,
    x: 40,
    y: 40,
    show: true,
    frame: false,
    backgroundColor: '#111111',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.webContents.on('console-message', (...args) => {
    const e = args[0] || {};
    const lvl = e.level || args[1];
    const msg = e.message || args[2];
    if (String(lvl) !== 'info') console.log('[' + lvl + '] ' + msg);
  });

  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 2500));
  const out = await win.webContents.executeJavaScript('window.__r');
  console.log(JSON.stringify(out, null, 2));
  app.exit(0);
});
