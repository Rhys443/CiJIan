/* 光学层自检（WebGL2 液态玻璃）。
 *
 * 回答三个问题：
 *   1. 光学层到底有没有起来（还是悄悄退回了 CSS）
 *   2. 着色器认出了几块玻璃、几团极光，用的是哪块 GPU
 *   3. 帧率是多少 —— 这是「必须考虑优化」那条要求的实测依据
 *
 * 用法：electron dev/optics-check.js [--css]
 *   --css  用 ?optics=0 强制走 CSS 回退，量一组对照数据
 */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, '..', '.shots');
const FORCE_CSS = process.argv.includes('--css');
const ZONES = process.argv.includes('--zones');
const TAG = FORCE_CSS ? 'css' : (ZONES ? 'zones' : 'webgl');

function stats(img) {
  const bmp = img.toBitmap();
  const W = img.getSize().width;
  const H = img.getSize().height;
  const set = new Set();
  let min = 255;
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < H; y += 5) {
    for (let x = 0; x < W; x += 5) {
      const i = (y * W + x) * 4;
      const l = (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3;
      if (l < min) min = l;
      if (l > max) max = l;
      sum += l;
      n++;
      set.add(`${bmp[i] >> 4},${bmp[i + 1] >> 4},${bmp[i + 2] >> 4}`);
    }
  }
  return { w: W, h: H, colors: set.size, lum: `${Math.round(min)}-${Math.round(max)}`, mean: Math.round(sum / n) };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

app.whenReady().then(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const d = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.min(1420, Math.round(d.bounds.width - 40)),
    height: Math.min(900, Math.round(d.bounds.height - 60)),
    x: 20,
    y: 20,
    show: true,                 // 必须真显示：隐藏窗口里合成器被节流，WebGL 也会停摆
    frame: false,
    backgroundColor: '#f6efe6',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  const query = FORCE_CSS ? { query: { optics: '0' } }
            : ZONES ? { query: { optics: 'zones' } }
            : undefined;
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), query);
  await wait(4000);

  // 帧率探针必须在窗口位于最前时跑：被盖住时 Chromium 会把
  // requestAnimationFrame 节流到 0，量出来是「0 fps」——纯粹是量具假象。
  win.moveTop();
  win.focus();
  await wait(900);

  const probe = await win.webContents.executeJavaScript(`(async () => {
    const r = {};
    r.optics = document.documentElement.dataset.optics || '(unset)';
    const opt = window.Router && window.Router.optics;
    r.hasOptics = !!opt;
    if (opt) { r.panels = opt.panelCount; r.blobs = opt.blobCount; r.debug = opt.debug; }
    const c = document.getElementById('optics');
    r.canvas = c ? (c.width + 'x' + c.height) : null;
    if (c) {
      const gl = c.getContext('webgl2');
      r.glLost = gl ? gl.isContextLost() : 'no-context';
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        r.gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'n/a';
        r.glErr = gl.getError();
      }
    }
    // 画布必须真的夹在「底色」与「内容」之间，否则玻璃压不住内容、
    // 或者干脆被不透明的 .app 盖住。这条是最容易悄悄错的地方。
    const amb = document.querySelector('.ambient');
    const app = document.querySelector('.app');
    if (amb && app) {
      const a = getComputedStyle(amb), p = getComputedStyle(app);
      r.stack = 'ambient(z=' + a.zIndex + ',' + a.position + ') app(z=' + p.zIndex + ',' + p.position + ',bg=' + p.backgroundColor + ')';
    }

    // backdrop-filter 审计：光学层接管后，玻璃元素不该还在做实时模糊 ——
    // 那等于同一块玻璃算两遍。CSS 回退模式下则相反，应该还在用。
    const live = [];
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const cs = getComputedStyle(all[i]);
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      if (bf && bf !== 'none') {
        const cls = String(all[i].className || '') || all[i].tagName;
        live.push(cls.split(' ').slice(0, 2).join('.') + ' [' + bf.slice(0, 24) + ']');
      }
    }
    r.liveBackdrop = live;
    // 帧率：直接数 requestAnimationFrame，量 2 秒
    r.fps = await new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      (function f() {
        n++;
        const el = performance.now() - t0;
        if (el < 2000) requestAnimationFrame(f);
        else res(Math.round(n / (el / 1000)));
      })();
    });
    // 光斑是否真的在动：隔 600ms 取两次画布像素指纹
    r.moving = await new Promise((res) => {
      const grab = () => {
        try { return c.toDataURL('image/png').slice(-64); } catch (e) { return 'blocked'; }
      };
      const a = grab();
      setTimeout(() => res(grab() !== a), 600);
    });
    return r;
  })()`);

  console.log(`[${TAG}] optics=${probe.optics}  hasOptics=${probe.hasOptics}  panels=${probe.panels}  blobs=${probe.blobs}`);
  console.log(`[${TAG}] canvas=${probe.canvas}  glLost=${probe.glLost}  glError=${probe.glErr}  fps=${probe.fps}  animating=${probe.moving}`);
  console.log(`[${TAG}] stack: ${probe.stack}`);
  console.log(`[${TAG}] gpu=${probe.gpu}`);
  console.log(`[${TAG}] backdrop-filter still live on ${probe.liveBackdrop.length} element(s): ${JSON.stringify(probe.liveBackdrop)}`);
  if (probe.debug) {
    const d = probe.debug;
    console.log(`[${TAG}] mode=${d.mode} bg=${JSON.stringify(d.bg)} candidates=${d.candidates} picked=${d.picked}`);
    console.log(`[${TAG}] blob radius=${JSON.stringify(d.radii)} weight=${JSON.stringify(d.weights)}`);
  }

  // 三套外观各截一张。必须走应用自己的 applyMode ——
  // 直接改 dataset 不会带上 data-spatial / reduceMotion 等联动。
  //
  // 注意分成两次注入、中间隔一拍：同一次注入里刚写进 Store 的值，
  // applyMode() 读到的还是旧的，于是三张图会整体错位一档
  // （暗房拍到暖纸、空间拍到暗房）。这是量具的问题，不是应用的问题，
  // 但它会让人得出「暗房模式发白」这种完全错误的结论。
  for (const mode of ['light', 'dark', 'spatial']) {
    await win.webContents.executeJavaScript(
      `window.CJ.Store.state.settings.mode=${JSON.stringify(mode)}; "ok"`
    );
    await wait(200);
    await win.webContents.executeJavaScript('window.Router.applyMode(); "ok"');
    // 等底色与面板尺寸都稳定下来（光学层会在这段时间里持续重读）
    await wait(1600);
    // 截图前必须把这个窗口抬到最前。
    // 被别的窗口盖住时 Chromium 会停止合成，capturePage() 于是返回上一帧 ——
    // 表现是「暗房拍出来是暖纸」，但同一时刻 dump 出来的 uniform 明明是暗的。
    // 这是量具的坑，不是应用的问题；别照着截图去改渲染代码。
    win.moveTop();
    win.focus();
    await wait(700);
    // 再截一次：第一张偶尔仍是上一档的合成帧（整档错位，暗房拍到暖纸）。
    // 丢掉第一张、留第二张，比事后再去猜「到底是渲染错了还是量错了」便宜得多。
    await win.webContents.capturePage();
    await wait(500);
    const img = await win.webContents.capturePage();
    const file = `optics-${TAG}-${mode}.png`;
    fs.writeFileSync(path.join(SHOTS, file), img.toPNG());
    const s = stats(img);
    const dbg = await win.webContents.executeJavaScript(
      'JSON.stringify(window.Router.optics ? window.Router.optics.debug : null)'
    );
    console.log(`  ${file.padEnd(26)} ${s.w}x${s.h}  colours=${String(s.colors).padStart(5)}  lum=${s.lum}  mean=${s.mean}`);
    console.log(`      ${dbg}`);
  }

  app.exit(0);
});
