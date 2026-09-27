/* ============================================================
   此间 · 抽卡页
   动画序列：洗牌(scatter) → 发牌(deal) → 悬停升温 → 选中放大
            → 3D 翻卡 → 其余牌淡出 → 任务披露
   ============================================================ */
(function (global) {
  'use strict';

  const { h, icon, wait, stagger, burst, magnetize } = global.UI;
  const { Store, themeById, tasksOf, taskOr } = global.CJ;

  function render(ctx) {
    const cycle = ctx.cycle;
    const day = ctx.day;
    const theme = themeById(cycle.theme);
    const existing = Store.checkinOf(cycle, day);
    const drawn = Store.currentDraw(cycle, day);

    const wrap = h('div', { class: 'view-inner' });
    const stage = h('div', { class: 'draw-stage' });

    wrap.appendChild(
      h(
        'div',
        { class: 'page-head' },
        h('div', { class: 'page-head__kicker' }, h('i'), h('span', { text: `DRAW · ${theme.category}` })),
        h('h1', {}, '今天抽到哪一张，', h('em', { text: '交给运气' })),
        h('p', {
          text: `从「${theme.name}」的 ${tasksOf(cycle.theme).length} 张任务卡里挑一张。同一轮不会重复；每张牌背面都写着一个给你的问题。`,
        })
      )
    );

    if (existing) {
      stage.appendChild(
        h(
          'div',
          { class: 'reveal' },
          h('span', { class: 'reveal__kicker' }, icon('check', 13), h('span', { text: '今天已经收藏好了' })),
          h('div', { class: 'reveal__title', text: global.Polaroid.truncate(taskOr(existing.taskId).title, 40) }),
          h('p', { class: 'muted', text: '每天的相纸只有一张。想再看它，去日历墙。' }),
          h(
            'div',
            { class: 'reveal__foot' },
            mkBtn('去回顾里看这张相纸', 'film', 'primary', () => ctx.go('review')),
            mkBtn('回到今天', 'home', 'quiet', () => ctx.go('home'))
          ),
          h('div', { class: 'reveal__note', text: '明天会有新的一张卡等着你。' })
        )
      );
      wrap.appendChild(stage);
      return wrap;
    }

    if (drawn) {
      stage.appendChild(resultPanel(ctx, drawn, cycle, day));
      wrap.appendChild(stage);
      requestAnimationFrame(() => stagger(wrap.querySelectorAll('.reveal__block, .reveal__foot .btn')));
      return wrap;
    }

    /* ---------------- 未抽卡：牌堆交互 ---------------- */
    const deckZone = h('div', { class: 'deck-zone' });
    const deck = h('div', { class: 'deck' });
    const hint = h('div', { class: 'deck-hint', text: '选一张。相信你的第一眼。' });
    const actions = h('div', { class: 'draw-actions' });
    let locked = false;

    const used = new Set(Object.values(cycle.draws || {}).map((d) => d.taskId));
    const pool = tasksOf(cycle.theme).filter((t) => !used.has(t.id));
    const candidates = shuffle(pool.length ? pool : tasksOf(cycle.theme)).slice(0, 3);

    const cards = candidates.map((task, i) => {
      const back = h(
        'div',
        { class: 'tcard__face tcard__face--back' },
        h('div', { class: 'tcard__emblem' }, icon('spark', 30), h('span', { text: theme.name }))
      );
      const front = h(
        'div',
        { class: 'tcard__face tcard__face--front' },
        h(
          'div',
          { class: 'tcard__kicker' },
          h('span', { text: `${theme.glyph} ${theme.category}` }),
          h('span', { class: 'tcard__stars', text: '★'.repeat(task.difficulty) + '☆'.repeat(3 - task.difficulty) })
        ),
        h('div', { class: 'tcard__corner', text: `No.${String(task.index).padStart(2, '0')}` }),
        h('div', { class: 'tcard__rule' }),
        h('div', { class: 'tcard__title', text: task.title }),
        h('div', { class: 'tcard__guide' }, h('b', { text: '拍照指引' }), h('span', { text: task.photoGuide }))
      );
      const card = h('div', { class: 'tcard', dataset: { idx: String(i) } }, h('div', { class: 'tcard__inner' }, back, front));
      return { el: card, task };
    });

    deck.appendChild(h('div', { class: 'deck__stack' }));
    cards.forEach((c) => deck.appendChild(c.el));
    deckZone.appendChild(deck);
    stage.appendChild(deckZone);
    stage.appendChild(hint);
    stage.appendChild(actions);

    actions.appendChild(mkBtn('洗一次牌', 'refresh', 'quiet', () => runShuffle(false)));
    actions.appendChild(h('span', { class: 'swap-note' }, icon('spark', 12), h('span', { text: '每轮任务不会重复' })));

    wrap.appendChild(stage);

    function layouts() {
      const n = cards.length;
      const spread = 176;
      return cards.map((_, i) => {
        const offset = i - (n - 1) / 2;
        return { x: offset * spread, y: Math.abs(offset) * 16, rot: offset * 7.5, z: -Math.abs(offset) * 40 };
      });
    }

    function applyLayout(instant) {
      const L = layouts();
      cards.forEach((c, i) => {
        const l = L[i];
        if (instant) c.el.style.transition = 'none';
        c.el.style.setProperty('--x', `${l.x}px`);
        c.el.style.setProperty('--y', `${l.y}px`);
        c.el.style.setProperty('--rot', `${l.rot}deg`);
        c.el.style.setProperty('--z', `${l.z}px`);
        if (instant) requestAnimationFrame(() => (c.el.style.transition = ''));
      });
    }

    function deal() {
      applyLayout(false);
      deck.classList.add('is-dealing');
      cards.forEach((c, i) => {
        c.el.classList.remove('is-dealt', 'is-scattering');
        c.el.style.setProperty('--deal-delay', `${i * 110}ms`);
        void c.el.offsetWidth;
        c.el.classList.add('is-dealt');
      });
      setTimeout(() => deck.classList.remove('is-dealing'), 700);
      hint.classList.remove('hide');
    }

    async function runShuffle(first) {
      if (locked) return;
      locked = true;
      hint.classList.add('hide');
      applyLayout(true);
      cards.forEach((c, i) => {
        c.el.style.setProperty('--deal-delay', `${i * 45}ms`);
        c.el.classList.remove('is-dealt');
        void c.el.offsetWidth;
        c.el.classList.add('is-scattering');
      });
      deck.animate(
        [
          { transform: 'translateY(0) rotate(0deg)' },
          { transform: 'translateY(-10px) rotate(-1.5deg)' },
          { transform: 'translateY(4px) rotate(1.2deg)' },
          { transform: 'translateY(0) rotate(0deg)' },
        ],
        { duration: 620, easing: 'cubic-bezier(0.22,1,0.36,1)' }
      );
      await wait(first ? 700 : 620);
      cards.forEach((c) => c.el.classList.remove('is-scattering'));
      locked = false;
      if (!first) deal();
    }

    /* --- 选牌 --- */
    function pick(index) {
      if (locked) return;
      locked = true;
      const chosen = cards[index];
      hint.classList.add('hide');
      cards.forEach((c, i) => {
        if (i === index) return;
        c.el.classList.add('is-dimmed');
        c.el.style.setProperty('--x', `${(i < index ? -1 : 1) * 300}px`);
        c.el.style.setProperty('--y', '150px');
        c.el.style.setProperty('--rot', `${(i < index ? -1 : 1) * 26}deg`);
        c.el.style.opacity = '0';
      });
      chosen.el.classList.remove('is-dealt');
      chosen.el.classList.add('is-picked');
      chosen.el.style.setProperty('--x', '0px');
      chosen.el.style.setProperty('--y', '-26px');
      chosen.el.style.setProperty('--rot', '0deg');
      chosen.el.style.setProperty('--z', '120px');

      setTimeout(() => {
        chosen.el.classList.add('is-revealed');
        burst(deckZone, { count: 22, power: 150 });
      }, 520);

      setTimeout(() => {
        /* 必须把用户点开的这张传下去。
           以前是 Store.drawCard(cycle, day) —— 不传 task，
           drawCard 就自己在候选池里又随机抽一张写进存档，
           于是"翻开的卡"和"记进去的卡"永远是两张不同的卡。 */
        Store.drawCard(cycle, day, chosen && chosen.task && chosen.task.id);
        stage.animate(
          [
            { opacity: 1, filter: 'blur(0px)' },
            { opacity: 0, filter: 'blur(9px)' },
          ],
          { duration: 420, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' }
        );
        setTimeout(() => ctx.rerender(), 430);
      }, 1850);
    }

    cards.forEach((c, i) => {
      c.el.addEventListener('click', () => pick(i));
      c.el.addEventListener('mouseenter', () => {
        if (locked) return;
        const L = layouts();
        c.el.style.setProperty('--y', `${L[i].y - 18}px`);
        c.el.style.setProperty('--rot', `${L[i].rot * 0.4}deg`);
        c.el.style.setProperty('--z', '80px');
      });
      c.el.addEventListener('mouseleave', () => {
        if (locked) return;
        applyLayout(false);
      });
    });

    requestAnimationFrame(async () => {
      await runShuffle(true);
      await wait(180);
      deal();
      magnetize(actions.querySelector('.btn'));
      stagger([hint, actions]);
    });

    return wrap;
  }

  /* ---------------- 任务披露面板 ---------------- */
  function resultPanel(ctx, task, cycle, day) {
    const theme = themeById(cycle.theme);
    const canRedraw = Store.canRedraw(cycle, day);

    const redrawBtn = mkBtn(canRedraw ? '换一张（今日还剩 1 次）' : '今天已经换过一张了', 'refresh', 'quiet', () => {
      if (!Store.canRedraw(cycle, day)) {
        global.UI.toast('今天的换卡机会已经用掉了', '✦');
        return;
      }
      Store.redraw(cycle, day);
      global.UI.toast('换好了，重新洗了一张', '✦');
      ctx.rerender();
    });
    if (!canRedraw) redrawBtn.setAttribute('disabled', '');

    const levelText =
      task.difficulty === 1 ? '轻松，适合状态差的一天' : task.difficulty === 2 ? '中等，需要走出一点点舒适区' : '挑战，可能需要一点勇气';

    return h(
      'div',
      { class: 'reveal' },
      h(
        'span',
        { class: 'reveal__kicker' },
        icon('spark', 13),
        h('span', { text: `第 ${day} 天的卡 · No.${String(task.index).padStart(2, '0')}` })
      ),
      h('div', { class: 'reveal__title', text: task.title }),
      h(
        'div',
        { class: 'reveal__grid' },
        h('div', { class: 'reveal__block' }, h('b', { text: 'PHOTO · 拍照指引' }), h('p', { text: task.photoGuide })),
        h('div', { class: 'reveal__block' }, h('b', { text: 'WRITE · 背面写什么' }), h('p', { text: task.writingPrompt })),
        h('div', { class: 'reveal__block' }, h('b', { text: 'THEME · 主题' }), h('p', { text: `${theme.glyph} ${theme.name} · ${theme.category}` })),
        h(
          'div',
          { class: 'reveal__block' },
          h('b', { text: 'LEVEL · 轻微不适感' }),
          h('p', { text: `${'★'.repeat(task.difficulty)}${'☆'.repeat(3 - task.difficulty)}　${levelText}` })
        )
      ),
      h(
        'div',
        { class: 'reveal__foot' },
        mkBtn('去完成并打卡', 'camera', 'primary', () => ctx.go('checkin')),
        redrawBtn,
        mkBtn('重看一次抽卡动画', 'draw', 'quiet', () => {
          Store.clearDraw(cycle, day);
          ctx.rerender();
        }),
        mkBtn('回到今天', 'home', 'ghost', () => ctx.go('home'))
      ),
      h('div', { class: 'reveal__note', text: '每条任务都能在 15 分钟内完成，不需要花钱，也不需要别人配合。' })
    );
  }

  function mkBtn(label, iconName, variant, onClick) {
    return h('button', { class: `btn btn--${variant}`, onclick: onClick }, icon(iconName, 15), h('span', { text: label }));
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  global.Views = global.Views || {};
  global.Views.draw = { title: '抽卡', render };
})(window);
