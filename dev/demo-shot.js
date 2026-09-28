/* ============================================================
   HTML 范例截图（不是真项目的截图工具）

   为什么单独一个：
   dev/shot.js 是给**真项目**用的（它要注册 bg:// 协议、注入
   CJ.Store 的演示状态、设路由）。确认用的范例是独立的单个 HTML，
   没有那些东西 —— 拿 shot.js 去拍只会得到一张空页面。

   用法：
     electron dev/demo-shot.js <file.html> <outName> [--w=1180] [--h=2400]
                               [--js="页面里要执行的脚本"] [--wait=1200]

   --js 用来制造"打开状态"：比如点开弹层再截图。
   注意它执行完之后会再等 --wait 毫秒，动画才走得完。
   ============================================================ */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const ARGV = process.argv.slice(2);
const FLAGS = ARGV.filter((a) => a.startsWith('--'));
const POS = ARGV.filter((a) => !a.startsWith('--'));
const get = (n, d) => {
  const f = FLAGS.find((x) => x.startsWith('--' + n + '='));
  return f ? f.slice(n.length + 3) : d;
};

const FILE = POS[0];
const NAME = POS[1] || 'demo';
const W = parseInt(get('w', '1180'), 10);
const H = parseInt(get('h', '2400'), 10);
const JS = get('js', '');
const WAIT = parseInt(get('wait', '1200'), 10);
const OUT_DIR = process.env.CJ_SHOT_DIR || 'D:\\legion\\Documents\\harness';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  if (!FILE) { console.log('用法：electron dev/demo-shot.js <file.html> <outName>'); app.exit(1); return; }

  /* 高度可以超过一个屏幕：窗口按内容尺寸开，屏幕上放不下也没关系 ——
     抓屏只抓得到可见的那一块，所以超长页面要分段拍（见 --scroll）。 */
  const disp = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: W, height: Math.min(H, disp.size.height - 80),
    show: true, frame: false, backgroundColor: '#26221f',
    webPreferences: { contextIsolation: true, sandbox: false },
  });

  /* 页面里的报错一定要能看见。
     "范例里动画完全没反应"这种事，八成是第一行脚本就抛了 ——
     而截图上看不出来，只会以为"这个浏览器不支持"。
     把页面控制台整条接过来打，是查这类问题唯一有效的办法。 */
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = level >= 2 ? 'PAGE-ERROR' : 'PAGE';
    console.log(tag + ' ' + message + (sourceId ? '  @' + String(sourceId).split('/').pop() + ':' + line : ''));
  });
  win.webContents.on('render-process-gone', (_e, d) => console.log('PAGE-GONE ' + JSON.stringify(d)));

  await win.loadFile(path.resolve(FILE));
  await wait(900);

  const errs = await win.webContents.executeJavaScript(
    `(() => { const e = window.__err || []; return e.length ? e.join(' || ') : ''; })()`);
  if (errs) console.log('PAGE-ERRVAR ' + errs);
  /* 先把窗口摆到最前，**再**跑探针。
     顺序很关键：Chromium 对"被遮挡/在后台"的页面会节流 requestAnimationFrame，
     而探针（尤其是量动画的）几乎都要靠 rAF —— 先跑探针会让它一帧都不回调，
     拿回来一个空结果，看上去像"动画坏了"。这一轮就踩过。 */
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop(); win.focus();
  await wait(700);

  if (JS) {
    /* 用 async 包一层并 await：探针经常是「点一下 → 等动画走完 → 再量」，
       不支持 await 的话只能拿到 "[object Promise]"（动画类的问题全靠这个量）。 */
    const r = await win.webContents.executeJavaScript(
      `(async () => { try { return JSON.stringify(await (${JS})); }
                      catch (e) { return 'THREW ' + e.message; } })()`);
    console.log('JS -> ' + r);
    await wait(WAIT);
  }

  /* 抓屏抓的是整个屏幕，所以必须保证**它**在最前面。
     只 moveTop() 不够 —— 浏览器/编辑器抢焦点时会拍到别的窗口，
     白白得到一张"看起来截图工具有问题"的图（这一轮已经踩过一次）。 */
  win.setAlwaysOnTop(false);

  const b = win.getBounds();
  const sources = await require('electron').desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: disp.size.width, height: disp.size.height },
  });
  if (!sources || !sources.length) { console.log('抓屏失败'); app.exit(3); return; }
  const img = sources[0].thumbnail;
  const sz = img.getSize();
  const k = sz.width / disp.size.width;
  const rect = {
    x: Math.max(0, Math.round(b.x * k)), y: Math.max(0, Math.round(b.y * k)),
    width: Math.round(b.width * k), height: Math.round(b.height * k),
  };
  rect.width = Math.min(rect.width, sz.width - rect.x);
  rect.height = Math.min(rect.height, sz.height - rect.y);

  const out = img.crop(rect);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const png = path.join(OUT_DIR, NAME + '.png');
  fs.writeFileSync(png, out.toPNG());
  console.log('DEMOSHOT ' + NAME + '  ' + out.getSize().width + 'x' + out.getSize().height + '  ' + png);
  app.exit(0);
});
