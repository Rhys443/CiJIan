/* ============================================================
   此间 · 环境层（暖光漂移 + 跟随鼠标的视差）

   原来的三团光是 CSS 关键帧来回摆动，看久了能发现「弹回去」的折返。
   这里改成逐帧插值：每团光在一串路点之间游走，走到附近就随机挑下一个，
   速度各不相同、彼此不同步，于是整片背景一直在缓慢呼吸。

   另外加一层很轻的鼠标视差：光斑按不同速率跟随光标，
   界面就有了「屋子里的灯在动」而不是「贴了张壁纸」的感觉。
   ============================================================ */
(function (global) {
  'use strict';

  const { clamp, rand } = global.UI;

  /**
   * 每团光的性格。
   *
   * 四组参数各管一件事：
   *  · speed    —— 朝目标逼近的快慢（指数平滑系数）
   *  · range    —— 路点的随机范围（相对元素尺寸）
   *  · wander / wanderAmp —— 低频圆周漂移，保证任何时刻都在动，不会「到位就停」
   *  · parallax —— 跟随鼠标的视差深度（正负决定方向相反，形成层次）
   *
   * 两组速度取不同的无理数比例，四团就不会同步呼吸。
   */
  const BLOBS = [
    { sel: '.aurora--1', speed: 0.10, range: 0.20, wander: 0.085, wanderAmp: 0.055, parallax: 34, scale: [0.9, 1.22] },
    { sel: '.aurora--2', speed: 0.08, range: 0.17, wander: 0.117, wanderAmp: 0.045, parallax: -26, scale: [0.88, 1.16] },
    { sel: '.aurora--3', speed: 0.065, range: 0.24, wander: 0.061, wanderAmp: 0.065, parallax: 18, scale: [0.86, 1.2] },
    { sel: '.aurora--4', speed: 0.12, range: 0.15, wander: 0.143, wanderAmp: 0.04, parallax: -40, scale: [0.92, 1.24] },
  ];

  function create() {
    const reduceMotion =
      document.documentElement.dataset.reduceMotion === 'on' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const layers = BLOBS.map((cfg, i) => {
      const el = document.querySelector(cfg.sel);
      if (!el) return null;
      const w = el.offsetWidth || 600;
      const h = el.offsetHeight || 600;
      return {
        cfg,
        el,
        w,
        h,
        // 当前位置（相对原地，单位 px）
        x: 0,
        y: 0,
        // 目标位置
        tx: 0,
        ty: 0,
        // 当前缩放与目标缩放
        s: 1,
        ts: 1,
        // 计时器：走完一段后换下一个路点
        phase: rand(0, Math.PI * 2),
        // 低频漂移的相位错开，避免四团同向摆动
        wanderPhase: i * 1.7 + rand(0, Math.PI * 2),
      };
    }).filter(Boolean);

    let mx = 0; // 鼠标视差：-1 .. 1
    let my = 0;
    let tmx = 0;
    let tmy = 0;
    let raf = null;
    let last = 0;
    let clock = 0; // 累计时间，用于低频漂移

    function pickTarget(layer) {
      const { cfg, w, h } = layer;
      const rx = w * cfg.range;
      const ry = h * cfg.range;
      layer.tx = rand(-rx, rx);
      layer.ty = rand(-ry, ry);
      layer.ts = rand(cfg.scale[0], cfg.scale[1]);
    }

    function tick(now) {
      if (!last) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      clock += dt;

      // 鼠标视差本身也做阻尼，避免光斑跟着光标一跳一跳
      mx += (tmx - mx) * Math.min(1, dt * 2.4);
      my += (tmy - my) * Math.min(1, dt * 2.4);

      layers.forEach((l, i) => {
        // ① 低频漂移：一个周期很长的圆周摆动，叠在路点之上。
        //    没有它的话，光斑逼近路点后会停住、等计时器到点才动，
        //    观感就是「动一下、停一下」——实测相邻帧差异会掉到 0。
        const spin = clock * l.cfg.wander + l.wanderPhase;
        const dx = Math.cos(spin) * l.w * l.cfg.wanderAmp;
        const dy = Math.sin(spin * 0.78) * l.h * l.cfg.wanderAmp;

        // ② 目标 = 路点 + 漂移偏移
        const gx = l.tx + dx;
        const gy = l.ty + dy;

        // ③ 帧率无关的指数逼近
        const a = 1 - Math.pow(1 - Math.min(l.cfg.speed, 0.9), dt * 60);
        l.x += (gx - l.x) * a;
        l.y += (gy - l.y) * a;
        l.s += (l.ts - l.s) * a * 0.7;

        // ④ 走到路点附近且计时到了，就换一个新路点
        const near = Math.max(10, l.w * l.cfg.range * 0.08);
        if (Math.abs(l.tx - l.x) < near && Math.abs(l.ty - l.y) < near) {
          l.phase -= dt;
          if (l.phase <= 0) {
            pickTarget(l);
            l.phase = rand(1.6, 4.5);
          }
        }

        const px = mx * l.cfg.parallax;
        const py = my * l.cfg.parallax * 0.7;
        l.el.style.transform = `translate3d(${(l.x + px).toFixed(2)}px, ${(l.y + py).toFixed(2)}px, 0) scale(${l.s.toFixed(4)})`;
        void i;
      });

      raf = requestAnimationFrame(tick);
    }

    function onMove(e) {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      tmx = clamp((e.clientX / w) * 2 - 1, -1, 1);
      tmy = clamp((e.clientY / h) * 2 - 1, -1, 1);
    }

    const api = {
      start() {
        if (reduceMotion) {
          // 减少动态效果：只保留静态的暖光，不做位移动画
          layers.forEach((l) => {
            l.el.style.transform = 'translate3d(0,0,0) scale(1)';
          });
          return;
        }
        layers.forEach((l) => {
          // 初始位置随机一点，避免每台机器打开都一样
          l.x = rand(-l.w * 0.06, l.w * 0.06);
          l.y = rand(-l.h * 0.06, l.h * 0.06);
          pickTarget(l);
          l.s = l.ts;
        });
        window.addEventListener('mousemove', onMove, { passive: true });
        raf = requestAnimationFrame(tick);
      },
      /** 主题切换后重新量一次尺寸（光斑大小随主题可能不同） */
      relayout() {
        layers.forEach((l) => {
          l.w = l.el.offsetWidth || l.w;
          l.h = l.el.offsetHeight || l.h;
          pickTarget(l);
        });
      },
      stop() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        window.removeEventListener('mousemove', onMove);
      },
    };

    return api;
  }

  global.Ambient = { create };
})(window);
