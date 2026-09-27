/* 一次性冒烟测试：隐藏窗口加载真实页面，收集控制台错误、测量布局并截图后退出。
   仅供开发期自检使用，不属于应用本体。
   入口：CJ_PROBE=1 时由 main.js 调用，复用真实主进程的 IPC 处理器。 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const problems = [];
const logs = [];

// 硬超时：任何一步卡住都不要把开发流程挂死
const HARD_TIMEOUT = setTimeout(() => {
  console.log('=== HARD TIMEOUT: 探针超过 90 秒未完成 ===');
  problems.forEach((p) => console.log('problem: ' + p));
  app.exit(2);
}, 90000);

function shot(win, file) {
  return Promise.race([
    capture(win, file),
    new Promise((r) => setTimeout(() => r(false), 12000)),
  ]);
}

/**
 * 隐藏窗口里 Chromium 不会主动产出新帧，capturePage 会拿到过期画面。
 * 用 DevTools 协议强制重新合成再截图（Page.captureScreenshot，fromSurface:true）。
 */
async function capture(win, file) {
  const wc = win.webContents;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Page.enable').catch(() => {});
    const res = await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (!res || !res.data) return false;
    fs.writeFileSync(path.join(__dirname, '..', '.shots', file), Buffer.from(res.data, 'base64'));
    return true;
  } catch (err) {
    // 退回普通截图
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(__dirname, '..', '.shots', file), img.toPNG());
      return true;
    } catch (err2) {
      return false;
    }
  }
}

async function run() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    frame: false,
    backgroundColor: '#faf6ef',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: false,
    },
  });

  win.webContents.on('console-message', (...args) => {
    const event = args[0];
    const level = event && typeof event === 'object' && 'level' in event ? event.level : args[1];
    const message = event && typeof event === 'object' && 'message' in event ? event.message : args[2];
    logs.push(`[console:${level}] ${message}`);
    if (level === 'error' || level === 3) problems.push(`console:${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    problems.push(`did-fail-load ${code} ${desc} ${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    problems.push(`render-process-gone ${JSON.stringify(details)}`);
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    problems.push(`preload-error ${p} ${err.message}`);
  });
  win.webContents.on('unresponsive', () => problems.push('renderer unresponsive'));

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { search: 'noanim=1' });
  await new Promise((r) => setTimeout(r, 3600));

  const probe = await win.webContents.executeJavaScript(`(function(){
    const out = { ok: false };
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
               display: cs.display, opacity: cs.opacity, overflow: cs.overflow, visibility: cs.visibility };
    };
    try {
      out.views = Object.keys(window.Views || {});
      out.nav = document.querySelectorAll('#nav .nav__item').length;
      out.cells = document.querySelectorAll('.cell').length;
      out.checkins = window.CJ.Store.state.checkins.length;
      out.photoDataUrlLen = window.Photo.photo(123456, 320).length;
      out.boxes = {
        app: rect('.app'),
        shell: rect('.shell'),
        stage: rect('.stage'),
        view: rect('.view'),
        viewInner: rect('.view-inner'),
        homeGrid: rect('.home-grid'),
        hero: rect('.hero'),
        ring: rect('.ring'),
        grid15: rect('.grid15'),
        side: rect('.side')
      };
      const v = document.querySelector('.view');
      out.viewScroll = v ? { scrollH: v.scrollHeight, clientH: v.clientHeight } : null;
      const overture = document.querySelector('.overture');
      out.overtureGone = !overture;

      // 深度诊断：几何正确却画不出来时，逐层查 opacity / filter / blend / 动画状态
      out.diag = {};
      ['.view', '.view-inner', '.home-grid', '.hero', '.hero__greet', '.grid15', '.cell', '.side', '.panel', '.card']
        .forEach((sel) => {
          const el = document.querySelector(sel);
          if (!el) { out.diag[sel] = null; return; }
          const cs = getComputedStyle(el);
          out.diag[sel] = {
            op: cs.opacity, filter: cs.filter, blend: cs.mixBlendMode, vis: cs.visibility,
            anim: cs.animationName, animState: cs.animationPlayState, fill: cs.animationFillMode,
            bg: cs.backgroundColor, color: cs.color, z: cs.zIndex, pos: cs.position, transform: cs.transform
          };
        });
      out.anims = document.querySelector('.view').getAnimations({ subtree: true }).length;
      const hero = document.querySelector('.hero');
      if (hero) {
        const r = hero.getBoundingClientRect();
        const mid = document.elementFromPoint(r.x + r.width / 2, r.y + 40);
        out.heroHit = mid ? (mid.className || mid.tagName) + '' : null;
      }
      out.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      out.ok = out.views.length === 5 && out.cells === 15 && out.checkins === 5 &&
               out.photoDataUrlLen > 2000 && out.overtureGone;
    } catch (e) {
      out.error = e.message + '\\n' + (e.stack || '');
    }
    return out;
  })()`);

  const pageResults = await win.webContents.executeJavaScript(`(async function(){
    const routes = ['draw','checkin','review','settings','home'];
    const res = {};
    for (const r of routes) {
      try {
        window.Router.go(r);
        await new Promise(s => setTimeout(s, 1000));
        const v = document.querySelector('.view');
        const inner = document.querySelector('.view-inner');
        const ir = inner ? inner.getBoundingClientRect() : null;
        res[r] = {
          nodes: document.querySelector('.view').children.length,
          text: (document.querySelector('.page-head h1') || {}).textContent || '',
          canvas: document.querySelectorAll('#view canvas').length,
          polaroids: document.querySelectorAll('#view .polaroid').length,
          innerH: ir ? Math.round(ir.height) : null,
          scrollH: v ? v.scrollHeight : null,
          clientH: v ? v.clientHeight : null
        };
      } catch (e) { res[r] = { error: e.message }; }
    }
    return res;
  })()`);

  const modalResult = await win.webContents.executeJavaScript(`(async function(){
    try {
      window.Router.openDay(2);
      await new Promise(s => setTimeout(s, 700));
      const open = document.querySelectorAll('.scrim .modal').length;
      const hasText = (document.querySelector('.scrim .modal__quote') || {}).textContent || '';
      document.querySelector('.scrim .modal__close').click();
      await new Promise(s => setTimeout(s, 500));
      return { open, quoteLen: hasText.length, closed: document.querySelectorAll('.scrim').length === 0 };
    } catch (e) { return { error: e.message }; }
  })()`);

  const shoot = async (route, file, waitMs) => {
    await win.webContents.executeJavaScript(`window.Router.go(${JSON.stringify(route)}); "ok"`);
    await new Promise((r) => setTimeout(r, waitMs));
    await shot(win, file);
  };

  await shoot('home', 'shot-home.png', 2000);
  // 抽卡动画：先清掉今日的抽卡记录，抓一次"牌堆摊开"的中途画面，
  // 之后立刻恢复，保证后面的首页截图是完整状态
  await win.webContents.executeJavaScript(
    'window.CJ.Store.clearDraw(window.CJ.Store.activeCycle(), window.CJ.Store.dayNumber(window.CJ.Store.activeCycle())); window.Router.go("draw"); "ok"'
  );
  await new Promise((r) => setTimeout(r, 1500));
  await shot(win, 'shot-draw-deck.png');
  await shoot('draw', 'shot-draw.png', 2400);
  // 恢复今日抽卡，让首页回到「已抽到卡」的完整形态
  await win.webContents.executeJavaScript(`(async function(){
    const S = window.CJ.Store;
    const cyc = S.activeCycle();
    const day = S.dayNumber(cyc);
    S.drawCard(cyc, day);
    window.Router.go('home');
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 1800));
  await shot(win, 'shot-home-full.png');
  // 回顾页：行星环需要一点时间转起来再截图
  await shoot('review', 'shot-review.png', 3600);
  // 悬停态：真实鼠标事件不好在离屏窗口里模拟，这里直接触发同一套逻辑
  await win.webContents.executeJavaScript(`(async function(){
    const item = document.querySelector('.ring-item[data-day="3"]');
    if (item) item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    const wrap = document.querySelector('.ring-wrap');
    if (wrap) wrap.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 2200));
  await shot(win, 'shot-review-hover.png');
  await shoot('checkin', 'shot-checkin.png', 4800);
  // 回顾页的网格视图
  await win.webContents.executeJavaScript(`(async function(){
    window.Router.go('review');
    await new Promise(r => setTimeout(r, 1400));
    const btns = document.querySelectorAll('.ring-block .seg button');
    if (btns[1]) btns[1].click();
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 1600));
  await shot(win, 'shot-review-grid.png');
  await shoot('settings', 'shot-settings.png', 2000);

  await win.webContents.executeJavaScript(
    'window.CJ.Store.state.settings.mode="dark"; window.Router.go("home"); "ok"'
  );
  // 隐藏窗口里 CSS transition 不会推进，切换主题的过渡会停在起始帧；
  // 截图时把过渡也一起关掉，才能拿到真实的暗色配色。
  await win.webContents
    .insertCSS('[data-noanim="on"] *{transition-duration:1ms!important;transition-delay:0ms!important}', { cssOrigin: 'user' })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await shot(win, 'shot-dark.png');

  // 自检会改到主题与亮暗模式，跑完恢复成演示初始状态，
  // 免得下次打开应用看到一个被测试改过的样子。
  await win.webContents.executeJavaScript(
    'window.CJ.Store.reset(true); "ok"'
  ).catch(() => {});

  console.log('=== PROBE ===');
  console.log(JSON.stringify(probe, null, 2));
  console.log('=== PAGES ===');
  console.log(JSON.stringify(pageResults, null, 2));
  console.log('=== MODAL ===');
  console.log(JSON.stringify(modalResult, null, 2));
  console.log('=== CONSOLE (' + logs.length + ') ===');
  logs.slice(0, 40).forEach((l) => console.log(l));
  console.log('=== PROBLEMS (' + problems.length + ') ===');
  problems.slice(0, 20).forEach((p) => console.log(p));

  const bad =
    problems.length > 0 ||
    !probe.ok ||
    Object.values(pageResults).some((r) => r.error || !r.nodes) ||
    modalResult.error ||
    !modalResult.open ||
    !probe.boxes ||
    !probe.boxes.hero ||
    probe.boxes.hero.h < 200;

  clearTimeout(HARD_TIMEOUT);
  app.exit(bad ? 1 : 0);
}

module.exports = { run };
