/* ============================================================
   实机截图工具（不依赖 capturePage）

   为什么要另起一个工具：
   `webContents.capturePage()` 在「transparent: true 的窗口 + 铺满全屏的
   WebGL 画布」这个组合下会**永久挂起** —— 本会话已经踩过两次，
   每次吃掉 200 秒超时，而且挂住之后 Electron 进程不会自己退出。

   改走 desktopCapturer：抓整个屏幕，再按窗口矩形裁掉四周。
   此间的窗口没有对系统隐藏自己（那是 C++ 原型才做的事），
   所以屏幕上看到什么就能抓到什么 —— 而且抓到的正是用户眼里的画面，
   比离屏截取更有说服力。

   用法：
     electron dev/shot.js <route> <mode> <outBasename> [preset] [开关…]
   例：
     electron dev/shot.js home light v12-home
     electron dev/shot.js review spatial v12-review dusk
     electron dev/shot.js settings light v12-settings --bottom
     electron dev/shot.js draw light v12-draw-plain --clean

   开关（都以 -- 开头，可以任意组合）：
     --clean     先清掉记住的底图再重载。**做"无底图"对照时必须加** ——
                 底图是持久化的，不加的话对照图其实还带着上次的底图。
     --probe     打印运行时状态：底图来源、data-bg、解析后的令牌值、
                 关键元素的实算背景色。
     --audit     把所有可见文字按计算颜色分组。深色文字压在深色玻璃上
                 是一屏几十处的问题，肉眼在截图里数不清。
     --bottom    截图前把内容区滚到底（设置页的「背景」卡片在折叠线以下）。
     --bare      只藏 UI 外壳，单独看背景层本身。
     --overlay0  把压暗层归零，判断底图是没上还是被后面几层吃掉了。
     --bg=名字   用 background 目录里已经落盘的图/视频当底图（按扩展名自动判断）。
                 **文件要放进本工具自己的 userData**，见下面那段说明。
     --demo      把存档恢复到演示初始态（第 8 天、5 张已打卡）。
                 --reset 则是清空重来。测试会把存档推得很远，不重置就没法互相比较。

   注意：不要用空字符串占位传 preset。PowerShell 调用原生程序时会
   把 '' 整个丢掉，参数随之左移 —— 已经因此白跑过一轮。

   注意：**这个工具的 userData 不是应用自己的那一份。**
   以 `electron dev/shot.js` 这种方式直接传文件启动时，Electron 不会去读
   package.json 的 productName，userData 因此落在 `%APPDATA%\Electron`，
   而不是应用真正的 `%APPDATA%\Cijian`。
   对底图记忆（localStorage）来说这是好事 —— `--clean` 不会误删用户的设置；
   但**要测用户上传的图/视频，文件得放进 `%APPDATA%\Electron\background\`**，
   放错地方会看到 net::ERR_UNEXPECTED 和视频的 MEDIA_ELEMENT_ERROR，
   白白怀疑产品坏了。`--probe` 会把实际 userData 与 background 目录打出来。
   ============================================================ */
'use strict';

const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');

/* 注册 bg:// —— 和 main.js 用的是同一份实现。
   不注册的话截图工具里 bg:// 是无人处理的 scheme：
   图片/视频底图一律加载失败，量到 hasBackground:false、
   视频报 MEDIA_ELEMENT_ERROR，看上去像产品坏了。
   注册必须在 app ready 之前。 */
const bgProtocol = require('../bg-protocol');
bgProtocol.registerScheme();

/* --foo 是开关，其余按位置取。这样加开关不会挤掉 preset。 */
const ARGV = process.argv.slice(2);
const FLAGS = ARGV.filter((a) => a.startsWith('--'));
const POS = ARGV.filter((a) => !a.startsWith('--'));
const has = (f) => FLAGS.includes('--' + f);

const ROUTE  = POS[0] || 'home';
const MODE   = POS[1] || 'light';
const NAME   = POS[2] || ('shot-' + ROUTE + '-' + MODE);
const PRESET = POS[3] || '';
const OUT_DIR = process.env.CJ_SHOT_DIR || 'D:\\legion\\Documents\\harness';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 硬性兜底：无论如何 90 秒内必须退出。
   挂起的进程留在那里会让后续每一次运行都踩到，比截不到图更麻烦。 */
const bail = setTimeout(() => {
  console.log('SHOT timeout — 强制退出');
  app.exit(2);
}, 90000);

app.whenReady().then(async () => {
  bgProtocol.registerHandler();

  const win = new BrowserWindow({
    width: 1440, height: 900, show: true, frame: false, transparent: true,
    backgroundColor: '#00000000',
    /* --noshadow：关掉系统投影。
       Windows 的窗口投影是围着**矩形**窗口画的，不会跟着 CSS 圆角走 ——
       透明窗口 + CSS 圆角这个组合下，它会在四条边和四个角外侧留下一圈
       深色残留，看上去就是「边上有线、角是方的」。
       .app 自己已经有一层跟着圆角走的 CSS 投影，所以关掉系统投影不丢东西。 */
    hasShadow: !has('noshadow'),
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, sandbox: false,
    },
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await wait(4000);

  /* --clean：把上次留下的底图记忆清掉再重载。
     背景是持久化的（localStorage + userData 里的文件），
     不清就会一直沿用上一次 setPreset 的结果 ——
     于是"不传预设"的那一组对照图其实还是带着底图的，白白骗自己一轮。 */
  if (has('clean')) {
    await win.webContents.executeJavaScript(
      `try { localStorage.removeItem('cijian.background.v1'); } catch (e) {} 'ok'`);
    win.webContents.reload();
    await wait(4500);
  }

  /* --demo / --reset：把存档恢复到演示初始态（第 8 天、5 张已打卡）或清空。
     测试会把存档推得很远（比如一路走到第 3 轮第 15 天），
     不重置的话每张截图的日期、进度、甚至首页形态都不一样，没法互相比较。 */
  if (has('demo') || has('reset')) {
    await win.webContents.executeJavaScript(
      `window.CJ.Store.reset(${has('demo') ? 'true' : 'false'}); window.Router.applyTheme(); 'ok'`);
    await wait(800);
  }

  // 背景底图（可选）
  const videoFlag = FLAGS.find((f) => f.startsWith('--bg='));
  if (videoFlag) {
    // 视频底图走的是另一条路径：每帧重传纹理、逐帧重算底色均值
    const vname = videoFlag.slice('--bg='.length);
    await win.webContents.executeJavaScript(
      `window.Router.background && window.Router.background.setFile(${JSON.stringify(vname)}); 'ok'`);
    await wait(3000);
  } else if (PRESET) {
    await win.webContents.executeJavaScript(
      `window.Router.background && window.Router.background.setPreset(${JSON.stringify(PRESET)}); 'ok'`);
    await wait(1500);
  }

  // 外观 + 路由
  await win.webContents.executeJavaScript(
    `window.CJ.Store.state.settings.mode = ${JSON.stringify(MODE)}; "ok"`);
  await wait(250);
  await win.webContents.executeJavaScript(
    `window.Router.applyMode(); window.Router.go(${JSON.stringify(ROUTE)}); "ok"`);

  // 等动画走完再截，否则会拍到半透明的中间态
  await wait(ROUTE === 'review' ? 5200 : 3200);

  /* 协议自检：从主进程直接打一次 bg://，别从页面里打 ——
     页面的 fetch 受 connect-src 'none' 限制，永远是 "Failed to fetch"，
     拿它当证据会得出完全错误的结论。 */
  if (has('probe')) {
    const { net } = require('electron');
    const dir = bgProtocol.bgDir();
    const probeName = videoFlag ? videoFlag.slice('--bg='.length) : null;
    console.log('USERDATA ' + app.getPath('userData'));
    console.log('BGDIR    ' + dir + ' exists=' + fs.existsSync(dir) +
      ' files=' + (fs.existsSync(dir) ? fs.readdirSync(dir).join(',') : '-'));
    if (probeName) {
      const resolved = bgProtocol.resolveBgPath(probeName);
      console.log('RESOLVE  ' + resolved);
      try {
        const r = await net.fetch('bg://local/' + encodeURIComponent(probeName),
          { headers: { Range: 'bytes=0-1023' } });
        console.log('BG_FETCH status=' + r.status +
          ' range=' + (r.headers.get('content-range') || '-') +
          ' len=' + (r.headers.get('content-length') || '-') +
          ' ct=' + (r.headers.get('content-type') || '-'));
      } catch (e) {
        console.log('BG_FETCH THREW ' + ((e && e.message) || e));
      }
    }
  }

  if (has('probe')) {
    /* 视频底图加载失败时 onerror 只把 el 清空，错误对象被丢掉了 ——
       现场只剩一个 hasBackground:false，看不出是协议、CSP 还是解码的问题。
       这里单独再拉一次同一个 URL，把真正的失败原因取出来。 */
    const vidDiag = await win.webContents.executeJavaScript(`(async () => {
      const bg = window.Router.background;
      const cur = bg && bg.current();
      if (!cur || cur.type !== 'video' || !cur.url) return null;
      const out = { url: cur.url };
      /* 决定性判断：Electron 预编译版默认不带 H.264/AAC 这些专有编解码器，
         而 .mp4 恰恰是用户最常传的格式。问 canPlayType 比看错误码直接。 */
      const v0 = document.createElement('video');
      out.codecs = {
        h264: v0.canPlayType('video/mp4; codecs="avc1.42E01E"') || '(no)',
        mp4generic: v0.canPlayType('video/mp4') || '(no)',
        vp8: v0.canPlayType('video/webm; codecs="vp8"') || '(no)',
        vp9: v0.canPlayType('video/webm; codecs="vp9"') || '(no)',
      };
      try {
        const r = await fetch(cur.url, { headers: { Range: 'bytes=0-1023' } });
        out.fetch = r.status + ' ' + (r.headers.get('content-range') || r.headers.get('content-length') || '?') +
          ' ct=' + (r.headers.get('content-type') || '?');
      } catch (e) { out.fetch = 'THREW ' + ((e && e.message) || e); }
      out.videoErr = await new Promise((res) => {
        const v = document.createElement('video');
        v.muted = true;
        v.onloadeddata = () => res('ok ' + v.videoWidth + 'x' + v.videoHeight);
        v.onerror = () => {
          const e = v.error;
          res('error code=' + (e && e.code) + ' msg=' + (e && e.message));
        };
        setTimeout(() => res('timeout ns=' + v.networkState + ' rs=' + v.readyState), 6000);
        v.src = cur.url;
        v.load();
      });
      return JSON.stringify(out); })()`);
    if (vidDiag) console.log('VIDDIAG', vidDiag);

    const probe = await win.webContents.executeJavaScript(`(() => {
      const bg = window.Router.background;
      const o = window.Router.optics;
      const root = getComputedStyle(document.documentElement);
      const bgc = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return sel + ': none';
        const cs = getComputedStyle(el);
        return sel + ': ' + cs.backgroundColor + ' | color ' + cs.color;
      };
      return JSON.stringify({
        hasModule: !!bg,
        current: bg ? bg.current() : null,
        dataBg: document.documentElement.dataset.bg || '(none)',
        dataMode: document.documentElement.dataset.mode || '(none)',
        opticsMode: document.documentElement.dataset.optics,
        hasBackground: o && o.hasBackground,
        backgroundReady: o && o.backgroundReady,
        uploadError: o && o.backgroundUploadError,
        tokens: {
          surface: root.getPropertyValue('--surface').trim(),
          surfaceSolid: root.getPropertyValue('--surface-solid').trim(),
          themeText: root.getPropertyValue('--theme-text').trim(),
          textFaint: root.getPropertyValue('--text-faint').trim(),
        },
        keyEls: [bgc('.rail'), bgc('.rail-card'), bgc('.rail__foot'), bgc('.card')],
      }); })()`);
    console.log('PROBE', probe);
  }

  /* 文字对比度审计：把所有「有直接文字」的元素按计算颜色分组。
     深色文字压在深色玻璃上是这次底图上线后最要命的问题，
     肉眼在一张截图里数不清有多少处，让页面自己报。 */
  if (has('audit')) {
    const audit = await win.webContents.executeJavaScript(`(() => {
      const seen = new Map();
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
      };
      document.querySelectorAll('.app *').forEach((el) => {
        if (el.children.length) return;
        const t = (el.textContent || '').trim();
        if (!t || t.length < 2 || !vis(el)) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.opacity === '0') return;
        const key = cs.color;
        if (!seen.has(key)) seen.set(key, { color: key, n: 0, sample: t.slice(0, 16), cls: el.className || el.tagName });
        seen.get(key).n++;
      });
      return JSON.stringify([...seen.values()].sort((a, b) => b.n - a.n)); })()`);
    console.log('AUDIT', audit);
  }

  /* 诊断用：看「背景层本身」长什么样。
     底图要穿过 压暗层 → 玻璃 → 暗色令牌 三层才到眼睛，
     不从中间切一刀就分不清是底图没上，还是被后面几层吃掉了。 */
  if (has('overlay0')) {
    await win.webContents.executeJavaScript(
      `window.Router.optics && window.Router.optics.setOverlay && window.Router.optics.setOverlay(0); 'ok'`);
    await wait(600);
  }
  if (has('bare')) {
    // 只藏 UI 外壳，背景层是独立的 WebGL 画布，不受影响
    await win.webContents.executeJavaScript(
      `document.querySelector('.app').style.visibility = 'hidden'; 'ok'`);
    await wait(900);
  }

  /* 可选：截图前把内容区滚到底。
     设置页的「背景」卡片在折叠线以下，不滚就截不到。 */
  if (has('bottom')) {
    const scrollInfo = await win.webContents.executeJavaScript(`(() => {
      // .view 才是滚动容器（height:100% + overflow-y:auto）；
      // .stage 是 overflow:hidden 的外框，它永远 scrollHeight === clientHeight。
      const host = document.querySelector('.view');
      if (!host) return 'no-host';
      host.scrollTop = host.scrollHeight;
      return JSON.stringify({
        scrollTop: host.scrollTop,
        scrollHeight: host.scrollHeight,
        clientHeight: host.clientHeight,
        cards: [...document.querySelectorAll('.view .card, .view section')]
          .map(n => (n.querySelector('h2,h3,.card-title,.sec-title') || n).textContent.trim().slice(0, 12)),
      }); })()`);
    console.log('SCROLLDBG', scrollInfo);
    await wait(1200);
  }

  /* 悬浮层是这次改版的重点之一，但它们在截图里默认不会出现 ——
     必须主动打开。取值自带在开关里（--modal=3），
     不要走位置参数：位置参数已经被 preset 占着，
     少传一个 preset 就会整体左移，天数静默变成别的值。 */
  const modalFlag = FLAGS.find((f) => f === '--modal' || f.startsWith('--modal='));
  if (modalFlag) {
    const n = parseInt(modalFlag.split('=')[1] || '3', 10) || 3;
    await win.webContents.executeJavaScript(`window.Router.openDay(${n}); 'ok'`);
    await wait(1400);
  }
  if (has('toast')) {
    await win.webContents.executeJavaScript(
      `window.UI.toast('底图换好了，这是悬浮层的样子', '🖼'); 'ok'`);
    await wait(700);
  }

  // 抬到最前，确保抓屏抓到的是它
  win.moveTop();
  win.focus();
  await wait(900);

  const disp = screen.getPrimaryDisplay();
  const b = win.getBounds();                    // DIP，与缩略图同一坐标系

  let img = null;
  for (let attempt = 1; attempt <= 3 && !img; attempt++) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: disp.size.width, height: disp.size.height },
      });
      if (sources && sources.length) img = sources[0].thumbnail;
    } catch (e) {
      console.log('SHOT desktopCapturer 第 ' + attempt + ' 次失败: ' + (e && e.message));
    }
    if (!img) await wait(700);
  }
  if (!img) { console.log('SHOT 抓屏失败'); app.exit(3); return; }

  // 按窗口矩形裁切。
  // 注意：screen.getPrimaryDisplay().size 返回的是 **DIP**，而 desktopCapturer
  // 的缩略图也是按请求的 DIP 尺寸给的 —— 两者同一坐标系，所以这里只能按
  // 「缩略图实际宽度 / DIP 宽度」这一个比例换算，**不能再乘 scaleFactor**。
  // 先前多乘了一次，窗口 1440×900 只截出 1507×978（还被边界夹断）。
  const sz = img.getSize();
  const k = sz.width / disp.size.width;
  /* --margin=N：把窗口外围 N 个 DIP 也拍进来。
     默认只裁窗口矩形，于是窗口**外面**的东西全被裁掉 ——
     而窗口投影、圆角外侧的残留正好都在外面，
     查「边上有条线 / 角是方的」这类问题时，默认裁法根本看不到证据。 */
  const marginFlag = FLAGS.find((f) => f.startsWith('--margin='));
  const m = marginFlag ? (parseInt(marginFlag.split('=')[1], 10) || 0) : 0;
  const rect = {
    x: Math.max(0, Math.round((b.x - m) * k)),
    y: Math.max(0, Math.round((b.y - m) * k)),
    width: Math.round((b.width + m * 2) * k),
    height: Math.round((b.height + m * 2) * k),
  };
  rect.width = Math.min(rect.width, sz.width - rect.x);
  rect.height = Math.min(rect.height, sz.height - rect.y);

  let out = img;
  if (rect.width > 0 && rect.height > 0) out = img.crop(rect);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const png = path.join(OUT_DIR, NAME + '.png');
  const jpg = path.join(OUT_DIR, NAME + '.jpg');
  fs.writeFileSync(png, out.toPNG());
  fs.writeFileSync(jpg, out.toJPEG(90));

  console.log('SHOT ' + NAME + '  ' + out.getSize().width + 'x' + out.getSize().height +
    '  jpg ' + (fs.statSync(jpg).size / 1024).toFixed(0) + ' KB');
  clearTimeout(bail);
  app.exit(0);
});
