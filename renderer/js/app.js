/* ============================================================
   此间 · 应用启动
   ============================================================ */
(function (global) {
  'use strict';

  const { $, toast } = global.UI;
  const { Store } = global.CJ;

  /* ---------- 无边框窗口的控件 ---------- */
  function wireWindow() {
    const api = global.cijian;
    const btnMin = $('#win-min');
    const btnMax = $('#win-max');
    const btnClose = $('#win-close');

    if (!api || !api.minimize) {
      // 在浏览器里预览时隐藏窗口控件
      [btnMin, btnMax, btnClose].forEach((b) => b && (b.style.display = 'none'));
      return;
    }
    btnMin.addEventListener('click', () => api.minimize());
    btnMax.addEventListener('click', () => api.toggleMaximize());
    btnClose.addEventListener('click', () => api.close());

    const sync = (maximized) => {
      btnMax.title = maximized ? '还原' : '最大化';
      btnMax.innerHTML = maximized
        ? '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.6" y="3.4" width="7" height="7" rx="1.2"/><path d="M4 3.4V2.2h6.2v6.2H9"/></svg>'
        : '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.4"/></svg>';
    };
    Promise.resolve(api.isMaximized()).then(sync).catch(() => {});
    try {
      api.onWindowState((s) => sync(s.maximized));
    } catch (err) {
      /* 忽略：没有窗口状态通道时不影响使用 */
    }
  }

  /* ---------- 开幕：不用启动屏，让界面自己浮现 ----------
     Apple HIG 的「启动」章节写得很明确：
       「macOS、visionOS 和 watchOS 不需要启动屏幕。」
     并且建议改为「App 重新启动后恢复之前的状态」。
     所以这里不做 splash 遮罩，而是让应用外壳自己「显影」出来 ——
     背景的暖光先聚起，窗口内容随后淡入。这样既有一场开幕的仪式感，
     又不挡路、不拖时间，也不违反规范。 */
  function overture() {
    // 注意：这里绝对不要给 .app 写 style.animation ——
    // 行内样式会覆盖掉 base.css 里的 app-materialize，
    // 开屏就完全不会发生了（这个坑踩过一次）。
    document.documentElement.classList.add('is-booting');
    // 入场编排交给 CSS（见 base.css 的 app-materialize 与 rail-drop / bar-drop），
    // 这里只负责在结束后摘掉标记。
    setTimeout(() => document.documentElement.classList.remove('is-booting'), 1400);
  }

  function boot() {
    // 截图 / 自检模式：?noanim=1 时把所有动画直接跳到终态。
    // （隐藏窗口里 Chromium 会节流合成器，带 delay 的入场动画会永远停在第一帧）
    try {
      if (new URLSearchParams(global.location.search).get('noanim') === '1') {
        document.documentElement.dataset.noanim = 'on';
      }
    } catch (err) {
      /* ignore */
    }
    Store.init();
    global.Router.init();

    // 环境层。
    // 优先走 WebGL2 光学层：极光与所有玻璃面板在同一个着色器里画完，
    // 完全不用 backdrop-filter，比原来的 CSS 方案更快，而且折射是真的
    // （斯涅尔 n=1.52、RGB 色散、环境采样高光）。取不到 WebGL2 时退回
    // 原来的 CSS 极光——观感保持一致，只是没有折射。
    let optics = null;
    const opticsCanvas = document.getElementById('optics');
    // ?optics=0 强制走 CSS 回退，用来对比两套方案的帧率与观感；
    // ?optics=zones|offset|normal 把光学中间量画出来，用于自检。
    const opticsParam =
      (global.location.search.match(/[?&]optics=([a-z0-9]+)/) || [])[1] || '';
    const OPTICS_DEBUG = { zones: 1, offset: 2, normal: 3, u: 4 };
    const forceCss = opticsParam === '0';
    if (!forceCss && opticsCanvas && global.Optics && global.Optics.isSupported()) {
      optics = global.Optics.create({
        canvas: opticsCanvas,
        debug: OPTICS_DEBUG[opticsParam] || 0,
      });
    }
    if (optics) {
      document.documentElement.dataset.optics = 'webgl';
      optics.start();
      global.Router.optics = optics;
    } else {
      document.documentElement.dataset.optics = 'css';
      const ambient = global.Ambient.create();
      ambient.start();
      global.Router.ambient = ambient;
    }

    // 背景层：照片 / 视频。没设底图时光学层自己退回程序化极光。
    // 放在 optics.start() 之后 —— restore() 会立刻把源交给光学层，
    // 这时画布已经在跑，背景能直接进纹理。
    if (global.Background) {
      const bgLayer = global.Background.create({ optics: optics, store: global.Store });
      bgLayer.restore();
      global.Router.background = bgLayer;
      /* 底图挂上之后再算一次强调色。
         restore() 里面就可能已经 apply() 过一轮，而那一刻
         Router.background 还没赋值（上面这行在后），算出来的是兜底色 ——
         少了这一句，预设底图要等到下一次换页才配上它该有的颜色。 */
      global.Router.applyTheme();
    }

    // 凝光光效：给所有 data-light 表面挂上四层光影与跟手弥散光
    global.Light.init(document);

    /* 面板外文字的自适应取色。
       必须排在 Router.init() 之后、第一帧渲染完之后才会有效果，
       所以它自己内部是 rAF 调度的，这里是"开一个常驻的观察者"。
       它是「去掉那层灰」的另一半：背景不再为了白字而压暗，
       文字自己按底下的明暗换色。 */
    if (global.Adaptive) global.Adaptive.init();

    /* 粘滞：照片、勋章、小卡片跟着鼠标轻微偏移 + 放大。
       用事件委托，所以只需要开一次，之后路由重建的 DOM 自动生效。 */
    if (global.Magnetics) global.Magnetics.init();

    wireWindow();

    // 键盘提示
    setTimeout(() => {
      toast('按 1-5 可以在页面之间切换，Esc 关闭弹层', '⌘');
    }, 2200);

    // 每 60 秒检查一次是否跨天（跨天时刷新视图）
    let lastDay = Store.dayNumber(Store.activeCycle());
    setInterval(() => {
      const d = Store.dayNumber(Store.activeCycle());
      if (d !== lastDay) {
        lastDay = d;
        global.Router.rerender();
        toast('新的一天开始了，今天的卡已经洗好', '✦');
      }
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      overture();
      boot();
    });
  } else {
    overture();
    boot();
  }
})(window);
