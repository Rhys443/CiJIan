/* ============================================================
   此间 · 路由与全局外壳
   · 左侧导航的状态同步
   · 视图切换（淡入 + 8px 微升 + 一道「冲洗」扫光）
   · 日历上的任意一天都可以点开成大图弹层
   · 键盘快捷键
   ============================================================ */
(function (global) {
  'use strict';

  const { $, h, icon } = global.UI;
  const { Store, CYCLE_DAYS, themeById, taskById, EMOTIONS } = global.CJ;
  const { fmtCN } = global.CJ.utils;
  const { photo } = global.Photo;

  const ROUTES = [
    { id: 'home', label: '今天', icon: 'home' },
    { id: 'draw', label: '抽卡', icon: 'draw' },
    { id: 'checkin', label: '打卡', icon: 'camera' },
    { id: 'review', label: '回顾', icon: 'film' },
    { id: 'settings', label: '设置', icon: 'settings' },
  ];

  /** 旧路由别名：日历墙已经并入回顾页 */
  const ALIAS = { calendar: 'review' };

  const Router = {
    current: 'home',
    el: null,
    navEl: null,
    railCard: null,
    lastFocus: null,

    init() {
      this.el = $('#view');
      this.navEl = $('#nav');
      this.railCard = $('#rail-card');
      this.buildNav();
      this.buildRailCard();
      Store.subscribe(() => this.buildRailCard());
      document.addEventListener('keydown', (e) => this.onKey(e));
      this.go('home', { first: true });
    },

    buildNav() {
      this.navEl.innerHTML = '';
      ROUTES.forEach((r) => {
        this.navEl.appendChild(
          h(
            'button',
            { class: 'nav__item', dataset: { route: r.id }, onclick: () => Router.go(r.id) },
            icon(r.icon, 17),
            h('span', { text: r.label }),
            r.id === 'checkin'
              ? h('span', { class: 'nav__badge', dataset: { badge: 'checkin' }, text: '' })
              : null
          )
        );
      });
    },

    /** 左侧底部的「今日相纸」小卡 */
    buildRailCard() {
      const { cycle, day } = this.context();
      const theme = themeById(cycle.theme);
      const done = Store.checkinOf(cycle, day);
      const card = this.railCard;
      card.innerHTML = '';
      card.appendChild(h('div', { class: 'rail-card__label', text: 'TODAY' }));
      card.appendChild(
        h(
          'div',
          { class: 'rail-card__day' },
          h('b', { text: String(day).padStart(2, '0') }),
          h('span', { text: `/ ${CYCLE_DAYS} 天` })
        )
      );
      card.appendChild(h('div', { class: 'rail-card__theme', text: `${theme.glyph} ${theme.name}` }));
      card.appendChild(
        h('div', {
          class: 'rail-card__theme faint',
          style: { fontSize: '11.5px', marginTop: '4px' },
          text: done ? '今天的相纸已收藏' : '今天的相纸还空着',
        })
      );
      card.appendChild(h('div', { class: 'rail-card__spark' }));

      const badge = this.navEl.querySelector('[data-badge="checkin"]');
      if (badge) {
        badge.textContent = done ? '已完成' : '待打卡';
        badge.style.opacity = done ? '0.55' : '1';
      }
    },

    context() {
      const cycle = Store.activeCycle();
      const day = Store.dayNumber(cycle);
      return {
        cycle,
        day,
        go: (id) => this.go(id),
        openDay: (n) => this.openDay(n),
        rerender: () => this.rerender(),
        applyTheme: () => this.applyTheme(),
        applyMode: () => this.applyMode(),
        exportData: () => this.exportData(),
        version: () => this.version(),
        planVerify: () => this.planVerify(),
      };
    },

    applyTheme() {
      const cycle = Store.activeCycle();
      document.documentElement.dataset.theme = themeById(cycle.theme).id;
      // 凝光光效的颜色取自主题色，切主题后要同步一次
      if (global.Light) global.Light.syncColors();
      if (this.ambient) this.ambient.relayout();
      // 光学层的光斑颜色同样来自 CSS 令牌，换主题后要重新采一次
      if (this.optics) this.optics.refresh();
    },

    applyMode() {
      const settings = Store.state.settings;
      const mode = settings.mode || 'light';
      document.documentElement.dataset.mode = mode;
      // 空间模式也走深色底，同时让环境层切成冷色光斑
      document.documentElement.dataset.spatial = mode === 'spatial' ? 'on' : 'off';
      document.documentElement.dataset.reduceMotion = settings.reduceMotion ? 'on' : 'off';
      // 亮/暗/空间三套底色的极光颜色不同，光学层要重新读
      if (this.optics) this.optics.refresh();
    },

    go(id, opts = {}) {
      const target = ALIAS[id] || id;
      const view = global.Views[target];
      if (!view) return;
      id = target;
      this.current = id;
      this.applyTheme();
      this.applyMode();

      this.navEl.querySelectorAll('.nav__item').forEach((n) => {
        n.classList.toggle('is-active', n.dataset.route === id);
      });

      const host = this.el;
      host.innerHTML = '';
      host.scrollTop = 0;
      const node = view.render(this.context());
      host.appendChild(node);
      host.classList.remove('is-entering');
      if (!opts.first) {
        void host.offsetWidth;
        host.classList.add('is-entering');
        const stage = $('#stage');
        stage.classList.remove('is-developing');
        void stage.offsetWidth;
        stage.classList.add('is-developing');
      }
      this.buildRailCard();
      global.UI.reveal(node);
      // 新挂上来的表面需要补上凝光光效（卡片、统计块、按钮…）
      if (global.Light) global.Light.init(node);
      // 视图换了，玻璃面板的矩形也要重新量
      if (this.optics) this.optics.measure();
    },

    rerender() {
      this.go(this.current);
    },

    /* ---------- 单日大图弹层 ---------- */
    openDay(n) {
      const ctx = this.context();
      const cycle = ctx.cycle;
      const rec = Store.checkinOf(cycle, n);
      if (!rec) {
        global.UI.toast('这一天没有打卡记录', '✦');
        return;
      }
      const task = taskById(rec.taskId);
      const theme = themeById(cycle.theme);
      const emo = EMOTIONS.find((e) => e.id === rec.emotion) || EMOTIONS[0];
      const date = Store.dayDate(cycle, n);
      this.lastFocus = document.activeElement;

      const print = global.Polaroid.create({
        src: rec.photo || photo(rec.photoSeed || n * 977, 560),
        seed: rec.photoSeed,
        day: n,
        date,
        theme: cycle.theme,
        task: task.title,
        reflection: rec.reflection,
        emotion: rec.emotion,
        size: 'md',
      });

      const esc = (e) => {
        if (e.key === 'Escape') close();
      };
      const close = () => {
        document.removeEventListener('keydown', esc);
        scrim.classList.add('is-closing');
        const back = Router.lastFocus;
        setTimeout(() => {
          scrim.remove();
          if (back && back.focus) back.focus();
        }, 300);
      };

      const modal = h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `第 ${n} 天的相纸` },
        h('button', { class: 'modal__close', onclick: () => close(), 'aria-label': '关闭' }, h('span', { text: '✕' })),
        h('div', { class: 'modal__print' }, print.el),
        h(
          'div',
          { class: 'modal__body' },
          h('div', { class: 'modal__kicker' }, icon('calendar', 12), h('span', { text: `${fmtCN(date)} · 第 ${n} 天` })),
          h('h3', { class: 'modal__title', text: task.title }),
          h('p', { class: 'modal__sub', text: `${theme.glyph} ${theme.name} · ${task.photoGuide}` }),
          h('div', { class: 'modal__quote', text: rec.reflection || '这一天你在休息，也很好。' }),
          h(
            'div',
            { class: 'trace__legend' },
            h('span', {}, h('i', { style: { background: emo.color } }), `当时的心情：${emo.label}`),
            h(
              'span',
              {},
              h('i', { style: { background: 'var(--theme)' } }),
              `写作提示：${global.Polaroid.truncate(task.writingPrompt, 20)}`
            )
          ),
          h(
            'div',
            { class: 'review-foot__row', style: { justifyContent: 'flex-start', marginTop: '6px' } },
            h('button', { class: 'btn btn--quiet', onclick: () => print.flip() }, icon('refresh', 14), h('span', { text: '翻面' })),
            h('button', { class: 'btn btn--ghost', onclick: () => close() }, h('span', { text: '关闭' }))
          )
        )
      );

      const scrim = h('div', { class: 'scrim' }, modal);
      scrim.addEventListener('click', (e) => {
        if (e.target === scrim) close();
      });
      document.body.appendChild(scrim);
      requestAnimationFrame(() => print.develop(120));
      document.addEventListener('keydown', esc);
      const focusTarget = modal.querySelector('.modal__close');
      if (focusTarget) setTimeout(() => focusTarget.focus(), 60);
    },

    onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'Escape') {
        const scrim = document.querySelector('.scrim');
        if (scrim) {
          scrim.classList.add('is-closing');
          setTimeout(() => scrim.remove(), 300);
        }
        return;
      }
      if (typing) return;
      const map = { 1: 'home', 2: 'draw', 3: 'checkin', 4: 'review', 5: 'settings' };
      if (map[e.key]) {
        this.go(map[e.key]);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'h') this.go('home');
      if (key === 'd') this.go('draw');
      if (key === 'c') this.go('checkin');
      if (key === 'r') this.go('review');
    },

    async exportData() {
      const payload = Store.exportJSON();
      try {
        if (global.cijian && global.cijian.exportData) return await global.cijian.exportData(payload);
      } catch (err) {
        global.UI.toast('导出失败：' + err.message, '✦');
        return { ok: false };
      }
      // 在浏览器里预览时的降级：直接下载
      const blob = new Blob([payload], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cijian-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      return { ok: true, path: '（已下载）' };
    },

    async version() {
      try {
        if (global.cijian && global.cijian.version) return await global.cijian.version();
      } catch (err) {
        /* ignore */
      }
      return { app: '0.1.0', electron: '—', chrome: '—', node: '—' };
    },

    async planVerify() {
      try {
        if (global.cijian && global.cijian.planVerify) return await global.cijian.planVerify();
      } catch (err) {
        /* ignore */
      }
      return { found: false, ok: false };
    },
  };

  global.Router = Router;
})(window);
