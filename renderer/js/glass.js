/* ============================================================
   此间 · 液态玻璃（Glass）

   ★ 折射内核来自开源库 `@avenra/liquid-glass@1.2.0`（MIT，
     作者 DevSam7t3，https://github.com/DevSam7t3/liquid-glass）。
     已 vendor 到 renderer/vendor/ ，随应用离线分发，不走 CDN。

   为什么选它（源码级核实过）：
   · `backdrop-filter: url(#svgFilter)` —— 折射的是**实时 backdrop**，
     所以背景里那几团缓慢漂移的光斑会被一起弯折。整个 bundle 里
     `cloneNode` 出现 0 次，不存在「复制背景快照」那种做法。
     （克隆背景的实现在动态背景上必然错位，这是筛掉其它库的主因。）
   · 真物理：按 Snell 定律算一维折射 LUT，再绕圆角矩形铺开。
   · 自带弹簧（Spring），位置与速度都连续。
   · MIT。

   两条必须守住的约束：
   1. **绝不把 backdrop root 放在玻璃的祖先上**（`opacity < 1` / `filter` /
      `mix-blend-mode` / `will-change: opacity|filter`）——
      那会让折射静默失效。`transform` 与 `will-change: transform` 是安全的。
      所以弹性动画一律作用在玻璃的**内部**元素上。
   2. **不影响可读性**：折射只在边缘一圈，中心不位移；
      四层光影也都是极低强度，光晕永远压在内容之下。
   ============================================================ */
(function (global) {
  'use strict';

  const LIB = global.LiquidGlass || null;
  const SUPPORTED =
    !!LIB &&
    (() => {
      try {
        // 自己探测，不用库的 supportsBackdropFilter()：
        // 它要求 window.chrome 为真，而 Electron 里这个字段并非必然存在，
        // 一旦为假会静默降级成纯模糊，看不出问题。
        const probe = document.createElement('div').style;
        probe.backdropFilter = 'url("#none")';
        return probe.backdropFilter !== '' && probe.backdropFilter !== undefined;
      } catch (err) {
        return false;
      }
    })();

  const attached = [];

  /** 从 data-glass="blur:14;thickness:140;bezel:26;ior:1.5" 解析参数 */
  function parseOptions(raw) {
    const o = {};
    String(raw || '')
      .split(';')
      .forEach((pair) => {
        const [k, v] = pair.split(':');
        if (!k || v === undefined) return;
        const n = parseFloat(v);
        if (!Number.isNaN(n)) o[k.trim()] = n;
      });
    return o;
  }

  /**
   * 给一个元素贴上液态玻璃。
   *
   * 结构（全部在元素内部，祖先不受任何影响）：
   *   el.is-glass
   *     ├─ .glass-frost    负责「毛」：blur + saturate
   *     ├─ .glass-refract  负责「折」：backdrop-filter: url(#id)
   *     └─ .glass-inner    内容（弹性动画只作用在这一层）
   */
  function attach(el, opts) {
    if (!el || el.dataset.glassReady === '1') return null;

    const cfg = Object.assign(
      {
        blur: 12,
        saturation: 1.25,
        // 折射边带：只占边缘一圈，所以中心区域的文字完全不受影响
        bezelWidth: 22,
        glassThickness: 130,
        refractiveIndex: 1.5,
      },
      opts
    );

    const inner = document.createElement('div');
    inner.className = 'glass-inner';
    while (el.firstChild) inner.appendChild(el.firstChild);

    const frost = document.createElement('i');
    frost.className = 'glass-frost';
    frost.setAttribute('aria-hidden', 'true');

    const refract = document.createElement('i');
    refract.className = 'glass-refract';
    refract.setAttribute('aria-hidden', 'true');

    el.appendChild(frost);
    el.appendChild(refract);
    el.appendChild(inner);
    el.classList.add('is-glass');
    el.dataset.glassReady = '1';

    const api = {
      el,
      mode: 'placeholder',
      handle: null,
      refresh: null,
      destroy: null,
    };

    if (!SUPPORTED || !LIB || typeof LIB.createLiquidGlass !== 'function') {
      // 不支持的平台：退化成纯毛玻璃。绝不静默 —— 在元素上留标记便于排查。
      el.dataset.glassMode = 'blur-only';
      api.mode = 'blur-only';
      return api;
    }

    try {
      // 用库的高层 API：它自己会建位移图、建 filter、挂 backdrop-filter
      const handle = LIB.createLiquidGlass(el, {
        bezelWidth: cfg.bezelWidth,
        glassThickness: cfg.glassThickness,
        refractiveIndex: cfg.refractiveIndex,
        profile: 'convexSquircle',
        blur: cfg.blur,
        saturation: cfg.saturation,
        specularSlope: 0.7,
        filterMode: 'screen',
        // 让库把我们准备好的两层用起来，而不是它自己再插一层
        frostElement: frost,
        refractElement: refract,
      });

      el.dataset.glassMode = 'refraction';
      api.mode = 'refraction';
      api.handle = handle;
      api.refresh = () => handle && handle.refresh && handle.refresh();
      api.destroy = () => handle && handle.destroy && handle.destroy();
    } catch (err) {
      // 任何异常都不该让界面挂掉，退回纯毛玻璃并记录原因
      el.dataset.glassMode = 'blur-only';
      el.dataset.glassError = String(err && err.message ? err.message : err);
      api.mode = 'blur-only';
      if (global.console && console.warn) console.warn('[Glass] 折射初始化失败，退回毛玻璃:', err);
    }

    return api;
  }

  /** 扫描页面里所有带 data-glass 的元素 */
  function init(root = document) {
    const list = [];
    Array.from(root.querySelectorAll('[data-glass]')).forEach((el) => {
      const a = attach(el, parseOptions(el.getAttribute('data-glass')));
      if (a) {
        attached.push(a);
        list.push(a);
      }
    });
    return list;
  }

  function detachAll() {
    attached.forEach((a) => a.destroy && a.destroy());
    attached.length = 0;
  }

  global.Glass = {
    attach,
    init,
    detachAll,
    get supported() {
      return SUPPORTED;
    },
    get lib() {
      return LIB;
    },
  };
})(window);
