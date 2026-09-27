/* 定位：指针停在按钮上时，pointerleave 到底是谁触发的、目标元素是谁。
   用法：electron dev/_leave.js */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

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
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: false },
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 4200));

  const box = await win.webContents.executeJavaScript(`(function(){
    const btn = document.querySelector('.btn--primary');
    const r = btn.getBoundingClientRect();
    window.__log = [];
    const name = (el) => el ? (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')) : 'null';
    ['pointerover','pointerout','pointerenter','pointerleave','pointermove'].forEach((t) => {
      document.addEventListener(t, (e) => {
        if (!e.target || !e.target.closest || !e.target.closest('.btn--primary')) return;
        window.__log.push(t + ' target=' + name(e.target) + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY));
      }, true);
    });
    return { x: Math.round(r.x + r.width * 0.3), y: Math.round(r.y + r.height * 0.5),
             rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  })()`);
  console.log('按钮: ' + JSON.stringify(box.rect) + '  目标点: ' + box.x + ',' + box.y);

  const send = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });

  send('mouseMove', 12, 12);
  await new Promise((r) => setTimeout(r, 500));
  send('mouseMove', box.x, box.y);
  await new Promise((r) => setTimeout(r, 1500));

  const out = await win.webContents.executeJavaScript(`(function(){
    const btn = document.querySelector('.btn--primary');
    const r = btn.getBoundingClientRect();
    const cx = ${box.x}, cy = ${box.y};
    return {
      log: window.__log,
      hot: getComputedStyle(btn).getPropertyValue('--lhot').trim(),
      rectNow: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      cursorStillInside: cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height,
      topElement: (function(){ const el = document.elementFromPoint(cx, cy); return el ? el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.') : null; })(),
      glowBlend: (function(){ const g = btn.querySelector('.light-glow'); return g ? getComputedStyle(g).mixBlendMode : null; })()
    };
  })()`);

  console.log('\n事件序列:');
  out.log.forEach((l) => console.log('  ' + l));
  console.log('\nhot=' + out.hot);
  console.log('按钮矩形: ' + JSON.stringify(out.rectNow));
  console.log('光标是否仍在按钮内: ' + out.cursorStillInside);
  console.log('该点上最顶层的元素: ' + out.topElement);
  console.log('光晕的混合模式: ' + out.glowBlend);

  app.exit(0);
});
