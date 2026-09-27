/* ============================================================
   此间 · 首页「今天」
   信息架构：今日任务 + 进度环 + 15天日历 + 连签徽章 + 温柔文案
   ============================================================ */
(function (global) {
  'use strict';

  const { h, icon, reveal, stagger, countUp, magnetize } = global.UI;
  const { Store, CYCLE_DAYS, themeById, taskOr, EMOTIONS } = global.CJ;
  const { fmtCN, fmtSlash } = global.CJ.utils;
  const { photo } = global.Photo;

  const QUIET_LINES = [
    ['不用想太多。抽一张，拍一张，写一句。', '此间 · 设计原则'],
    ['空白的那一格，也是你这一天的一部分。', '关于允许'],
    ['我们不做排行榜，因为你的十五天不需要和别人比。', '反沉迷设计'],
    ['照片只是载体，背面那几行字才是你真正的产出。', '产品理念'],
    ['慢一点没关系，拍立得本来就要等一会儿才显影。', '关于耐心'],
    ['十五天不是一个漫长的目标，是一个可以完整走完的小实验。', '周期设计'],
  ];

  function render(ctx) {
    const cycle = ctx.cycle;
    const day = ctx.day;
    const theme = themeById(cycle.theme);
    const stats = Store.stats(cycle);
    const streak = Store.streak(cycle);
    const badges = Store.badges(cycle);
    const todayTask = Store.currentDraw(cycle, day);
    const todayCheckin = Store.checkinOf(cycle, day);
    /* 第 16 天起这一轮就走完了：dayNumber 会一直钳在 15，
       抽卡和打卡都只会说「今天已经收藏好了」。
       没有出口的话用户就被永久关在最后一格里（见 Router.startNextCycle）。 */
    const cycleComplete = Store.isCycleComplete(cycle);

    const wrap = h('div', { class: 'view-inner' });

    /* ---------- 页头 ---------- */
    const hour = new Date().getHours();
    const greetWord = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

    wrap.appendChild(
      h(
        'div',
        { class: 'page-head' },
        h('div', { class: 'page-head__kicker' }, h('i'), h('span', { text: `CYCLE · ${theme.category}` })),
        cycleComplete
          ? h('h1', {}, '这十五天，', h('em', { text: '已经走完了' }))
          : h('h1', {}, `${greetWord}，今天是第 `, h('em', { text: String(day) }), ' 天'),
        h('p', {
          text: cycleComplete
            ? `${fmtCN(new Date())}　·　主题「${theme.name}」　·　十五天已经走完，要不要再走一轮，由你决定。`
            : `${fmtCN(new Date())}　·　主题「${theme.name}」　·　再走 ${CYCLE_DAYS - day} 天，这一轮就讲完了。`,
        })
      )
    );

    /* ---------- 主区 ---------- */
    const grid = h('div', { class: 'home-grid' });

    const circumference = 2 * Math.PI * 54;
    const percent = stats.done / CYCLE_DAYS;
    const ringArc = h('circle', {
      class: 'ring__arc',
      cx: '62',
      cy: '62',
      r: '54',
      'stroke-dasharray': String(circumference),
      'stroke-dashoffset': String(circumference),
    });
    const ringNum = h('div', { class: 'ring__num', text: '0' });

    const heroActions = h('div', { class: 'hero__actions' });
    const taskBlock = h('div', { class: 'hero__task' });

    if (cycleComplete) {
      /* 这一轮唯一的出口。放在最显眼的位置，但语气仍是邀请：
         「开始下一轮」要过一次确认，想歇几天再开始永远是可以的。 */
      taskBlock.appendChild(h('div', { class: 'hero__task-label' }, icon('spark', 13), h('span', { text: '这一轮已经收好了' })));
      taskBlock.appendChild(h('div', { class: 'hero__task-title', text: '十五张相纸，都留在这里了。' }));
      taskBlock.appendChild(
        h('p', { class: 'hero__task-guide', text: '下一轮随时可以开始，也可以先歇几天 —— 这里不催你。' })
      );
      heroActions.appendChild(mkBtn('开始下一轮', 'spark', 'primary', () => ctx.startNextCycle()));
      heroActions.appendChild(mkBtn('再看一遍这一轮', 'film', 'quiet', () => ctx.go('review')));
    } else if (todayCheckin) {
      taskBlock.appendChild(h('div', { class: 'hero__task-label' }, icon('check', 13), h('span', { text: '今天已经收藏好了' })));
      taskBlock.appendChild(
        h('div', { class: 'hero__task-title', text: global.Polaroid.truncate(taskOr(todayCheckin.taskId).title, 30) })
      );
      taskBlock.appendChild(
        h('p', { class: 'hero__task-guide', text: '去日历墙看看这张相纸，或者翻到背面重读当时写下的那句话。' })
      );
      heroActions.appendChild(mkBtn('去回顾里看这张相纸', 'film', 'primary', () => ctx.go('review')));
      heroActions.appendChild(mkBtn('回顾这一轮', 'film', 'quiet', () => ctx.go('review')));
    } else if (todayTask) {
      taskBlock.appendChild(h('div', { class: 'hero__task-label' }, icon('spark', 13), h('span', { text: '今天的卡已经洗好了' })));
      taskBlock.appendChild(h('div', { class: 'hero__task-title', text: todayTask.title }));
      taskBlock.appendChild(h('p', { class: 'hero__task-guide', text: `📷 ${todayTask.photoGuide}` }));
      heroActions.appendChild(mkBtn('去完成并打卡', 'camera', 'primary', () => ctx.go('checkin')));
      heroActions.appendChild(mkBtn('重看这张卡', 'draw', 'quiet', () => ctx.go('draw')));
      heroActions.appendChild(
        h(
          'span',
          { class: 'swap-note' },
          icon('clock', 12),
          h('span', { text: `写作提示：${global.Polaroid.truncate(todayTask.writingPrompt, 18)}` })
        )
      );
    } else {
      taskBlock.appendChild(h('p', { text: '今天的相纸还是空白的。' }));
      heroActions.appendChild(mkBtn('抽一张今日任务卡', 'draw', 'primary', () => ctx.go('draw')));
    }
    taskBlock.appendChild(heroActions);

    const hero = h(
      'section',
      { class: 'hero rise', 'data-light': true, style: { '--i': '0' } },
      h(
        'div',
        { class: 'hero__top' },
        h(
          'div',
          {},
          // 一轮走完之后「第 15 天」已经不是今天了，这里改回真实日期
          h('div', { class: 'hero__date', text: fmtSlash(cycleComplete ? new Date() : Store.dayDate(cycle, day)) }),
          h('div', { class: 'hero__greet' }, '这一轮，你已经填满 ', h('span', { class: 'accent', text: `${stats.done}` }), ' 张相纸'),
          h('div', {
            class: 'hero__sub',
            text: `${theme.tagline}　剩下 ${stats.empty} 格空着 —— 按时填满也好，空着也好，都是这十五天的形状。`,
          })
        ),
        h(
          'div',
          { class: 'ring', title: `已完成 ${stats.done} / ${CYCLE_DAYS} 天` },
          h('svg', { viewBox: '0 0 124 124' }, h('circle', { class: 'ring__track', cx: '62', cy: '62', r: '54' }), ringArc),
          h('div', { class: 'ring__mid' }, ringNum, h('div', { class: 'ring__label', text: `／ ${CYCLE_DAYS} 天` }))
        )
      ),
      taskBlock
    );

    requestAnimationFrame(() => {
      ringArc.setAttribute('stroke-dashoffset', String(circumference * (1 - percent)));
      countUp(ringNum, stats.done, 1200);
    });

    /* 15 天日历网格 */
    const gridCells = h('div', { class: 'grid15' });
    for (let n = 1; n <= CYCLE_DAYS; n += 1) {
      const rec = Store.checkinOf(cycle, n);
      // 一轮走完之后没有「今天」这一格：第 15 天不该再顶着今天的角标
      const isToday = n === day && !cycleComplete;
      const isFuture = n > day;
      const date = Store.dayDate(cycle, n);
      if (rec) {
        gridCells.appendChild(
          h(
            'button',
            {
              class: `cell${isToday ? ' cell--today' : ''}`,
              style: { '--i': String(n) },
              onclick: () => ctx.openDay(n),
              title: `${fmtSlash(date)} 第 ${n} 天`,
            },
            h('img', { class: 'cell__img', src: rec.photo || photo(rec.photoSeed || n * 977, 320), alt: '' }),
            h('div', { class: 'cell__scrim' }),
            h('div', { class: 'cell__day', text: `D${String(n).padStart(2, '0')}` }),
            h('div', { class: 'cell__foot', text: global.Polaroid.truncate(taskOr(rec.taskId).title, 12) })
          )
        );
      } else {
        gridCells.appendChild(
          h(
            'button',
            {
              class: `cell cell--empty${isToday ? ' cell--today' : ''}${isFuture ? ' cell--future' : ''}`,
              style: { '--i': String(n) },
              onclick: () => (isToday ? ctx.go(todayTask ? 'checkin' : 'draw') : ctx.openDay(n)),
              title: isToday ? '今天' : fmtSlash(date),
            },
            h('div', { class: 'cell__day', text: isToday ? '今天' : `D${String(n).padStart(2, '0')}` })
          )
        );
      }
    }

    const calendarPanel = h(
      'section',
      { class: 'card rise', 'data-light': true, style: { '--i': '1', padding: '26px' } },
      h('div', { class: 'section-title' }, h('h2', {}, '十五格相纸'), h('span', { text: `已填满 ${stats.done} · 空着 ${stats.empty}` })),
      gridCells
    );

    grid.appendChild(h('div', { class: 'home-left' }, hero, calendarPanel));

    /* ---------- 右栏 ---------- */
    const side = h('div', { class: 'side' });

    const flame = h('div', { class: 'streak__flame' });
    for (let i = 0; i < CYCLE_DAYS; i += 1) {
      flame.appendChild(h('i', { class: i < streak.best ? 'on' : '' }));
    }
    const streakNum = h('span', { class: 'streak__num', text: '0' });
    side.appendChild(
      h(
        'div',
        { class: 'panel rise', 'data-light': true, style: { '--i': '2' } },
        h('div', { class: 'panel__title' }, h('span', { text: '连续打卡' }), h('span', { text: `最长 ${streak.best} 天` })),
        h('div', { class: 'streak' }, streakNum, h('span', { class: 'streak__unit', text: '天未断' })),
        h('div', {
          class: 'streak__best',
          text: streak.current > 0 ? `从第 ${day - streak.current + 1} 天起，一直没有断。` : '今天再填一格，连签就重新开始。',
        }),
        flame
      )
    );
    requestAnimationFrame(() => countUp(streakNum, streak.current, 1000));

    const badgeRow = h('div', { class: 'badges' });
    badges.forEach((b, i) => {
      badgeRow.appendChild(
        h(
          'div',
          { class: `badge${b.unlocked ? ' on' : ''}`, style: { '--i': String(i) }, title: b.desc },
          h('div', { class: 'badge__glyph', text: b.glyph }),
          h('div', { class: 'badge__name', text: b.name })
        )
      );
    });
    side.appendChild(
      h(
        'div',
        { class: 'panel rise', 'data-light': true, style: { '--i': '3' } },
        h(
          'div',
          { class: 'panel__title' },
          h('span', { text: '徽章' }),
          h('span', { text: `${badges.filter((b) => b.unlocked).length} / 4` })
        ),
        badgeRow
      )
    );

    const tl = h('div', { class: 'tl' });
    const recent = [];
    for (let n = Math.max(1, day - 3); n <= Math.min(CYCLE_DAYS, day + 1); n += 1) recent.push(n);
    recent.reverse().forEach((n) => {
      const rec = Store.checkinOf(cycle, n);
      const isToday = n === day && !cycleComplete;
      const isFuture = n > day;
      const emo = rec ? EMOTIONS.find((e) => e.id === rec.emotion) || EMOTIONS[0] : null;
      tl.appendChild(
        h(
          'div',
          { class: `tl__row${rec ? ' done' : ''}${isToday ? ' today' : ''}` },
          h('span', { class: 'tl__dot' }),
          h(
            'div',
            { class: 'tl__text' },
            h('b', {
              text: rec
                ? global.Polaroid.truncate(taskOr(rec.taskId).title, 14)
                : isToday
                ? '今天 · 还空着'
                : isFuture
                ? '还没到'
                : '这一天在休息',
            }),
            h('span', { text: `第 ${n} 天　${rec ? emo.label : ''}` })
          )
        )
      );
    });
    side.appendChild(
      h(
        'div',
        { class: 'panel rise', 'data-light': true, style: { '--i': '4' } },
        h('div', { class: 'panel__title' }, h('span', { text: '最近几天' }), h('span', { text: '按时间' })),
        tl
      )
    );

    const qi = (day + cycle.startDate.length) % QUIET_LINES.length;
    side.appendChild(
      h(
        'div',
        { class: 'panel rise', 'data-light': true, style: { '--i': '5' } },
        h(
          'div',
          { class: 'quote' },
          icon('quote', 18),
          h('span', { text: QUIET_LINES[qi][0] }),
          h('span', { class: 'quote__by', text: `— ${QUIET_LINES[qi][1]}` })
        )
      )
    );

    grid.appendChild(side);
    wrap.appendChild(grid);

    requestAnimationFrame(() => {
      reveal(wrap);
      stagger(wrap.querySelectorAll('.rise'));
      magnetize(wrap.querySelector('.btn--primary'));
    });

    return wrap;
  }

  function mkBtn(label, iconName, variant, onClick) {
    return h('button', { class: `btn btn--${variant}`, onclick: onClick }, icon(iconName, 15), h('span', { text: label }));
  }

  global.Views = global.Views || {};
  global.Views.home = { title: '今天', render };
})(window);
