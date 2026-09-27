/* ============================================================
   此间 · 液态玻璃（Glass）

   这一版只做**毛玻璃**这一档：把元素内部重排成
     .glass-frost（毛）/ .glass-refract（折，留位）/ .glass-inner（内容）
   三层，样式在 css/glass.css。

   以前这里还接着一个第三方折射内核（@avenra/liquid-glass），
   但那个 bundle 从来没有随应用分发过 —— renderer/vendor/ 是空的，
   index.html 也没有加载它，于是 LIB 恒为 null、SUPPORTED 恒为 false：
   整段折射逻辑一次都没执行过，只剩一段读不了的死代码。
   折射这件事现在由 optics.js 的 WebGL2 光学层真做（斯涅尔定律、
   RGB 色散），所以这里把那一段连同对 vendor 路径的引用一起去掉。

   两条仍然要守住的约束：
   1. **绝不把 backdrop root 放在玻璃的祖先上**（`opacity < 1` / `filter` /
      `mix-blend-mode` / `will-change: opacity|filter`）——
      那会让毛玻璃静默失效。`transform` 与 `will-change: transform` 是安全的。
      所以弹性动画一律作用在玻璃的**内部**元素上。
   2. **不影响可读性**：光晕永远压在内容之下。
   ============================================================ */
(function (global) {
  'use strict';

  const attached = [];

  /**
   * 给一个元素贴上液态玻璃。
   *
   * 结构（全部在元素内部，祖先不受任何影响）：
   *   el.is-glass
   *     ├─ .glass-frost    负责「毛」：blur + saturate
   *     ├─ .glass-refract  折射层留位（glass.css 里还有它的规则，这一版不再写 url(#id)）
   *     └─ .glass-inner    内容（弹性动画只作用在这一层）
   */
  function attach(el) {
    if (!el || el.dataset.glassReady === '1') return null;

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
      mode: 'blur-only',
      // 折射那一档已经不存在了，这两个句柄保留是为了调用方
      // （detachAll）不必判空，行为上就是「什么都不用做」。
      refresh: null,
      destroy: null,
    };

    // 在元素上留个标记便于排查（玻璃是否真的挂上了、走的是哪一档）
    el.dataset.glassMode = 'blur-only';
    return api;
  }

  /** 扫描页面里所有带 data-glass 的元素（data-glass 的取值只是标记，不再解析成参数） */
  function init(root = document) {
    const list = [];
    Array.from(root.querySelectorAll('[data-glass]')).forEach((el) => {
      const a = attach(el);
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

  global.Glass = { attach, init, detachAll };
})(window);
