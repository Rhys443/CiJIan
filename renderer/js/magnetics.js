/* ============================================================
   粘滞（magnetics）

   鼠标移到照片、勋章、小卡片上时，元素朝鼠标方向偏移最多 6px 并轻微放大，
   移开回弹。这就是「材质跟着手走一点」的手感。

   三个实现上的选择：

   1. **用 `translate` / `scale` 独立属性，不用 `transform`。**
      这些元素里已经有不少在用 `transform` 做布局（相纸的翻面、
      环的 3D 摆位、卡片的入场）。再写一条 transform 会**整个覆盖**掉它们，
      而独立属性是和 transform 合成的，两边互不干扰。

   2. **一次性事件委托，不是逐元素绑定。**
      视图是每次路由重建 DOM 的，逐个绑就得在每次渲染后重来一遍，
      漏一次就是「这一页没有粘滞」。挂在 document 上用 closest 找，
      新渲染出来的元素自动就有。

   3. **进入时把基准矩形量一次就缓存。**
      如果每帧都 getBoundingClientRect，元素被自己推走之后矩形跟着变，
      下一次算出来的偏移又变 —— 会自激振荡成抖动。
      量一次基准、之后只算鼠标相对位置，才是稳定的。
   ============================================================ */
(function (global) {
  'use strict';

  /* 参与粘滞的元素 */
  const SEL = '.badge, .cell, .rail-card, .stat, .trace, .polaroid, .theme-opt, .shot';
  /* 排除：这些元素自己就在做 3D 变换或整层铺满，跟着鼠标动会打架 */
  const SKIP = '.ring-item, .deck, .modal, .scrim, .polaroid__inner';

  const MAX_PX = 6;      // 最大位移
  const SCALE = 1.03;    // 最大放大

  let cur = null;
  let raf = 0;
  let px = 0;
  let py = 0;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function reset(el) {
    if (!el) return;
    el.style.removeProperty('--mag-x');
    el.style.removeProperty('--mag-y');
    el.style.removeProperty('--mag-s');
    el.removeAttribute('data-mag');
  }

  function apply() {
    raf = 0;

    const hit = document.elementFromPoint(px, py);
    let el = hit && hit.closest ? hit.closest(SEL) : null;
    if (el && el.closest(SKIP)) el = null;

    if (el !== cur) {
      reset(cur);
      cur = el;
      if (cur) {
        cur.setAttribute('data-mag', '');
        // 基准矩形只在这里量一次，见文件头第 3 条
        cur.__magRect = cur.getBoundingClientRect();
      }
    }
    if (!cur) return;

    // 元素可能在指针不动的时候被替换掉（路由切换），矩形失效就重来
    const r = cur.__magRect;
    if (!r || !cur.isConnected) { reset(cur); cur = null; return; }

    const dx = clamp((px - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
    const dy = clamp((py - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
    cur.style.setProperty('--mag-x', (dx * MAX_PX).toFixed(2) + 'px');
    cur.style.setProperty('--mag-y', (dy * MAX_PX).toFixed(2) + 'px');
    cur.style.setProperty('--mag-s', String(SCALE));
  }

  function onMove(e) {
    px = e.clientX;
    py = e.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  }

  function onOut(e) {
    // 指针离开窗口 / 走到没有元素的地方
    if (!e.relatedTarget) { reset(cur); cur = null; }
  }

  function init() {
    if (global.__magneticsOn) return;
    global.__magneticsOn = true;
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    // 换页时把当前元素放掉，免得它带着偏移被移除
    document.addEventListener('click', () => { reset(cur); cur = null; }, true);
  }

  global.Magnetics = { init, reset };
})(window);
