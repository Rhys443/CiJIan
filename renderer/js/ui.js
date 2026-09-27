/* ============================================================
   此间 · 动效引擎（不依赖任何第三方库，纯手写）
   · $   ：选择器
   · h   ：hyperscript 建 DOM
   · icon：返回真实 SVG 元素
   · 其余：弹簧 / 补间 / 错峰 / 滚动揭示 / 磁吸 / 粒子 / 数字滚动
   ============================================================ */
(function (global) {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /**
   * 写行内样式。
   *
   * 必须区分普通属性和自定义属性：在 Electron 44 的 Chromium 上
   * `Object.assign(el.style, { '--angle': '24deg' })` 会**静默失败**，
   * 自定义属性根本进不了 CSSStyleDeclaration，也不报错。
   * 结果就是所有通过 style 对象传的 CSS 变量（--i / --tilt / --angle …）
   * 全部失效，而且很难从表象上看出来。
   */
  function setStyles(el, styles) {
    Object.keys(styles).forEach((key) => {
      const value = styles[key];
      if (value === null || value === undefined) return;
      if (key.startsWith('--')) el.style.setProperty(key, String(value));
      else el.style[key] = value;
    });
  }

  /** 建 DOM：h('div', {class:'x', onclick:fn}, child, '文本') */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
      Object.keys(props).forEach((key) => {
        const val = props[key];
        if (val === null || val === undefined || val === false) return;
        if (key === 'class') el.className = val;
        else if (key === 'html') el.innerHTML = val;
        else if (key === 'text') el.textContent = val;
        else if (key === 'style' && typeof val === 'object') setStyles(el, val);
        else if (key === 'dataset' && typeof val === 'object') Object.assign(el.dataset, val);
        else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2), val);
        else if (val === true) el.setAttribute(key, '');
        else el.setAttribute(key, val);
      });
    } else if (props !== undefined && props !== null) {
      children.unshift(props);
    }
    const push = (child) => {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) child.forEach(push);
      else el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    };
    children.forEach(push);
    return el;
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const nextFrame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- 缓动 ---------------- */
  const ease = {
    out: (t) => 1 - Math.pow(1 - t, 3),
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    back: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
  };

  /** 补间：await tween(600, t => el.style.opacity = t) */
  function tween(duration, onUpdate, easing = ease.out) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = clamp((now - t0) / duration, 0, 1);
        onUpdate(easing(t), t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** 弹簧：对一组属性做物理感过渡（用于磁吸、跟随、惯性） */
  function spring(opts) {
    const cfg = Object.assign({ stiffness: 170, damping: 20, mass: 1, precision: 0.01 }, opts);
    let vel = cfg.velocity || 0;
    let value = cfg.from || 0;
    let target = cfg.to || 0;
    let raf = null;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const force = -cfg.stiffness * (value - target);
      const damping = -cfg.damping * vel;
      vel += ((force + damping) / cfg.mass) * dt;
      value += vel * dt;
      if (cfg.onUpdate) cfg.onUpdate(value, vel);
      if (Math.abs(vel) > cfg.precision || Math.abs(value - target) > cfg.precision) {
        raf = requestAnimationFrame(tick);
      } else {
        value = target;
        if (cfg.onUpdate) cfg.onUpdate(value, 0);
        if (cfg.onComplete) cfg.onComplete();
      }
    };
    raf = requestAnimationFrame(tick);
    return {
      stop() {
        if (raf) cancelAnimationFrame(raf);
      },
      to(v) {
        target = v;
        last = performance.now();
        if (!raf) raf = requestAnimationFrame(tick);
      },
      set(v) {
        value = v;
        target = v;
        vel = 0;
        if (cfg.onUpdate) cfg.onUpdate(value, 0);
      },
    };
  }

  /**
   * 错峰：把「第几个元素」写进 --i，配合 CSS 的
   * animation-delay: calc(var(--i) * var(--stagger-step)) 使用。
   *
   * 注意：这里写入的必须是**序号**而不是毫秒。
   * 早期版本传的是毫秒，而 CSS 又乘了一次步长，延迟被算成 4900ms 这种量级，
   * 表现出来就是「入场慢得离谱」。步长只在 CSS 里定义一次（--stagger-step）。
   */
  function stagger(nodes) {
    Array.from(nodes).forEach((node, i) => {
      node.style.setProperty('--i', String(i));
    });
  }

  /** 滚动揭示：元素进入视口时加 .is-in */
  let io = null;
  function reveal(root = document) {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal', root).forEach((el) => el.classList.add('is-in'));
      return;
    }
    if (!io) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-in');
              io.unobserve(entry.target);
            }
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
      );
    }
    $$('.reveal', root).forEach((el) => {
      if (!el.classList.contains('is-in')) io.observe(el);
    });
  }

  /** 磁吸按钮：鼠标靠近时轻微跟随 */
  function magnetize(el, strength = 0.22, max = 9) {
    if (!el) return () => {};
    let raf = null;
    const onMove = (event) => {
      const rect = el.getBoundingClientRect();
      const dx = clamp((event.clientX - (rect.left + rect.width / 2)) * strength, -max, max);
      const dy = clamp((event.clientY - (rect.top + rect.height / 2)) * strength, -max, max);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      el.style.transition = 'transform 520ms cubic-bezier(0.16,1,0.3,1)';
      el.style.transform = 'translate3d(0,0,0)';
      setTimeout(() => {
        el.style.transition = '';
      }, 540);
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }

  /** 卡片 3D 倾斜（跟随鼠标的透视） */
  function tilt(el, max = 9) {
    if (!el) return;
    const onMove = (event) => {
      const rect = el.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      el.style.setProperty('--tilt-x', `${(-py * max).toFixed(2)}deg`);
      el.style.setProperty('--tilt-y', `${(px * max).toFixed(2)}deg`);
      el.style.setProperty('--glare-x', `${((px + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--glare-y', `${((py + 0.5) * 100).toFixed(1)}%`);
    };
    const onLeave = () => {
      el.style.setProperty('--tilt-x', '0deg');
      el.style.setProperty('--tilt-y', '0deg');
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
  }

  /** 数字滚动：0 → 目标值 */
  function countUp(el, to, duration = 900, format = (v) => String(Math.round(v))) {
    const from = 0;
    return tween(
      duration,
      (t) => {
        el.textContent = format(from + (to - from) * t);
      },
      ease.expo
    );
  }

  /** 手写体逐字浮现（用于「背面感想」与回顾摘要） */
  function typeIn(el, text, speed = 34) {
    return new Promise((resolve) => {
      el.textContent = '';
      const chars = Array.from(text);
      let i = 0;
      const timer = setInterval(() => {
        el.textContent += chars[i];
        i += 1;
        if (i >= chars.length) {
          clearInterval(timer);
          resolve();
        }
      }, speed);
    });
  }

  /** 生命感呼吸：让元素持续做极轻微的变化（避免界面「死」） */
  function breathe(el, { scale = 0.012, duration = 6200, delay = 0 } = {}) {
    if (!el) return;
    el.animate(
      [
        { transform: 'scale(1) translateZ(0)' },
        { transform: `scale(${1 + scale}) translateZ(0)` },
        { transform: 'scale(1) translateZ(0)' },
      ],
      { duration, delay, iterations: Infinity, easing: 'ease-in-out' }
    );
  }

  /** 粒子迸发（提交成功的庆祝） */
  function burst(host, { count = 26, colors = ['#d4653f', '#d9a441', '#7d8f6a', '#c79bb4'], power = 130 } = {}) {
    const layer = h('div', { class: 'fx-burst' });
    host.appendChild(layer);
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + rand(-0.14, 0.14);
      const dist = power * rand(0.45, 1.15);
      const size = rand(3, 8);
      const dot = h('i', {
        style: {
          background: colors[i % colors.length],
          width: `${size.toFixed(1)}px`,
          height: `${size.toFixed(1)}px`,
          borderRadius: i % 3 === 0 ? '2px' : '50%',
        },
      });
      layer.appendChild(dot);
      dot.animate(
        [
          { transform: 'translate3d(0,0,0) scale(0.3) rotate(0deg)', opacity: 0 },
          {
            transform: `translate3d(${(Math.cos(angle) * dist * 0.5).toFixed(1)}px, ${(
              Math.sin(angle) * dist * 0.5 -
              18
            ).toFixed(1)}px, 0) scale(1.1) rotate(${rand(-90, 90)}deg)`,
            opacity: 1,
            offset: 0.25,
          },
          {
            transform: `translate3d(${(Math.cos(angle) * dist).toFixed(1)}px, ${(
              Math.sin(angle) * dist +
              90
            ).toFixed(1)}px, 0) scale(0.4) rotate(${rand(-220, 220)}deg)`,
            opacity: 0,
          },
        ],
        { duration: rand(900, 1500), easing: 'cubic-bezier(0.16,1,0.3,1)' }
      );
    }
    setTimeout(() => layer.remove(), 1700);
  }

  /* ---------------- 确认弹层 ----------------
     只有一句话和两个选择的确认。直接复用弹层那一套结构：
     .scrim / .modal--narrow / .modal__close / .modal__body / .btn，
     和 router.js 里 openDay 搭大图弹层用的是同一套类名（CSS 里
     .modal--narrow 早就备好了，只是一直没人用），不另起一套对话框。

     返回 Promise<boolean>：确认 true；取消 / Esc / 点背景 false。 */
  function confirm(opts = {}) {
    const o = Object.assign(
      { kicker: '', title: '', text: '', note: '', confirmLabel: '好', cancelLabel: '再想想', icon: 'spark' },
      opts
    );
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey);
        scrim.classList.add('is-closing');
        setTimeout(() => scrim.remove(), 300);
        resolve(value);
      };
      // Esc 也关（router.js 的全局 Esc 处理只认最上面那层 scrim，效果一致）
      const onKey = (e) => {
        if (e.key === 'Escape') finish(false);
      };
      const okBtn = h(
        'button',
        { class: 'btn btn--primary', onclick: () => finish(true) },
        icon(o.icon, 15),
        h('span', { text: o.confirmLabel })
      );
      const modal = h(
        'div',
        { class: 'modal modal--narrow', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
        h('button', { class: 'modal__close', onclick: () => finish(false), 'aria-label': '关闭' }, h('span', { text: '✕' })),
        h(
          'div',
          { class: 'modal__body' },
          o.kicker ? h('div', { class: 'modal__kicker' }, icon('spark', 12), h('span', { text: o.kicker })) : null,
          h('h3', { class: 'modal__title', text: o.title }),
          o.text ? h('div', { class: 'modal__quote', text: o.text }) : null,
          o.note ? h('p', { class: 'modal__sub', style: { margin: '0' }, text: o.note }) : null,
          h(
            'div',
            { class: 'review-foot__row', style: { marginTop: '4px' } },
            okBtn,
            h('button', { class: 'btn btn--ghost', onclick: () => finish(false) }, h('span', { text: o.cancelLabel }))
          )
        )
      );
      const scrim = h('div', { class: 'scrim' }, modal);
      scrim.addEventListener('click', (e) => {
        if (e.target === scrim) finish(false);
      });
      document.body.appendChild(scrim);
      document.addEventListener('keydown', onKey);
      // 弹层里的主按钮也要有凝光。Light.init 现在只碰自己这一层（见 light.js），
      // 所以这里补一次不会动到侧栏、标题栏那些已经在跟手的表面。
      if (global.Light) global.Light.init(scrim);
      setTimeout(() => okBtn.focus(), 60);
    });
  }

  /* ---------------- 吐司 ---------------- */
  let toastHost = null;
  function toast(message, icon = '✦') {
    if (!toastHost) {
      toastHost = h('div', { class: 'toasts' });
      document.body.appendChild(toastHost);
    }
    const node = h('div', { class: 'toast' }, h('span', { text: icon }), h('span', { text: message }));
    toastHost.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 360);
    }, 2200);
  }

  /* ---------------- 图标 ----------------
     返回真实 SVG 元素（而不是 HTML 字符串）。
     早期版本用 h('span', { html: icon(...) }) 注入字符串，
     一旦外层再套 escapeHtml 就会把 <svg> 当纯文本渲染出来。 */
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const ICONS = {
    home: '<path d="M3 10.2 12 3l9 7.2V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    draw: '<rect x="3" y="4" width="13" height="17" rx="2"/><path d="M8 4V2.8A.8.8 0 0 1 8.8 2h6.4a.8.8 0 0 1 .8.8V4"/><path d="m13 13 3-3 4.2 4.2a1.6 1.6 0 0 1 0 2.3l-1.7 1.7a1.6 1.6 0 0 1-2.3 0z"/>',
    camera:
      '<path d="M4 8h2.6l1.3-2h8.2l1.3 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.4" r="3.4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    film: '<rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.2"/><path d="M7 4.6v14.8M17 4.6v14.8M2.6 9.6h4.4M2.6 14.4h4.4M17 9.6h4.4M17 14.4h4.4"/>',
    settings:
      '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1"/>',
    spark: '<path d="M12 2.5l1.9 5.9 5.9 1.9-5.9 1.9L12 18.1l-1.9-5.9L4.2 10.3l5.9-1.9z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.4V12l3.2 2"/>',
    share: '<path d="M12 3.5v11M12 3.5 8 7.6M12 3.5l4 4.1"/><path d="M5 14v5.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.5 6.2"/><path d="M20 4.5V11h-6.5"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/>',
    pencil: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L17 5a2.1 2.1 0 0 0-3 0L3.5 15.5V20z"/>',
    moon: '<path d="M20 14.6A8.6 8.6 0 1 1 9.4 4a7 7 0 0 0 10.6 10.6z"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7"/>',
    down: '<path d="M12 4v12M12 16l-4.5-4.5M12 16l4.5-4.5"/><path d="M4.5 20.5h15"/>',
    quote:
      '<path d="M9.5 6.5C6.9 7.6 5.5 9.8 5.5 13v4.5h5V12H8.3c0-1.6.6-2.7 1.9-3.3zM19 6.5c-2.6 1.1-4 3.3-4 6.5v4.5h5V12h-2.2c0-1.6.6-2.7 1.9-3.3z"/>',
  };

  function icon(name, size = 16) {
    const inner = ICONS[name] || ICONS.spark;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    svg.innerHTML = inner;
    return svg;
  }

  global.UI = {
    $,
    $$,
    h,
    setStyles,
    clamp,
    rand,
    wait,
    nextFrame,
    escapeHtml,
    ease,
    tween,
    spring,
    stagger,
    reveal,
    magnetize,
    tilt,
    countUp,
    typeIn,
    breathe,
    burst,
    confirm,
    toast,
    icon,
    ICONS,
  };
})(window);
