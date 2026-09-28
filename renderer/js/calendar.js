/* ============================================================
   此间 · 日历（从 TODAY 卡长出来）

   它是「这一轮走到哪了、这一轮在练什么」的**当下**信息，
   不是配置 —— 所以不做成独立设置页，而是挂在左下角那张 TODAY 卡上：
   用户每天看进度的那一眼，恰好就是想看日历的那一眼。

   两条规矩（这个 App 里所有东西都守）：
   1. **从哪来，回哪去** —— 起点逐像素等于卡片矩形，关闭沿同一条路回卡片；
   2. **连续变换** —— 位置、宽度、高度、圆角全程一起插值，
      从卡片（约 198 × 142）长成一块完整日历（640 × 620）。
      宽度不能锁死在卡宽：那会变成一根细条，字看不清。

   交互：**按下缩小（93%）→ 松手弹射**。
   位移曲线是解析的阻尼弹簧（欠阻尼，约 4% 过冲），不是挑一条
   cubic-bezier 近似 —— 过冲就是"弹"的手感来源。

   任务池也在这里（原来在设置页）：它决定抽卡从哪一池抽，
   属于"这一轮练什么"，和日历是同一件事。
   ============================================================ */
(function (global) {
  'use strict';

  /* 展开后的尺寸。
     高度按**内容实测**定：640 宽时内容实高 666（页脚"数据全部保存在本机"那行
     曾经被切掉 30px），所以取 700 留一点余量。
     窗口矮的时候 boxes() 会按可用高度收一下，不会顶出屏幕。 */
  const CAL_W = 640;
  const CAL_H = 700;
  const SPRING = { zeta: 0.62, omega: 2 * Math.PI * 1.75, dur: 520 };

  let root = null;      // 覆盖层（scrim + 面板）
  let panel = null;
  let scrim = null;
  let anim = null;
  let pressAnim = null;
  let opened = false;

  /* ---------------- 弹簧 ---------------- */
  function springSamples(n) {
    const { zeta, omega, dur } = SPRING;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = (dur / 1000) * i / n;
      const e = Math.exp(-zeta * omega * t);
      out.push({
        x: 1 - e * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t)),
        offset: i / n,
      });
    }
    return out;
  }

  /* ---------------- 几何 ---------------- */
  function boxes() {
    const cardEl = document.getElementById('rail-card');
    const c = cardEl.getBoundingClientRect();
    const W = global.innerWidth;
    const H = global.innerHeight;
    /* 小窗口（比如把窗口拖得很矮）时按可用高度收一下，别顶出屏幕 */
    const h = Math.min(CAL_H, H - 40);
    const w = Math.min(CAL_W, W - 40);
    return {
      start: { x: c.left, y: c.top, w: c.width, h: c.height, r: 20 },
      end: { x: (W - w) / 2, y: (H - h) / 2, w, h, r: 24 },
    };
  }
  function ctrlOf(a, b) {
    return { x: a.x + (b.x - a.x) * 0.14, y: a.y + (b.y - a.y) * 0.82 - 40 };
  }
  function posAt(a, c, b, t) {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  }
  function pathFrames(a, b, ease) {
    const c = ctrlOf(a, b);
    const smp = springSamples(28);
    const last = smp[smp.length - 1].x || 1;   // 归一化，最后一点正好落在终点
    return smp.map((p) => {
      const raw = p.x / last;
      const s = ease ? ease(raw) : raw;
      const pt = posAt(a, c, b, s);
      return {
        left: pt.x + 'px', top: pt.y + 'px',
        width: (a.w + (b.w - a.w) * s) + 'px',
        height: (a.h + (b.h - a.h) * s) + 'px',
        borderRadius: (a.r + (b.r - a.r) * s) + 'px',
        offset: p.offset,
      };
    });
  }
  const easeOut = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 2);

  /* ---------------- 内容 ---------------- */
  function render() {
    const { Store, CYCLE_DAYS, THEMES } = global.CJ;
    const cycle = Store.activeCycle();
    const day = Store.dayNumber(cycle);
    const theme = global.CJ.themeById(cycle.theme);

    let done = 0, rest = 0;
    const cells = [];
    for (let n = 1; n <= CYCLE_DAYS; n++) {
      const rec = Store.checkinOf(cycle, n);
      const date = Store.dayDate(cycle, n);
      const isToday = n === day;
      let cls = 'cal-day', mark = '';
      if (rec) { cls += ' is-done'; mark = '✓'; done++; }
      else if (isToday) { cls += ' is-today'; }
      else if (n > day) { cls += ' is-future'; }
      else { cls += ' is-rest'; rest++; mark = '·'; }
      cells.push(
        '<div class="' + cls + '">' +
          '<i class="cal-day__n">D' + String(n).padStart(2, '0') + '</i>' +
          '<b class="cal-day__d">' + (date.getMonth() + 1) + '/' + date.getDate() + '</b>' +
          '<span class="cal-day__w">周' + '日一二三四五六'[date.getDay()] + '</span>' +
          (mark ? '<i class="cal-day__s">' + mark + '</i>' : '') +
        '</div>'
      );
    }
    const first = Store.dayDate(cycle, 1);
    const lastD = Store.dayDate(cycle, CYCLE_DAYS);
    const fmt = (d) => (d.getMonth() + 1) + '月' + d.getDate() + '日';
    const pct = Math.round((done / CYCLE_DAYS) * 100);
    const pinPct = Math.max(0, Math.min(100, Math.round(((day - 0.5) / CYCLE_DAYS) * 100)));

    const pool = THEMES.map((t) =>
      '<button class="cal-chip' + (t.id === cycle.theme ? ' is-on' : '') + '" data-pool="' + t.id + '">' +
        '<i>' + t.glyph + '</i><b>' + t.name + '</b><i class="cal-chip__d">' + t.category + '</i>' +
      '</button>'
    ).join('');

    const lastIndex = CYCLE_DAYS;
    const dayIndex = Math.min(day, lastIndex);

    panel.innerHTML =
      '<button class="cal__x" data-close aria-label="关闭">✕</button>' +
      '<div class="cal__body">' +
        '<div class="cal__k">CYCLE · 这一轮</div>' +
        '<h3 class="cal__h">15 天，' + fmt(first) + ' – ' + fmt(lastD) + '</h3>' +
        '<p class="cal__s">今天是第 ' + dayIndex + ' 天 · 已填满 ' + done + ' 张 · 还剩 ' +
          Math.max(0, CYCLE_DAYS - done) + ' 天</p>' +

        '<div class="cal-frame">' +
          '<div class="cal-frame__top"><span>这一轮：<b>' +
            (first.getMonth() + 1) + '.' + String(first.getDate()).padStart(2, '0') + ' – ' +
            (lastD.getMonth() + 1) + '.' + String(lastD.getDate()).padStart(2, '0') +
          '</b>（含首尾共 ' + CYCLE_DAYS + ' 天）</span>' +
          '<span>空着 ' + rest + ' 天</span></div>' +
          '<div class="cal-grid">' + cells.join('') + '</div>' +
        '</div>' +

        '<div class="cal-prog">' +
          '<div class="cal-prog__bar">' +
            '<div class="cal-prog__in" style="width:' + pct + '%"></div>' +
            '<div class="cal-prog__pin" style="left:' + pinPct + '%"></div>' +
          '</div>' +
          '<div class="cal-prog__legend"><span>已填满 ' + done + ' / ' + CYCLE_DAYS + '</span>' +
          '<span>▲ 今天 · 第 ' + dayIndex + ' 天</span><span>剩 ' + Math.max(0, CYCLE_DAYS - done) + '</span></div>' +
        '</div>' +

        '<div class="cal-pool">' +
          '<div class="cal-pool__h"><b>这一轮练什么</b>' +
            '<span>' + theme.glyph + ' ' + theme.tagline + ' · 只决定抽卡从哪一池抽</span></div>' +
          '<div class="cal-chips">' + pool +
            '<button class="cal-chip is-dash" data-cust><i>✎</i><b>自定义…</b>' +
              '<i class="cal-chip__d">先留入口</i></button>' +
          '</div>' +
          '<div class="cal-cust">' +
            '<textarea placeholder="这 15 天，我在意的关键词是什么？例如：早睡 / 散步 / 不刷手机"></textarea>' +
            '<div class="cal-cust__hint">先留一个入口：以后这里接 AI 生成 15 天任务，' +
              '或者给几套写好的关键词模板直接选。</div>' +
            '<div class="cal-cust__row">' +
              '<button class="cal-tpl">早睡 · 散步 · 不刷手机</button>' +
              '<button class="cal-tpl">读完一本 · 写 300 字</button>' +
              '<button class="cal-tpl">给一个人打电话</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="cal__foot"><span>数据全部保存在本机</span><span>Esc 或点击空白处关闭</span></div>' +
      '</div>';
  }

  /* ---------------- 骨架 ---------------- */
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'cal-layer';
    root.setAttribute('aria-hidden', 'true');
    scrim = document.createElement('div');
    scrim.className = 'cal-scrim';
    panel = document.createElement('div');
    panel.className = 'cal-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '这一轮的日历');
    root.appendChild(scrim);
    root.appendChild(panel);
    document.body.appendChild(root);

    scrim.addEventListener('click', close);
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { close(); return; }
      const chip = e.target.closest('.cal-chip[data-pool]');
      if (chip) {
        const { Store } = global.CJ;
        const cycle = Store.activeCycle();
        const t = global.CJ.themeById(chip.dataset.pool);
        cycle.theme = t.id;
        cycle.keyword = t.name;
        Store.save();
        global.Router.applyTheme();
        global.Router.rerender();
        render();
        global.UI.toast('这一轮换成「' + t.name + '」', t.glyph);
        return;
      }
      if (e.target.closest('[data-cust]')) {
        panel.querySelectorAll('.cal-chip[data-pool]').forEach((n) => n.classList.remove('is-on'));
        e.target.closest('.cal-chip').classList.add('is-on');
        const box = panel.querySelector('.cal-cust');
        box.classList.add('is-on');
        const ta = box.querySelector('textarea');
        if (ta) ta.focus();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && opened) close();
    });
  }

  /* ---------------- 开合 ---------------- */
  function open() {
    build();
    if (opened) return;
    opened = true;
    render();
    const bx = boxes();
    panel.style.left = bx.start.x + 'px';
    panel.style.top = bx.start.y + 'px';
    panel.style.width = bx.start.w + 'px';
    panel.style.height = bx.start.h + 'px';
    root.classList.add('is-on');
    panel.classList.add('is-on');
    requestAnimationFrame(() => root.classList.add('is-blur'));

    if (anim) anim.cancel();
    anim = panel.animate(pathFrames(bx.start, bx.end, null),
      { duration: SPRING.dur, easing: 'linear', fill: 'both' });
    anim.finished.then(() => settle(bx.end)).catch(() => {});
  }
  function settle(end) {
    panel.style.left = end.x + 'px';
    panel.style.top = end.y + 'px';
    panel.style.width = end.w + 'px';
    panel.style.height = end.h + 'px';
    if (anim) { anim.cancel(); anim = null; }
  }
  function close() {
    if (!opened) return;
    opened = false;
    const bx = boxes();
    root.classList.remove('is-blur');
    setTimeout(() => { if (!opened) root.classList.remove('is-on'); }, 260);
    if (anim) anim.cancel();
    anim = panel.animate(pathFrames(bx.end, bx.start, easeOut),
      { duration: 340, easing: 'linear', fill: 'both' });
    anim.finished.then(() => {
      panel.classList.remove('is-on');
      if (anim) { anim.cancel(); anim = null; }
    }).catch(() => {});
  }

  /* 按下缩小：按住卡片时的反馈，松手回弹 */
  function press(on) {
    const cardEl = document.getElementById('rail-card');
    if (!cardEl) return;
    if (pressAnim) pressAnim.cancel();
    pressAnim = cardEl.animate(
      [{ transform: on ? 'scale(1)' : 'scale(.94)' }, { transform: on ? 'scale(.94)' : 'scale(1)' }],
      { duration: on ? 130 : 240,
        easing: on ? 'cubic-bezier(.34,1.56,.64,1)' : 'cubic-bezier(.16,1,.3,1)',
        fill: 'forwards' }
    );
  }

  /* Router 每次重建左栏卡片都会调这里，所以按压/点击绑在卡片自己身上 */
  function bindCard(cardEl) {
    if (!cardEl || cardEl.dataset.calBound === '1') return;
    cardEl.dataset.calBound = '1';
    cardEl.style.cursor = 'pointer';
    cardEl.title = '点开这一轮的日历';
    cardEl.addEventListener('pointerdown', (e) => { e.preventDefault(); press(true); });
    cardEl.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      press(false);
      open();
    });
    cardEl.addEventListener('pointercancel', () => press(false));
  }

  global.Calendar = { open, close, build, bindCard, get isOpen() { return opened; } };
})(window);
