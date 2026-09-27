/* ============================================================
   此间 · 回顾（原「回顾」+「日历墙」合并）
   信息架构：
     1. 头部：主题、周期区间、填满/空着/字数
     2. 相纸墙：行星环（15 张相纸绕环缓慢自转，悬停停下浮起放大）
        可切换成网格视图，方便快速定位某一天
     3. 节奏统计：填满 / 最长连续 / 最常打卡 / 平均每张
     4. 情绪轨迹：Canvas 手绘曲线
     5. 回顾文字：本地生成，逐字浮现
     6. 心理安全提示（产品文档 9.4）
   设计原则（产品文档 7.3）：不打分、不评级、强调过程、允许空白
   ============================================================ */
(function (global) {
  'use strict';

  const { h, icon, reveal, stagger, countUp, typeIn, wait, magnetize } = global.UI;
  const { Store, CYCLE_DAYS, themeById, taskById, EMOTIONS } = global.CJ;
  const { fmtSlash } = global.CJ.utils;
  const { photo } = global.Photo;

  const VIEWS = [
    { id: 'ring', label: '行星环', hint: '十五张相纸绕成一圈，慢慢转' },
    { id: 'grid', label: '网格', hint: '一眼看完整轮节奏' },
  ];

  function render(ctx) {
    const cycle = ctx.cycle;
    const theme = themeById(cycle.theme);
    const stats = Store.stats(cycle);
    const streak = Store.streak(cycle);
    const records = Store.state.checkins
      .filter((c) => c.cycleId === cycle.id)
      .sort((a, b) => a.dayNumber - b.dayNumber);

    const wrap = h('div', { class: 'view-inner' });
    let ring = null;
    let gridBuilt = false;
    let currentView = 'ring';

    /* ---------------- 1. 头部 ---------------- */
    wrap.appendChild(
      h(
        'section',
        { class: 'review-hero rise', 'data-light': true, style: { '--i': '0' } },
        h('div', { class: 'page-head__kicker' }, h('i'), h('span', { text: `REVIEW · ${theme.glyph} ${theme.name}` })),
        h('h1', { class: 'review-hero__title' }, '你的「', theme.name, '」这 ', String(stats.done), ' 天'),
        h(
          'div',
          { class: 'review-hero__meta' },
          h(
            'em',
            {},
            icon('calendar', 14),
            h('span', { text: `${fmtSlash(Store.dayDate(cycle, 1))} — ${fmtSlash(Store.dayDate(cycle, CYCLE_DAYS))}` })
          ),
          h('em', {}, icon('film', 14), h('span', { text: `填满 ${stats.done} 张 · 空着 ${stats.empty} 张` })),
          h('em', {}, icon('spark', 14), h('span', { text: `${stats.words} 个字留在相纸背面` }))
        )
      )
    );

    /* ---------------- 2. 相纸墙（行星环 / 网格） ---------------- */
    const progressBar = h('i');
    const ringHost = h('div', { class: 'ring-host' });
    const gridHost = h('div', { class: 'grid-host', style: { display: 'none' } });
    const hintRow = h(
      'div',
      { class: 'ring-hint' },
      h('span', {}, icon('refresh', 13), h('span', { text: '自动旋转 · 悬停停下' })),
      h('span', {}, icon('pencil', 13), h('span', { text: '悬停放大后可翻背面' })),
      h('span', {}, icon('film', 13), h('span', { text: '点击看大图' }))
    );
    const progressWrap = h('div', { class: 'ring-progress' }, progressBar);

    const seg = h('div', { class: 'seg' });
    VIEWS.forEach((v) => {
      seg.appendChild(
        h('button', { class: v.id === currentView ? 'on' : '', title: v.hint, onclick: () => switchView(v.id) }, h('span', { text: v.label }))
      );
    });

    const wallSection = h(
      'section',
      { class: 'ring-block rise', 'data-light': true, style: { '--i': '1' } },
      h(
        'div',
        { class: 'wall-head' },
        h('h3', {}, '十五张相纸'),
        h('div', { class: 'wall-head__right' }, seg, h('span', { class: 'faint', text: `${stats.done} / ${CYCLE_DAYS}` }))
      ),
      ringHost,
      gridHost,
      hintRow,
      progressWrap
    );
    wrap.appendChild(wallSection);

    function buildRing() {
      ringHost.innerHTML = '';
      ring = global.PlanetRing.create({
        cycle,
        records,
        size: 'md',
        onOpen: (n) => ctx.openDay(n),
        onProgress: (p) => {
          progressBar.style.width = `${(p * 100).toFixed(1)}%`;
        },
      });
      ringHost.appendChild(ring.el);
      requestAnimationFrame(() => ring.layout());
    }

    function buildGrid() {
      gridHost.innerHTML = '';
      const grid = h('div', { class: 'grid15' });
      for (let n = 1; n <= CYCLE_DAYS; n += 1) {
        const rec = Store.checkinOf(cycle, n);
        const date = Store.dayDate(cycle, n);
        const isToday = n === ctx.day;
        if (rec) {
          grid.appendChild(
            h(
              'button',
              {
                class: `cell${isToday ? ' cell--today' : ''}`,
                style: { '--i': String(n - 1) },
                onclick: () => ctx.openDay(n),
                title: `${fmtSlash(date)} 第 ${n} 天`,
              },
              h('img', { class: 'cell__img', src: rec.photo || photo(rec.photoSeed || n * 977, 320), alt: '' }),
              h('div', { class: 'cell__scrim' }),
              h('div', { class: 'cell__day', text: `D${String(n).padStart(2, '0')}` }),
              h('div', { class: 'cell__foot', text: global.Polaroid.truncate(taskById(rec.taskId).title, 12) })
            )
          );
        } else {
          grid.appendChild(
            h(
              'button',
              {
                class: `cell cell--empty${isToday ? ' cell--today' : ''}${n > ctx.day ? ' cell--future' : ''}`,
                style: { '--i': String(n - 1) },
                onclick: () => global.UI.toast('这一天没有打卡记录', '✦'),
                title: fmtSlash(date),
              },
              h('div', { class: 'cell__day', text: isToday ? '今天' : `D${String(n).padStart(2, '0')}` })
            )
          );
        }
      }
      gridHost.appendChild(
        h(
          'div',
          {},
          h(
            'div',
            { class: 'legend', style: { marginBottom: '16px' } },
            h('span', {}, h('i', { class: 'on' }), '已收藏'),
            h('span', {}, h('i', { class: 'today' }), '今天'),
            h('span', {}, h('i', { class: 'empty' }), '空着')
          ),
          grid
        )
      );
      gridBuilt = true;
    }

    function switchView(id) {
      if (id === currentView) return;
      currentView = id;
      seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', VIEWS[i].id === id));
      const showRing = id === 'ring';
      ringHost.style.display = showRing ? '' : 'none';
      gridHost.style.display = showRing ? 'none' : '';
      hintRow.style.display = showRing ? '' : 'none';
      progressWrap.style.display = showRing ? '' : 'none';
      if (showRing) {
        if (ring) ring.destroy();
        buildRing();
      } else if (!gridBuilt) {
        buildGrid();
      }
      global.UI.toast(showRing ? '行星环：相纸正在转' : '网格视图：一眼看完', '✦');
    }

    buildRing();

    /* ---------------- 3. 节奏统计 ---------------- */
    const statsRow = h('div', { class: 'stats' });
    const statDefs = [
      ['填满', stats.done, '张', `十五格里填了 ${stats.done} 格`, stats.done / CYCLE_DAYS],
      ['最长连续', streak.best, '天', streak.best >= 3 ? '已经形成了一点惯性' : '断断续续也是节奏', streak.best / CYCLE_DAYS],
      ['最常打卡', stats.topSlot, '', '这是你最容易安静下来的时段', 1],
      ['平均每张', records.length ? Math.round(stats.words / records.length) : 0, '字', '背面文字的密度', 1],
    ];
    statDefs.forEach((s, i) => {
      const num = h('span', { class: 'stat__num', text: '0' });
      const bar = h('i', { style: { width: '0%' } });
      statsRow.appendChild(
        h(
          'div',
          { class: 'stat rise', 'data-light': true, style: { '--i': String(i + 2) } },
          h('div', { class: 'stat__label', text: s[0] }),
          h('div', { class: 'stat__value' }, num, h('span', { class: 'stat__unit', text: s[2] })),
          h('div', { class: 'stat__hint', text: s[3] }),
          h('div', { class: 'stat__bar' }, h('div', { class: 'bar' }, bar))
        )
      );
      requestAnimationFrame(() => {
        if (typeof s[1] === 'number') countUp(num, s[1], 1100);
        else num.textContent = s[1];
        bar.style.width = `${Math.max(4, Math.min(100, s[4] * 100))}%`;
      });
    });
    wrap.appendChild(statsRow);

    /* ---------------- 4. 情绪轨迹 ---------------- */
    const canvas = h('canvas', { class: 'trace__canvas' });
    const traceLegend = h('div', { class: 'trace__legend' });
    EMOTIONS.forEach((e) => {
      traceLegend.appendChild(h('span', {}, h('i', { style: { background: e.color } }), e.label));
    });
    const traceSection = h(
      'section',
      { class: 'trace rise', 'data-light': true, style: { '--i': '6' } },
      h('div', { class: 'trace__head' }, h('h3', {}, '情绪轨迹'), h('span', { text: '由每张相纸背面的情绪标签连成' })),
      canvas,
      traceLegend
    );
    wrap.appendChild(traceSection);

    /* ---------------- 5. 回顾文字 ---------------- */
    const summaryText = h('p', { class: 'summary__text' });
    wrap.appendChild(
      h(
        'section',
        { class: 'summary rise', 'data-light': true, style: { '--i': '7' } },
        h(
          'div',
          { class: 'summary__head' },
          h('h3', {}, icon('spark', 17), h('span', { text: '这十五天，你留下的形状' })),
          h('span', { class: 'faint', text: records.length ? '本地生成 · 不联网' : '还没有内容' })
        ),
        summaryText,
        h('div', { class: 'summary__by', text: '这段话只使用你自己的文字，没有套用任何模板感言。' })
      )
    );

    /* ---------------- 6. 底部动作 ---------------- */
    wrap.appendChild(
      h(
        'div',
        { class: 'review-foot rise', 'data-light': true, style: { '--i': '8' } },
        h('h3', { text: stats.done >= CYCLE_DAYS ? '十五张都满了' : '这一轮还没走完' }),
        h('p', {
          text:
            stats.done >= CYCLE_DAYS
              ? '按照产品设计，这里会强制休息一天才能开启下一个十五天 —— 不许连着卷自己。'
              : `还剩 ${CYCLE_DAYS - stats.done} 张相纸。不着急，明天再继续。`,
        }),
        h(
          'div',
          { class: 'review-foot__row' },
          mkBtn('回到今天', 'home', 'primary', () => ctx.go('home')),
          mkBtn('转到今天那张', 'refresh', 'quiet', () => {
            if (currentView !== 'ring') switchView('ring');
            if (ring) ring.rotateTo(ctx.day);
          }),
          mkBtn('导出数据备份', 'down', 'quiet', async () => {
            const res = await ctx.exportData();
            if (res && res.ok) global.UI.toast('已经存到 ' + res.path, '✦');
            else if (res && res.canceled) global.UI.toast('取消了导出', '✦');
          })
        )
      )
    );

    wrap.appendChild(
      h(
        'div',
        { class: 'safety' },
        '如果你在写下某些话时感到难以承受，请记得可以联系专业帮助：全国心理援助热线 12356（24 小时）。此间不会评判你写下的任何内容。'
      )
    );

    /* ---------------- 入场与 Canvas ---------------- */
    const summary = buildSummary(records, stats, theme, streak);

    requestAnimationFrame(async () => {
      reveal(wrap);
      stagger(wrap.querySelectorAll('.rise'));
      magnetize(wrap.querySelector('.btn--primary'));
      await wait(300);
      await typeIn(summaryText, summary, 26);
      summaryText.classList.add('is-done');
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          drawTrace(canvas, records);
          io.disconnect();
        }
      });
    });
    requestAnimationFrame(() => io.observe(traceSection));

    return wrap;
  }

  /* ---------------- 情绪轨迹：Canvas 手绘曲线 ---------------- */
  function drawTrace(canvas, records) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(320, rect.width);
    const H = 190;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const padX = 34;
    const padY = 26;
    const n = CYCLE_DAYS;
    const xOf = (i) => padX + (i * (W - padX * 2)) / (n - 1);
    const yOf = (score) => H - padY - (score / 100) * (H - padY * 2);

    const paintGrid = () => {
      ctx.save();
      ctx.strokeStyle = 'rgba(140, 118, 96, 0.16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      [0, 50, 100].forEach((v) => {
        ctx.beginPath();
        ctx.moveTo(padX, yOf(v));
        ctx.lineTo(W - padX, yOf(v));
        ctx.stroke();
      });
      ctx.restore();
    };

    const points = [];
    for (let i = 0; i < n; i += 1) {
      const rec = records.find((r) => r.dayNumber === i + 1);
      if (rec) {
        const e = EMOTIONS.find((x) => x.id === rec.emotion) || EMOTIONS[0];
        points.push({ x: xOf(i), y: yOf(e.score), color: e.color, day: i + 1, label: e.label });
      } else {
        points.push({ x: xOf(i), y: null, day: i + 1 });
      }
    }
    const real = points.filter((p) => p.y !== null);
    if (!real.length) {
      paintGrid();
      ctx.fillStyle = 'rgba(140,118,96,0.5)';
      ctx.font = '13px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('还没有打卡记录，这条线会随着你的十五天长出来', W / 2, H / 2);
      return;
    }

    const path = new Path2D();
    path.moveTo(real[0].x, real[0].y);
    for (let i = 0; i < real.length - 1; i += 1) {
      const p0 = real[Math.max(0, i - 1)];
      const p1 = real[i];
      const p2 = real[i + 1];
      const p3 = real[Math.min(real.length - 1, i + 2)];
      path.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        p2.x,
        p2.y
      );
    }
    const area = new Path2D(path);
    area.lineTo(real[real.length - 1].x, H - padY);
    area.lineTo(real[0].x, H - padY);
    area.closePath();

    const grad = ctx.createLinearGradient(0, padY, 0, H - padY);
    grad.addColorStop(0, 'rgba(212, 101, 63, 0.26)');
    grad.addColorStop(1, 'rgba(212, 101, 63, 0)');

    let t0 = null;
    const DUR = 1500;
    const total = 3000;

    function frame(now) {
      if (t0 === null) t0 = now;
      const t = Math.min(1, (now - t0) / DUR);
      const eased = 1 - Math.pow(1 - t, 3);
      ctx.clearRect(0, 0, W, H);
      paintGrid();

      ctx.save();
      ctx.fillStyle = grad;
      ctx.globalAlpha = eased;
      ctx.fill(area);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = '#c85f36';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([total, total]);
      ctx.lineDashOffset = total * (1 - eased);
      ctx.shadowColor = 'rgba(200, 95, 54, 0.35)';
      ctx.shadowBlur = 10;
      ctx.stroke(path);
      ctx.restore();

      real.forEach((p, i) => {
        const appear = Math.max(0, Math.min(1, eased * real.length - i));
        if (appear <= 0) return;
        ctx.save();
        ctx.globalAlpha = appear;
        ctx.fillStyle = '#fffdf8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.6 * (0.6 + 0.4 * appear), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
      });

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        ctx.save();
        ctx.fillStyle = 'rgba(140, 118, 96, 0.75)';
        ctx.font = '10px "Cascadia Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        real.forEach((p) => ctx.fillText(`D${String(p.day).padStart(2, '0')}`, p.x, H - 8));
        ctx.restore();
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- 本地「AI 摘要」 ----------------
     正式版这里会调 GLM-4-Flash / Kimi；Demo 用本地规则，
     但它读的是用户自己的文字，所以读起来仍然像有人在旁边说话。 */
  function buildSummary(records, stats, theme, streak) {
    if (!records.length) {
      return '这一轮还没有开始。等你抽到第一张卡、拍下第一张照、写下一句话之后，这里会慢慢长出属于你的形状。';
    }
    const all = records.map((r) => r.reflection).filter(Boolean).join('');
    const first = records[0];
    const last = records[records.length - 1];

    const keywords = [
      ['身体', /(身体|脚|手|呼吸|走|跑|拉伸|累|酸)/],
      ['光', /(光|亮|阳|太阳|晨|黄昏|灯)/],
      ['安静', /(安静|静|慢|停|坐|发呆)/],
      ['人', /(她|他|ta|朋友|家人|陌生人|妈|爸)/],
      ['自己', /(自己|我|原来|其实)/],
      ['时间', /(时间|以前|过去|小时候|未来|后来)/],
      ['颜色', /(颜色|蓝|绿|黄|红|白)/],
    ];
    const hits = keywords.filter(([, re]) => re.test(all)).map(([w]) => w);
    const lines = [];

    lines.push(
      `开始那天，你写的是「${clip(first.reflection, 26)}」。到第 ${last.dayNumber} 天，你写的是「${clip(last.reflection, 26)}」。`
    );

    const emoSet = {};
    records.forEach((r) => {
      emoSet[r.emotion] = (emoSet[r.emotion] || 0) + 1;
    });
    const emoNames = Object.entries(emoSet)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => (EMOTIONS.find((e) => e.id === id) || EMOTIONS[0]).label);
    lines.push(
      emoNames.length > 1
        ? `这 ${records.length} 天里，你留下的情绪从「${emoNames[0]}」慢慢流向「${emoNames[emoNames.length - 1]}」${
            emoNames.length > 2 ? `，中间还夹着几段${emoNames[1]}` : ''
          }。`
        : `这 ${records.length} 天里，你几乎一直是「${emoNames[0]}」的状态 —— 稳定本身也是一种答案。`
    );

    if (hits.length) {
      lines.push(
        `你反复写到「${hits.slice(0, 3).join('」「')}」${hits.includes('光') ? '，光好像是你最常用的比喻' : ''}${
          hits.includes('身体') ? '，而你似乎更愿意从身体出发去理解自己' : ''
        }。`
      );
    }

    if (stats.empty > 0) {
      lines.push(
        `中间有 ${stats.empty} 天你没有填。它们空在那里，没有变成欠账 —— 你照样走完了这一轮，这件事本身就说明了一些什么。`
      );
    } else {
      lines.push('十五格一天都没落下。这种「每天都在」的坚持，比任何一次用力过猛都更难。');
    }

    if (streak.best >= 3) lines.push(`最长的一段连续是 ${streak.best} 天。`);
    lines.push(`主题是「${theme.name}」：${theme.tagline}你今天写下的这些话，比任务本身更值得留下来。`);

    return lines.join('');
  }

  function clip(s, n) {
    const str = String(s || '').replace(/\s+/g, '');
    return str.length > n ? `${str.slice(0, n)}…` : str;
  }

  function mkBtn(label, iconName, variant, onClick) {
    return h('button', { class: `btn btn--${variant}`, onclick: onClick }, icon(iconName, 15), h('span', { text: label }));
  }

  global.Views = global.Views || {};
  global.Views.review = { title: '回顾', render };
})(window);
