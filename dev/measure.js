/* 在真实窗口上量 DOM 几何。
   必须让窗口真显示 —— 隐藏窗口里 Chromium 不出新帧，量出来的东西会骗人。
   用法：electron dev/measure.js */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

const WANT = process.env.CJ_MEASURE || 'review';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: true,
    x: 60,
    y: 60,
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

  const route = { home: '1', draw: '2', checkin: '3', review: '4', settings: '5' }[WANT] || '4';
  await win.webContents.executeJavaScript(`window.Router.go(${JSON.stringify(WANT)}); "ok"`);
  await new Promise((r) => setTimeout(r, route === '4' ? 3600 : 1500));

  const out = await win.webContents.executeJavaScript(`(function(){
    const R = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    const V = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { r: R(sel), cssVar: {
        r: cs.getPropertyValue('--ring-r').trim(),
        h: cs.getPropertyValue('--ring-h').trim(),
        cardW: cs.getPropertyValue('--ring-card-w').trim()
      }};
    };
    return {
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      view: R('.view'),
      block: R('.ring-block'),
      hint: R('.ring-hint'),
      progress: R('.ring-progress'),
      wrap: V('.ring-wrap'),
      spin: R('.ring-spin'),
      firstItem: R('.ring-item[data-day="1"]'),
      hero: R('.review-hero'),
      blockScrollH: (function(){ const el = document.querySelector('.ring-block'); return el ? el.scrollHeight : null; })(),
      itemsCount: document.querySelectorAll('.ring-item').length,
      wrapOverflow: (function(){ const el = document.querySelector('.ring-block'); return el ? getComputedStyle(el).overflow : null; })()
    };
  })()`);

  console.log(JSON.stringify(out, null, 2));
  await new Promise((r) => setTimeout(r, 200));
  app.exit(0);
});
