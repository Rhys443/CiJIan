/* ============================================================
   此间 · 行星环相纸墙（PlanetRing）
   15 张相纸围成一个有厚度的环，缓慢自转；
   鼠标停在任意一张上时环停下、那张相纸浮起放大，并可以翻到背面。

   · 自动旋转：恒定角速度（默认 6°/s，转一圈约 60 秒）
   · 悬停：立即停下 + 减速（不是硬停，手感更接近有惯性的实体）
   · 可拖动：按住左右拖动接管旋转，松手后带惯性并落到最近的格位
   · 滚轮：一格一格地转
   · 尊重「减少动态效果」：不自动旋转，只保留悬停与拖动
   ============================================================ */
(function (global) {
  'use strict';

  const { h, clamp, wait } = global.UI;
  const { CYCLE_DAYS, themeById, taskById, EMOTIONS } = global.CJ;
  const { photo } = global.Photo;

  const AUTO_SPEED = 7; // 度/秒：转完一圈约 51 秒
  const DRAG_SPEED = 0.28; // 拖动时「每像素多少度」
  /**
   * 环面倾角。
   * 0° = 完全平视：15 张相纸像屏风一样立在眼前，看到的是环的「正面」。
   * 角度越大越像从上方俯视的行星环，但超过 30° 就会变成仰视/俯视的别扭视角。
   * 现在取 14°：既是平视，又能看出这是一整圈而不是一排。
   */
  const RING_TILT = 14;
  const FOCUS_OFFSET = 6; // 悬停时把目标角度稍微偏一点，避免完全正中显得呆

  /**
   * @param {object} o
   *  o.cycle     周期
   *  o.records   打卡记录数组
   *  o.onOpen    (day) => void，点击相纸时打开大图
   *  o.onProgress (p:0..1) => void，环转到第几天
   *  o.size      'md' | 'sm'
   */
  function create(o) {
    const opts = Object.assign({ size: 'md', onOpen: null, onProgress: null }, o);
    const cycle = opts.cycle;
    const records = opts.records || [];
    const byDay = new Map(records.map((r) => [r.dayNumber, r]));
    const theme = themeById(cycle.theme);
    const count = CYCLE_DAYS;
    const step = 360 / count;

    let rotation = 0; // 当前整体角度
    let velocity = AUTO_SPEED;
    let dragging = false;
    let hovered = -1;
    let focusTarget = null; // 悬停时想转到的角度
    let pointerInside = false;
    let lastX = 0;
    let lastT = 0;
    let raf = null;
    const reduceMotion =
      (global.CJ.Store.state.settings || {}).reduceMotion ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------------- 结构 ---------------- */
    const stageEl = h('div', { class: 'ring-stage' });
    const spin = h('div', { class: 'ring-spin' });
    const axis = h('div', { class: 'ring-axis' });
    const shadow = h('div', { class: 'ring-shadow' });

    const items = [];
    for (let n = 1; n <= count; n += 1) {
      const rec = byDay.get(n);
      const date = global.CJ.Store.dayDate(cycle, n);
      const card = rec
        ? global.Polaroid.create({
            src: rec.photo || photo(rec.photoSeed || n * 977, 360),
            seed: rec.photoSeed,
            day: n,
            date,
            theme: cycle.theme,
            task: taskById(rec.taskId).title,
            reflection: rec.reflection,
            emotion: rec.emotion,
            size: opts.size,
          })
        : global.Polaroid.blank({ day: n, date, theme: cycle.theme });

      const lift = h('div', { class: 'ring-lift' }, card.el);
      const item = h(
        'div',
        {
          class: `ring-item${rec ? '' : ' ring-item--empty'}`,
          dataset: { day: String(n) },
          style: { '--angle': `${(n - 1) * step}deg`, '--tilt': `${(((n * 37) % 5) - 2) * 0.9}deg` },
        },
        lift
      );
      spin.appendChild(item);
      items.push({ el: item, lift, card, day: n, filled: Boolean(rec) });

      // 悬停：环缓缓把这张转到正前方；移开后恢复自转
      // （自转的恢复以「光标离开整个环」为准，否则环一转走卡片就从光标下滑脱，会来回抖）
      item.addEventListener('mouseenter', () => {
        hovered = n - 1;
        item.classList.add('is-hovered');
        focusTarget = autoRotationFor(n - 1);
      });
      item.addEventListener('mouseleave', () => {
        if (hovered === n - 1) hovered = -1;
        item.classList.remove('is-hovered');
        if (pointerInside) focusTarget = null;
      });
      item.addEventListener('click', () => {
        if (dragging) return;
        if (Math.abs(shortestDelta(rotation, -((n - 1) * step))) > step * 0.55) return; // 还在转过去的路上
        if (rec && opts.onOpen) opts.onOpen(n);
        else if (!rec) global.UI.toast('这一天没有打卡记录', '✦');
      });
    }

    shadow.appendChild(h('div', { class: 'ring-shadow__inner' }));
    stageEl.appendChild(spin);
    stageEl.appendChild(shadow);
    stageEl.appendChild(axis);

    const wrap = h('div', { class: 'ring-wrap' }, stageEl);

    // 自转的恢复以「光标离开整个环」为准：否则环一转走，卡片就从光标下滑脱，
    // mouseleave/mouseenter 会来回触发，环就会抖。
    wrap.addEventListener('pointerenter', () => {
      pointerInside = true;
    });
    wrap.addEventListener('pointerleave', () => {
      pointerInside = false;
      focusTarget = null;
      hovered = -1;
      items.forEach((it) => it.el.classList.remove('is-hovered'));
    });

    /* ---------------- 尺寸 ----------------
       平视视角下，半径决定了相纸之间会不会互相遮挡。
       实测（15 张、倾角 14°）：
         R ≈ 1.9W  → 明显穿模
         R ≈ 2.6W  → 刚好相接
         R ≈ 2.8W  → 略有呼吸感，不散
       所以取 2.8W。环的水平投影约 2R + 卡宽，卡片宽度再由容器宽度反推。
       改张数或倾角时，这个系数要重新实测。 */
    function layout() {
      const PERSPECTIVE_GAIN = 1.18; // 2600px 透视距离下，前方约放大这么多
      const ASPECT = 1.62; // 相纸长宽比（1:1 画面 + 留白 + 下方宽边）
      const RADIUS_RATIO = 2.8; // R / 卡宽，见上方实测表

      const w = wrap.clientWidth || 900;
      const cardW = Math.max(70, Math.round((w * 0.9) / (2 * RADIUS_RATIO + 1)));
      const radius = Math.round(cardW * RADIUS_RATIO);
      const cardH = Math.round(cardW * ASPECT);
      const ellipse = radius * 2 * Math.sin((RING_TILT * Math.PI) / 180);
      const h2d = Math.ceil(cardH * PERSPECTIVE_GAIN + ellipse + 36);

      wrap.style.setProperty('--ring-r', `${radius}px`);
      wrap.style.setProperty('--ring-h', `${h2d}px`);
      wrap.style.setProperty('--ring-card-w', `${cardW}px`);
      spin.style.setProperty('--ring-r', `${radius}px`);
    }

    /* ---------------- 旋转循环 ---------------- */
    /** 把角度差归一到 [-180, 180]，用于「转到最近的同向角度」 */
    function shortestDelta(from, to) {
      let d = (to - from) % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      return d;
    }

    /** 让第 i 张正对观察者时的整体旋转角（留一点偏移，避免死正中） */
    function autoRotationFor(i) {
      const base = -((i * step) % 360);
      return rotation + shortestDelta(rotation, base) + FOCUS_OFFSET;
    }

    function tick(now) {
      if (!lastT) lastT = now;
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;

      if (!dragging) {
        if (focusTarget !== null) {
          // 悬停：像被轻轻吸过去一样，把目标那张转到正前方
          rotation += (focusTarget - rotation) * Math.min(1, dt * 4.4);
        } else {
          // 回到自动旋转的速度（缓入，不要突然加速）
          velocity += (AUTO_SPEED - velocity) * Math.min(1, dt * 1.6);
          rotation += velocity * dt;
        }
      }

      spin.style.transform = `rotateX(${RING_TILT}deg) rotateY(${rotation.toFixed(3)}deg)`;
      updateDepth();

      raf = requestAnimationFrame(tick);
    }

    /** 根据每张卡当前朝向调整透明度与亮度，做出「环有前后」的纵深
     *  —— 平视视角下，面对观察者的那张最靠前、最亮，背对的最远、最淡。 */
    function updateDepth() {
      const rad = (rotation * Math.PI) / 180;
      let focusDay = 1;
      let focusDepth = -2;
      items.forEach((it, i) => {
        const a = ((i * step * Math.PI) / 180) + rad;
        const depth = Math.sin(a); // +1 = 正对观察者（最靠前）
        if (depth > focusDepth) {
          focusDepth = depth;
          focusDay = it.day;
        }
        const isHover = it.el.classList.contains('is-hovered');
        if (isHover) {
          it.el.style.opacity = '1';
          it.el.style.filter = 'none';
          it.el.style.zIndex = '60';
          return;
        }
        const t = (depth + 1) / 2;
        it.el.style.opacity = String(0.34 + 0.66 * t);
        it.el.style.filter = `brightness(${(0.68 + 0.32 * t).toFixed(3)}) saturate(${(0.66 + 0.34 * t).toFixed(3)})`;
        it.el.style.zIndex = String(Math.round(depth * 30) + 40);
      });
      if (opts.onProgress) opts.onProgress((focusDay - 1) / (count - 1));
    }

    function startAuto() {
      if (raf || reduceMotion) return;
      lastT = 0;
      raf = requestAnimationFrame(tick);
    }

    function destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    /* ---------------- 拖动 ---------------- */
    function onDown(e) {
      dragging = true;
      lastX = e.clientX;
      velocity = 0;
      wrap.classList.add('is-dragging');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      const delta = dx * DRAG_SPEED;
      rotation += delta;
      velocity = delta * 12; // 作为松手时的初速度
    }

    function onUp() {
      dragging = false;
      wrap.classList.remove('is-dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // 带惯性滑行后落到最近的格位
      const target = Math.round(rotation / step) * step;
      const from = rotation;
      const t0 = performance.now();
      const DUR = 620;
      const spinToward = (now) => {
        const t = Math.min(1, (now - t0) / DUR);
        const eased = 1 - Math.pow(1 - t, 3);
        rotation = from + (target - from) * eased;
        if (t < 1) requestAnimationFrame(spinToward);
      };
      requestAnimationFrame(spinToward);
    }

    spin.addEventListener('pointerdown', onDown);

    /* 滚轮：一格一格地转 */
    wrap.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const dir = e.deltaY > 0 ? 1 : -1;
        const target = Math.round(rotation / step) * step + dir * step;
        const from = rotation;
        const t0 = performance.now();
        const DUR = 460;
        const go = (now) => {
          const t = Math.min(1, (now - t0) / DUR);
          const eased = 1 - Math.pow(1 - t, 3);
          rotation = from + (target - from) * eased;
          if (t < 1) requestAnimationFrame(go);
        };
        requestAnimationFrame(go);
      },
      { passive: false }
    );

    /* ---------------- 对外 API ---------------- */
    const api = {
      el: wrap,
      layout,
      start() {
        layout();
        startAuto();
        updateDepth();
      },
      destroy,
      /** 转到某一天（用于「跳到今天」之类的动作） */
      rotateTo(day, animate = true) {
        const target = -((day - 1) * step);
        if (!animate) {
          rotation = target;
          return;
        }
        const from = rotation;
        const t0 = performance.now();
        const DUR = 700;
        const go = (now) => {
          const t = Math.min(1, (now - t0) / DUR);
          const eased = 1 - Math.pow(1 - t, 3);
          rotation = from + (target - from) * eased;
          if (t < 1) requestAnimationFrame(go);
        };
        requestAnimationFrame(go);
      },
    };

    // 初始角度：让第 1 天正对观察者（rotateY(0) 才是正面朝向镜头）
    rotation = 0;
    requestAnimationFrame(() => api.start());
    void wait;
    void EMOTIONS;

    return api;
  }

  global.PlanetRing = { create };
})(window);
