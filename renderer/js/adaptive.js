/* ============================================================
   此间 · 面板外文字的自适应取色

   为什么要有这一层
   ----------------
   「把背景压暗好让白字看得见」是错的：代价是整屏蒙上一层灰，
   用户原话是「特别暗，特别脏，像盖了一层深灰色滤镜」。
   正确的做法反过来 —— **背景保持原样，文字自己换色**：
   压在深色上的用白字，压在浅色上的用棕黑字。

   做法（与范例 cijian-v15-demo.html 第 2 节同一套）
   ------------------------------------------------
   1. 把底图缩到 48px 宽当亮度图（一次 drawImage，很便宜）；
   2. 文字每次定位时采样它**下方 3x3 格**的平均亮度 ——
      比单点稳得多，不会因为文字正好压在一根细线上就整行翻色；
   3. 低于阈值给白字、高于给棕黑字，120ms 过渡。

   只管**不在板块上的**文字。板块上的文字有玻璃做背衬，
   那一档的规则由令牌决定（极光用棕黑、照片一律白字），
   两套规则各管一段，不重叠也不打架。

   它同时是「去掉那层灰」的前提：只有文字能自己换色，
   背景才敢保持原样。
   ============================================================ */
(function (global) {
  'use strict';

  const SAMPLE_W = 48;          // 亮度图宽度（约 48px，够稳也够便宜）
  const THRESHOLD = 0.52;       // 高于它算「浅底」→ 棕黑字
  const DARK_INK = 'rgb(42, 35, 32)';
  const LIGHT_INK = 'rgb(255, 253, 250)';

  /* 板块：这些里面（含自身）的文字都交给令牌，不由本模块改色 */
  const PANEL_SEL = [
    '.rail', '.titlebar', '.card', '.panel', '.hero', '.review-hero',
    '.stat', '.summary', '.trace', '.ring-block', '.modal', '.toast',
    '.write-block', '.print-stage', '.rail-card', '.polaroid', '.cell',
    '.shot', '.badge', '.seg', '.btn', '.theme-opt', '.bg-chip', '.switch',
    '.modal__quote', '.scrim', '.reveal',
  ].join(',');

  let lum = null, lw = 0, lh = 0, srcW = 1, srcH = 1;
  let pending = false;
  const touched = new Set();

  /** 亮度图：优先用真底图；没有底图就用极光的底色令牌铺一张 */
  function buildMap() {
    const canvas = document.createElement('canvas');
    const cx = canvas.getContext('2d', { willReadFrequently: true });
    const layer = global.Router && global.Router.background;
    const el = layer && layer.element;
    const W = (global.innerWidth || 1) / 1, H = (global.innerHeight || 1) / 1;
    lw = SAMPLE_W;
    lh = Math.max(1, Math.round(SAMPLE_W * H / Math.max(W, 1)));
    canvas.width = lw; canvas.height = lh;
    srcW = W; srcH = H;

    if (el) {
      /* 底图走 cover 映射，与 CSS object-fit: cover 一致 ——
         不一致的话采样点会整体偏移，亮暗判断就错了位。 */
      const ew = el.videoWidth || el.naturalWidth || el.width || 0;
      const eh = el.videoHeight || el.naturalHeight || el.height || 0;
      if (!ew || !eh) return false;
      const s = Math.max(W / ew, H / eh);
      const dw = ew * s, dh = eh * s;
      try {
        cx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh, 0, 0, lw, lh);
      } catch (e) {
        return false;   // 跨域源读不了：保持上一次的图
      }
    } else {
      /* 极光：用 --bg 令牌铺一层纯色。
         极光是渐变的，但它的明暗在整屏尺度上变化很缓，
         用底色当近似足够决定「白字还是棕黑字」——
         而且这一档本来就有令牌兜底（第三节：极光用棕黑字）。 */
      const root = getComputedStyle(document.documentElement);
      cx.fillStyle = root.getPropertyValue('--bg').trim() || '#e6dbca';
      cx.fillRect(0, 0, lw, lh);
    }

    try {
      lum = cx.getImageData(0, 0, lw, lh).data;
    } catch (e) {
      lum = null;
      return false;
    }
    return true;
  }

  /** 采样 (u,v) 归一化位置周围 3x3 格的平均亮度 */
  function brightnessAt(u, v) {
    if (!lum) return 0.5;
    const cx = Math.max(0, Math.min(lw - 1, Math.round(u * lw)));
    const cy = Math.max(0, Math.min(lh - 1, Math.round(v * lh)));
    let sum = 0, n = 0;
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const i = ((Math.max(0, Math.min(lh - 1, y)) * lw) + Math.max(0, Math.min(lw - 1, x))) * 4;
        sum += 0.2126 * lum[i] + 0.7152 * lum[i + 1] + 0.0722 * lum[i + 2];
        n++;
      }
    }
    return sum / n / 255;
  }

  function onPanel(el) {
    return !!(el.closest && el.closest(PANEL_SEL));
  }

  /** 页面里所有「有直接文字 + 不在板块上」的元素 */
  function targets() {
    const out = [];
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight &&
        r.right > 0 && r.left < innerWidth;
    };
    document.querySelectorAll('.app *, .toasts *').forEach((el) => {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (!t || t.length < 2 || !vis(el)) return;
      if (onPanel(el)) return;
      out.push(el);
    });
    return out;
  }

  function apply() {
    pending = false;
    if (!buildMap()) return;
    /* 每次重算都重建 touched：视图换页会把旧节点整个丢掉，
       只往里加的话这个集合会随着换页一路涨（每次 render 加一批死节点）。 */
    touched.clear();
    targets().forEach((el) => {
      const r = el.getBoundingClientRect();
      /* 采样点取文字**下方**那一小块的中心：文字自己的笔画不参与，
         采到的是它真正压着的背景。 */
      const u = (r.left + r.width / 2) / srcW;
      const v = Math.min(1, (r.bottom + 4) / srcH);
      const light = brightnessAt(u, v) > THRESHOLD;
      const col = light ? DARK_INK : LIGHT_INK;
      el.style.transition = 'color 120ms var(--e-out, ease)';
      el.style.color = col;
      el.style.textShadow = light ? 'none' : '0 1px 3px rgba(0,0,0,0.45)';
      touched.add(el);
    });
  }

  function schedule() {
    if (pending) return;
    pending = true;
    global.requestAnimationFrame(apply);
  }

  function clear() {
    touched.forEach((el) => {
      el.style.color = '';
      el.style.textShadow = '';
      el.style.transition = '';
    });
    touched.clear();
  }

  function init() {
    global.addEventListener('resize', schedule, { passive: true });
    // 视图滚起来之后文字压到的背景会变，所以要跟着重算（节流到一帧一次）
    document.addEventListener('scroll', schedule, { passive: true, capture: true });
    if (global.MutationObserver) {
      new MutationObserver(schedule).observe(document.body, {
        childList: true, subtree: true,
      });
    }
    schedule();
  }

  global.Adaptive = {
    init, schedule, clear, brightnessAt, threshold: THRESHOLD,
    /** 自检用：这一轮按底下明暗改过色的文字有哪些（肉眼在截图里数不清） */
    get debug() {
      const out = { map: lum ? lw + 'x' + lh : 'none', dark: 0, light: 0, sample: [] };
      touched.forEach((el) => {
        if (el.style.color === DARK_INK) out.dark++; else if (el.style.color === LIGHT_INK) out.light++;
        if (out.sample.length < 6) {
          out.sample.push((el.className || el.tagName) + '=' + (el.style.color === DARK_INK ? 'ink' : 'white') +
            ' «' + (el.textContent || '').trim().slice(0, 10) + '»');
        }
      });
      return out;
    },
  };
})(window);
