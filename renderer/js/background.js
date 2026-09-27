/* ============================================================
   此间 · 背景层（照片 / 视频）

   规格里 L0 是「用户自选风景/抽象图」，L1 是压暗层。
   这里负责 L0：管住背景的来源、加载、持久化和兜底。

   三个决定：

   1. **预设底图程序化绘制，不放图片文件。**
      三张预设各是一张 1600×1000 的 canvas。好处是不占仓库体积、
      不依赖网络、永远加载成功；坏处是它们不如真照片细腻 —— 所以
      预设只是「开箱即用」的兜底，真正好看的是用户自己传的图。

   2. **上传的图/视频落盘，不进 localStorage。**
      一张手机照片 3～8 MB，视频更大，塞 localStorage 必然爆配额，
      而且爆了会连带把打卡数据一起写失败 —— 那才是真的数据事故。
      所以文件由主进程复制到 userData/background/，渲染进程只存文件名。

   3. **用自定义协议 bg:// 读，不用 file://。**
      file:// 页面读别的本地文件在 Chromium 里默认受限，
      自定义协议既绕开这个限制，也能在主进程里挡住目录穿越。
   ============================================================ */
(function (global) {
  'use strict';

  const KEY = 'cijian.background.v1';

  /* ---------- 预设底图：程序化绘制 ---------- */
  const PALETTES = {
    dusk: {
      name: '黄昏',
      sky: ['#1B2C4A', '#3E5C82', '#7C8FA8', '#D9A277', '#F3C489', '#FFD9A0'],
      sun: [0.665, 0.86, '255,246,222', '255,168,112'],
      ridges: ['rgba(96,116,140,0.88)', 'rgba(58,74,98,0.94)', 'rgba(28,38,54,0.98)'],
      water: ['#43536B', '#2C3B50', '#141D2B'],
      warm: 1,
    },
    forest: {
      name: '林间',
      sky: ['#1E2A24', '#2E4034', '#4A6350', '#7E9472', '#B9C79A', '#DCE3B8'],
      sun: [0.32, 0.62, '240,255,214', '170,200,140'],
      ridges: ['rgba(74,96,78,0.88)', 'rgba(46,62,50,0.94)', 'rgba(24,34,28,0.98)'],
      water: ['#33463A', '#22322A', '#121C17'],
      warm: 0.35,
    },
    night: {
      name: '夜色',
      sky: ['#080B16', '#111a30', '#1B2A4A', '#2B3D63', '#3E5480', '#5A6E96'],
      sun: [0.78, 0.52, '200,222,255', '110,150,220'],
      ridges: ['rgba(48,62,92,0.9)', 'rgba(30,40,62,0.95)', 'rgba(16,22,36,0.98)'],
      water: ['#1A2438', '#121A2A', '#080C14'],
      warm: 0.0,
    },
  };

  function paint(kind, W, H) {
    const P = PALETTES[kind] || PALETTES.dusk;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const HZ = H * 0.60;

    const sky = x.createLinearGradient(0, 0, 0, HZ);
    P.sky.forEach((col, i) => sky.addColorStop(i / (P.sky.length - 1), col));
    x.fillStyle = sky; x.fillRect(0, 0, W, HZ);

    const [sx, sy, inner, outer] = P.sun;
    const sun = x.createRadialGradient(W * sx, HZ * sy, 0, W * sx, HZ * sy, 470);
    sun.addColorStop(0, 'rgba(' + inner + ',0.98)');
    sun.addColorStop(0.12, 'rgba(' + outer + ',0.62)');
    sun.addColorStop(0.36, 'rgba(' + outer + ',0.22)');
    sun.addColorStop(1, 'rgba(' + outer + ',0)');
    x.fillStyle = sun; x.fillRect(0, 0, W, H);

    // 云带
    for (let i = 0; i < 34; i++) {
      const y = 40 + Math.random() * HZ * 0.86;
      const t = y / HZ;
      const w = 150 + Math.random() * 660, h = 7 + Math.random() * 24;
      const g = x.createLinearGradient(0, y, 0, y + h);
      const a = (0.05 + Math.random() * 0.15) * (0.45 + t);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(' + inner + ',' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.ellipse(Math.random() * W, y, w, h, 0, 0, Math.PI * 2); x.fill();
    }

    // 三层山脊
    P.ridges.forEach((fill, i) => {
      const baseY = HZ - 46 + i * 32;
      const amp = 40 - i * 10;
      // 每层用固定的种子，保证同一张预设每次生成都一致
      const seed = (i + 1) * 2.5 + kind.length;
      x.fillStyle = fill; x.beginPath(); x.moveTo(0, H);
      for (let px = 0; px <= W; px += 6) {
        const n = Math.sin(px * 0.0031 + seed) * amp
                + Math.sin(px * 0.0092 + seed * 2.3) * amp * 0.42
                + Math.sin(px * 0.0231 + seed * 4.1) * amp * 0.15;
        x.lineTo(px, baseY + n);
      }
      x.lineTo(W, H); x.closePath(); x.fill();
    });

    const water = x.createLinearGradient(0, HZ, 0, H);
    P.water.forEach((col, i) => water.addColorStop(i / (P.water.length - 1), col));
    x.fillStyle = water; x.fillRect(0, HZ, W, H - HZ);

    // 水面倒影
    for (let i = 0; i < 220; i++) {
      const y = HZ + 4 + Math.random() * (H - HZ) * 0.94;
      const t = 1 - (y - HZ) / (H - HZ);
      const w = 26 + Math.random() * 340 * t;
      x.fillStyle = 'rgba(' + inner + ',' + (0.012 + Math.random() * 0.07 * t).toFixed(3) + ')';
      x.fillRect(W * sx - w / 2 + (Math.random() - 0.5) * 110, y, w, 1 + Math.random() * 2.2);
    }

    // 颗粒
    const img = x.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 8;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(img, 0, 0);

    const vig = x.createRadialGradient(W / 2, H * 0.45, H * 0.34, W / 2, H * 0.45, H * 1.02);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.40)');
    x.fillStyle = vig; x.fillRect(0, 0, W, H);

    return c;
  }

  /* ---------- 模块 ---------- */
  function create(opts) {
    const o = opts || {};
    const optics = o.optics || null;
    const store = o.store || null;

    let cur = { type: 'none', id: '', url: '', name: '' };
    let el = null;               // 当前 Image / HTMLVideoElement / canvas
    let isVideo = false;
    const cache = {};            // 预设 canvas 缓存

    function presetCanvas(id) {
      if (!cache[id]) cache[id] = paint(id, 1600, 1000);
      return cache[id];
    }

    /* 把当前来源交给光学层、并同步 html 上的标记。
       data-bg="photo" 是整套配色迁移的开关：底图是深色照片时，
       原来的暖纸配色（深褐文字 + 米白面板）全部反过来变成白字 + 薄玻璃；
       没设底图时这个属性为空，程序化极光和暖纸的样子一点不动。
       这样"三套主题"各自原本的设计不会被这次改版吃掉。 */
    function apply() {
      const on = !!el;
      if (on) document.documentElement.dataset.bg = 'photo';
      else delete document.documentElement.dataset.bg;
      if (!optics) return;
      if (!el) { optics.clearBackground(); return; }
      optics.setBackground(el, isVideo);
    }

    /* 加载失败要把记忆一起清掉，不能只把 el 置空。
       否则界面退回极光了，设置页的芯片却一个都不选中
       （「极光」判的是 type==='none'，预设判的是 type==='preset'，
       而留下的是一个永远加载不出来的 image/video）—— 用户看到的是一个
       既不是极光也不是任何预设的"薛定谔底图"。 */
    function fail() {
      cur = { type: 'none', id: '', url: '', name: '' };
      el = null; isVideo = false;
      apply(); save();
    }

    function loadImage(url, onDone) {
      const im = new Image();
      /* crossOrigin 必须在 src **之前**设置，之后再设不生效。
         没有它，bg:// 相对 file:// 页面算跨源，图片是「被污染」的：
         WebGL 的 texImage2D 会抛 "contains cross-origin data"，
         纹理永远是空的 —— 画面全黑，而且每帧都抛。
         主进程那边 bg-protocol.js 同时开了 corsEnabled 和
         Access-Control-Allow-Origin，两边齐了资源才算 CORS 干净。 */
      im.crossOrigin = 'anonymous';
      im.onload = () => { el = im; isVideo = false; apply(); onDone && onDone(true); };
      im.onerror = () => { fail(); onDone && onDone(false); };
      im.src = url;
    }

    function loadVideo(url, onDone) {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';   // 同上，而且必须早于 src
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.onloadeddata = () => {
        el = v; isVideo = true; apply();
        const p = v.play();
        if (p && p.catch) p.catch(() => {});   // 自动播放被拒也不影响首帧
        onDone && onDone(true);
      };
      v.onerror = () => { fail(); onDone && onDone(false); };
      v.src = url;
    }

    const api = {
      /** 三张预设的元数据，供设置页渲染 */
      presets: Object.keys(PALETTES).map((id) => ({ id, name: PALETTES[id].name })),

      current() { return Object.assign({}, cur); },

      /** 用预设：直接把 canvas 交给光学层，零加载、零失败 */
      setPreset(id) {
        if (!PALETTES[id]) return false;
        cur = { type: 'preset', id, url: '', name: PALETTES[id].name };
        el = presetCanvas(id); isVideo = false; apply();
        save();
        return true;
      },

      /** 用主进程已经落盘的文件（bg:// 协议读） */
      setFile(name) {
        if (!name) return false;
        const url = 'bg://local/' + encodeURIComponent(name);
        const video = /\.(mp4|webm|mov|m4v|ogv)$/i.test(name);
        cur = { type: video ? 'video' : 'image', id: '', url, name };
        if (video) loadVideo(url, null); else loadImage(url, null);
        save();
        return true;
      },

      /** 退回程序化极光 */
      clear() {
        cur = { type: 'none', id: '', url: '', name: '' };
        el = null; isVideo = false; apply();
        save();
      },

      /** 从存档恢复。任何异常都退回极光，不让启动卡住。 */
      restore() {
        let raw = null;
        try { raw = global.localStorage.getItem(KEY); } catch (e) { return; }
        if (!raw) return;
        let s = null;
        try { s = JSON.parse(raw); } catch (e) { return; }
        if (!s || !s.type || s.type === 'none') return;
        if (s.type === 'preset') {
          /* 预设**不能**在启动路径上同步画。
             实测第一次画那张 1600×1000 的底图要 305ms（同进程第二次只要 17ms，
             贵的是大画布第一次走 GPU 光栅化），而 restore() 是在 boot() 里
             同步调的 —— 这 300ms 结结实实挡在第一帧前面，就是「开启速度有点缓慢」。
             改成先让界面用极光出来（零成本），等主线程空下来再画预设。
             用户感知到的启动时间因此只剩极光那一档。 */
          const idle = global.requestIdleCallback
            ? (fn) => global.requestIdleCallback(fn, { timeout: 1200 })
            : (fn) => global.setTimeout(fn, 320);
          idle(() => api.setPreset(s.id));
          return;
        }
        if (s.url) {
          cur = { type: s.type, id: '', url: s.url, name: s.name || '' };
          if (s.type === 'video') loadVideo(s.url, null); else loadImage(s.url, null);
        }
      },

      save,
      get element() { return el; },
      get isVideo() { return isVideo; },
    };

    function save() {
      try { global.localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {
        /* 配额满就放弃记忆背景 —— 绝不能连累打卡数据 */
      }
    }

    return api;
  }

  global.Background = { create, PALETTES };
})(window);
