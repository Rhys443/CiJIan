/* ============================================================
   此间 · 凝光光效（Light）

   参考 ColorOS 17 的「凝光视效」思路，而不是照搬液态玻璃：
   材质不是来抢戏的，是用来托底的 —— 通透干净，但不耽误看清。

   四点实现约定（来自对那套光效的拆解）：
   1. 分层光影按固定顺序叠加：
      顶部锋利高光 → 底部柔性反射光 → 颜色微微散射到背景 → 底部柔和阴影
   2. 高光**基于颜色提亮**，不是叠一层白。
      叠白会让暗色模式发灰，颜色提亮才能保持通透。
   3. 跟手的是「弥散光」：以光标为圆心的柔和径向光晕，
      照射范围**只限当前这个表面**，不越界到别的元素上。
   4. 另有「指引光」：状态变化时像涟漪荡开、前进时像彗星拖尾。

   本模块只负责给元素挂上这几层与跟手逻辑，具体样式在 css/light.css。
   ============================================================ */
(function (global) {
  'use strict';

  const { clamp } = global.UI;

  /** 需要挂光效的表面：显式标注的，外加主按钮（宝石般的折射光泽就靠这里） */
  const SELECTOR = '[data-light], .btn--primary';

  let attached = [];
  let raf = null;
  let pointer = { x: 0.5, y: 0.5, active: false };
  let reduceMotion = false;

  /* ---------------- 颜色管理 ----------------
     把主题色与光色以「字面量」写进 CSS 变量。
     不用 color-mix(var(--x)) 是因为要兼容性更稳；
     每次主题切换调用 syncColors() 刷新一次即可。 */
  function hexToRgbString(hex) {
    const v = String(hex).trim().replace('#', '');
    const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
    const n = parseInt(full, 16);
    if (Number.isNaN(n) || full.length !== 6) return '212 101 63';
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  }

  function syncColors() {
    const cs = getComputedStyle(document.documentElement);
    const themeVar = cs.getPropertyValue('--theme').trim();
    // --theme 是 hex，直接读；拿不到就退回陶土橘
    const rgb = themeVar.startsWith('#') ? hexToRgbString(themeVar) : '212 101 63';
    document.documentElement.style.setProperty('--light-theme', rgb);
    // 光色比主题色更暖更亮一点，才像「光」而不是「色块」
    const [r, g, b] = rgb.split(' ').map(Number);
    const warm = [
      Math.min(255, Math.round(r * 1.06 + 14)),
      Math.min(255, Math.round(g * 1.03 + 10)),
      Math.min(255, Math.round(b * 0.98 + 6)),
    ].join(' ');
    document.documentElement.style.setProperty('--light-glow', warm);
  }

  /* ---------------- 单个表面的跟手 ----------------
     直接用指针事件（而不是在容器上统一算），
     这样「照射范围只限当前表面」这条才自然成立。 */

  /**
   * 判断这个表面是不是「玻璃」（自带 backdrop-filter）。
   *
   * 为什么不给玻璃加跟手光晕：MDN 明确说 mix-blend-mode 不是 normal 的元素
   * 会成为 backdrop root，会把它自己的 backdrop-filter 截断 ——
   * 也就是说在玻璃上叠一层 plus-lighter 的光晕，会让玻璃的模糊失效。
   * 而且 Apple 的规范也是「克制使用，只给最重要的功能元素」，
   * 所以玻璃面板只保留四层静态光影，跟手光晕留给按钮这类小控件。
   */
  function isGlass(el) {
    const cs = getComputedStyle(el);
    const bd = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
    return bd !== 'none' && bd !== '';
  }

  function ensureLayers(el, allowGlow) {
    // 四层光影里，::before / ::after 已经在 CSS 里承担了顶部高光与底部反射光，
    // 跟手弥散光需要真实子元素，这里补上。
    const existing = el.querySelector(':scope > .light-glow');
    if (allowGlow && !existing) {
      const glow = document.createElement('i');
      glow.className = 'light-glow';
      el.insertBefore(glow, el.firstChild);
    } else if (!allowGlow && existing) {
      existing.remove();
    }
  }

  function bindSurface(el) {
    let rafId = null;
    let tx = 0.5;
    let ty = 0.5;
    let cx = 0.5;
    let cy = 0.5;
    let hot = 0; // 0..1，光晕强度
    let targetHot = 0;
    let rect = null; // 缓存尺寸：pointermove 里调 getBoundingClientRect 会强制 layout

    function remeasure() {
      rect = el.getBoundingClientRect();
      el.style.setProperty('--lw', `${Math.round(rect.width)}px`);
      el.style.setProperty('--lh', `${Math.round(rect.height)}px`);
      const glow = el.querySelector(':scope > .light-glow');
      if (glow) {
        /* 光斑必须是**正圆**，所以只取一个直径。
           原来是按元素宽高各给一次，于是「圆」被拉成元素的形状：
           侧栏是 260×1200 的窄长条，光晕就被拉成一根竖条，
           看上去是一条线性光带，而不是一团扩散开的圆光。
           直径取对角线量级，再夹到合理区间 —— 小按钮也能有一团完整的圆。 */
        const d = Math.max(200, Math.min(620, Math.hypot(rect.width, rect.height) * 0.62));
        const half = Math.round(d / 2);
        glow.style.width = `${Math.round(d)}px`;
        glow.style.height = `${Math.round(d)}px`;
        glow.style.marginLeft = `${-half}px`;
        glow.style.marginTop = `${-half}px`;
      }
    }

    function apply() {
      cx += (tx - cx) * 0.22;
      cy += (ty - cy) * 0.22;
      hot += (targetHot - hot) * 0.16;
      el.style.setProperty('--lhot', hot.toFixed(3));
      // 跟手光晕只改 transform（合成器上跑），不改渐变的圆心（那会每帧重绘）
      const glow = el.querySelector(':scope > .light-glow');
      if (glow && rect) {
        const x = cx * rect.width;
        const y = cy * rect.height;
        glow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001 || Math.abs(targetHot - hot) > 0.002) {
        rafId = requestAnimationFrame(apply);
      } else {
        rafId = null;
      }
    }

    function kick() {
      if (rafId === null) rafId = requestAnimationFrame(apply);
    }

    function onEnter(e) {
      remeasure();
      // 进入时直接落到指针位置，不要从上一个位置飞过来
      if (e && rect) {
        tx = clamp((e.clientX - rect.left) / (rect.width || 1), 0, 1);
        ty = clamp((e.clientY - rect.top) / (rect.height || 1), 0, 1);
        cx = tx;
        cy = ty;
      }
      targetHot = 1;
      kick();
    }

    function onMove(e) {
      if (!rect) remeasure();
      if (!rect || !rect.width || !rect.height) return;
      tx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      ty = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      targetHot = 1;
      kick();
    }

    function onLeave() {
      targetHot = 0;
      kick();
    }

    /** 点按：在按下的位置打一圈涟漪（指引光的一种） */
    function onDown(e) {
      if (reduceMotion) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = clamp((e.clientX - r.left) / r.width, 0, 1);
      const y = clamp((e.clientY - r.top) / r.height, 0, 1);
      const ripple = document.createElement('i');
      ripple.className = 'light-ripple';
      ripple.style.setProperty('--rx', `${(x * 100).toFixed(2)}%`);
      ripple.style.setProperty('--ry', `${(y * 100).toFixed(2)}%`);
      const size = Math.max(r.width, r.height) * 2.1;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 780);
    }

    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    el.addEventListener('pointerdown', onDown, { passive: true });

    // 尺寸变化后重新量一次，否则光斑会停留在旧位置
    let ro = null;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(() => remeasure());
      ro.observe(el);
    }

    return {
      el,
      remeasure,
      detach() {
        el.removeEventListener('pointerenter', onEnter);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
        el.removeEventListener('pointerdown', onDown);
        if (ro) ro.disconnect();
        if (rafId) cancelAnimationFrame(rafId);
      },
    };
  }

  /* ---------------- 全局指针位置 ----------------
     给「光斑跟随鼠标的视差」用（背景层、侧栏等大面积表面） */
  function onPointerMove(e) {
    pointer.x = clamp(e.clientX / (window.innerWidth || 1), 0, 1);
    pointer.y = clamp(e.clientY / (window.innerHeight || 1), 0, 1);
    pointer.active = true;
    if (raf === null) raf = requestAnimationFrame(paint);
  }

  function paint() {
    const root = document.documentElement;
    root.style.setProperty('--mx', `${(pointer.x * 100).toFixed(2)}%`);
    root.style.setProperty('--my', `${(pointer.y * 100).toFixed(2)}%`);
    // -1..1，供 CSS 做位移视差
    root.style.setProperty('--mxn', ((pointer.x - 0.5) * 2).toFixed(3));
    root.style.setProperty('--myn', ((pointer.y - 0.5) * 2).toFixed(3));
    raf = null;
  }

  /* ---------------- 对外接口 ---------------- */
  const Light = {
    /** 扫描（或重新扫描）页面里所有 data-light 表面 */
    init(root = document) {
      reduceMotion =
        document.documentElement.dataset.reduceMotion === 'on' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.detachAll();
      syncColors();
      Array.from(root.querySelectorAll(SELECTOR)).forEach((el) => {
        el.classList.add('has-light');
        // 玻璃表面（自带 backdrop-filter）只拿静态四层光影；
        // 非玻璃表面才补跟手光晕，避免把玻璃的模糊截断。
        const glass = isGlass(el);
        el.classList.toggle('is-glass', glass);
        ensureLayers(el, !glass);
        attached.push(bindSurface(el));
      });
      if (!reduceMotion) window.addEventListener('pointermove', onPointerMove, { passive: true });
      paint();
    },
    detachAll() {
      attached.forEach((a) => a.detach());
      attached = [];
      window.removeEventListener('pointermove', onPointerMove);
    },
    syncColors,
    /** 手动在某个坐标触发一次涟漪（例如状态变化提醒） */
    rippleAt(el, xRatio = 0.5, yRatio = 0.5) {
      if (!el || reduceMotion) return;
      const r = el.getBoundingClientRect();
      const ripple = document.createElement('i');
      ripple.className = 'light-ripple';
      ripple.style.setProperty('--rx', `${(xRatio * 100).toFixed(2)}%`);
      ripple.style.setProperty('--ry', `${(yRatio * 100).toFixed(2)}%`);
      const size = Math.max(r.width, r.height) * 2.1;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      el.appendChild(ripple);
      setTimeout(() => ripple.remove(), 780);
    },
  };

  global.Light = Light;
})(window);
