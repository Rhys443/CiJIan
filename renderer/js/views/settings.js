/* ============================================================
   此间 · 设置页
   提醒时间 / 主题切换 / 亮暗模式 / 数据导出 / 关于（含产品文档校验）
   ============================================================ */
(function (global) {
  'use strict';

  const { h, icon, reveal, stagger, magnetize } = global.UI;
  const { Store, THEMES, themeById } = global.CJ;

  const TIME_PRESETS = ['07:30', '09:00', '12:30', '20:00', '22:00'];

  function render(ctx) {
    const cycle = ctx.cycle;
    const settings = Store.state.settings;
    const theme = themeById(cycle.theme);

    const wrap = h('div', { class: 'view-inner' });
    wrap.appendChild(
      h(
        'div',
        { class: 'page-head' },
        h('div', { class: 'page-head__kicker' }, h('i'), h('span', { text: 'SETTINGS · 设置' })),
        h('h1', {}, '让它', h('em', { text: '安静地陪着' }), '你'),
        h('p', { text: '提醒永远不超过 2 次/天，语气永远是邀请而不是催促；所有数据都只保存在这台电脑上。' })
      )
    );

    const box = h('div', { class: 'settings' });

    /* --- 提醒 --- */
    const timeRow = h('div', { class: 'theme-picker', style: { gridTemplateColumns: 'repeat(5, 1fr)' } });
    TIME_PRESETS.forEach((t) => {
      timeRow.appendChild(
        h(
          'button',
          {
            class: `theme-opt${settings.reminderTime === t ? ' on' : ''}`,
            style: { '--tc': 'var(--theme)', textAlign: 'center', padding: '12px 6px' },
            onclick: (e) => {
              settings.reminderTime = t;
              Store.save();
              timeRow.querySelectorAll('.theme-opt').forEach((n) => n.classList.remove('on'));
              e.currentTarget.classList.add('on');
              global.UI.toast(`每日提醒时间改为 ${t}`, '✦');
            },
          },
          h('div', { class: 'mono', text: t })
        )
      );
    });

    box.appendChild(
      card('提醒', [
        field('每日提醒时间', '默认早 9:00。产品文档规定：晨间提醒 1 次/天，20:00 若未打卡再温和提醒 1 次，仅此而已。', timeRow),
        field(
          '晨间提醒文案预览',
          '提醒的语气永远是「邀请」，不是「催促」。',
          h('div', { class: 'modal__quote', style: { maxWidth: '300px' } }, `「今天的卡已经洗好了，来看看抽到什么？」　·　${settings.reminderTime}`)
        ),
        field(
          '连续打卡提醒',
          '只在真的断签时提醒一次，文案是「昨天那张空着的相纸，今天要不要补上？」',
          toggle(settings.streakReminder, (v) => {
            settings.streakReminder = v;
            Store.save();
          })
        ),
      ])
    );

    /* --- 主题 --- */
    const themeRow = h('div', { class: 'theme-picker' });
    THEMES.forEach((t) => {
      themeRow.appendChild(
        h(
          'button',
          {
            class: `theme-opt${cycle.theme === t.id ? ' on' : ''}`,
            style: { '--tc': t.accent },
            onclick: () => {
              cycle.theme = t.id;
              cycle.keyword = t.name;
              Store.save();
              ctx.applyTheme();
              ctx.rerender();
              global.UI.toast(`主题切换到「${t.name}」`, t.glyph);
            },
          },
          h('div', { class: 'theme-opt__glyph', text: t.glyph }),
          h('div', { class: 'theme-opt__name', text: t.name }),
          h('div', { class: 'theme-opt__desc', text: t.category })
        )
      );
    });

    box.appendChild(
      card('周期主题', [
        field('当前主题', `「${theme.name}」· ${theme.tagline}　切换主题后，抽卡会从新的任务池里抽，已经收藏的相纸不受影响。`, themeRow),
      ])
    );

    /* --- 外观 --- */
    box.appendChild(
      card('外观', [
        field(
          '明暗模式',
          '暖纸是产品默认的纸感语言；暗房是暖褐的屏 + 琥珀的光；空间是近黑底 + 毛玻璃层级，偏冷、信息密度更高。',
          seg(
            [
              ['light', '浅色 · 暖纸'],
              ['dark', '深色 · 暗房'],
              ['spatial', '空间 · 玻璃'],
            ],
            settings.mode,
            (v) => {
              settings.mode = v;
              Store.save();
              ctx.applyMode();
            }
          )
        ),
        field(
          '减少动态效果',
          '打开后，显影、漂移的暖光和牌堆动画都会停下来。前庭敏感的用户建议打开。',
          toggle(settings.reduceMotion, (v) => {
            settings.reduceMotion = v;
            Store.save();
            document.documentElement.dataset.reduceMotion = v ? 'on' : 'off';
          })
        ),
      ])
    );

    /* --- 数据 --- */
    box.appendChild(
      card('数据', [
        field(
          '导出备份',
          '导出为一个 JSON 文件（含照片、感想、情绪标签）。产品文档要求：卸载前数据不丢失。',
          h(
            'button',
            {
              class: 'btn btn--quiet',
              onclick: async () => {
                const res = await ctx.exportData();
                if (res && res.ok) global.UI.toast('已经存到 ' + res.path, '✦');
                else if (res && res.canceled) global.UI.toast('取消了导出', '✦');
              },
            },
            icon('down', 14),
            h('span', { text: '导出 JSON' })
          )
        ),
        field(
          '重置演示数据',
          '把这一轮恢复成「已经走了 6 天」的初始状态，方便反复演示抽卡、打卡和回顾。',
          h(
            'div',
            { style: { display: 'flex', gap: '8px' } },
            h(
              'button',
              {
                class: 'btn btn--quiet',
                onclick: () => {
                  Store.reset(true);
                  ctx.applyTheme();
                  ctx.go('home');
                  global.UI.toast('已恢复到演示初始状态', '✦');
                },
              },
              icon('refresh', 14),
              h('span', { text: '恢复演示数据' })
            ),
            h(
              'button',
              {
                class: 'btn btn--quiet',
                onclick: () => {
                  Store.reset(false);
                  ctx.applyTheme();
                  ctx.go('home');
                  global.UI.toast('已清空：从第 1 天开始', '✦');
                },
              },
              icon('spark', 14),
              h('span', { text: '清空重来' })
            )
          )
        ),
      ])
    );

    /* --- 关于 --- */
    const about = h('div', { class: 'about' });
    about.appendChild(h('div', {}, h('b', { text: '此间 · 15天唤醒计划 · 桌面概念 Demo' })));
    const verifyLine = h('div', { class: 'verify' }, h('span', { class: 'faint', text: '正在校验产品文档…' }));
    about.appendChild(verifyLine);
    about.appendChild(
      h(
        'div',
        { style: { marginTop: '10px' } },
        '本 Demo 只实现产品文档中的 P0 主功能界面：15天周期管理、每日抽卡、拍立得打卡、打卡日历、回顾页与本地存储。',
        h('br'),
        'AI 润色与回顾摘要在正式版里调用 GLM-4-Flash / Kimi 免费额度；Demo 里为本地生成，不联网。'
      )
    );

    box.appendChild(card('关于', [about]));
    wrap.appendChild(box);

    requestAnimationFrame(async () => {
      reveal(wrap);
      stagger(wrap.querySelectorAll('.card, .field, .theme-opt'));
      magnetize(wrap.querySelector('.btn--primary'));
      const info = await ctx.version();
      verifyLine.innerHTML = '';
      verifyLine.appendChild(h('span', { class: 'faint', text: `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}` }));
      const res = await ctx.planVerify();
      verifyLine.appendChild(
        h(
          'span',
          { class: res && res.ok ? 'ok' : 'bad' },
          res && res.ok
            ? `✓ 产品规划文档校验通过（sha256 ${String(res.sha256).slice(0, 10)}…, ${res.bytes} 字节）`
            : res && res.found
            ? `⚠ 文档内容与预期不一致（实际 ${res.bytes} 字节）`
            : '⚠ 未找到产品规划文档（Demo 仍可正常使用）'
        )
      );
    });

    return wrap;
  }

  /* ---------------- 小组件 ---------------- */
  function card(title, children) {
    return h(
      'section',
      // data-light：设置页也要跟手光效。
      // 之前整个 settings.js 里一处 data-light 都没有，所以只有这一页是"死"的，
      // 跟首页 / 回顾 / 打卡那种跟手的光感完全割裂。
      { class: 'card', 'data-light': true, style: { padding: '8px 26px' } },
      h('div', { class: 'panel__title', style: { paddingTop: '18px' } }, h('span', { text: title }), h('span', { text: '' })),
      ...children
    );
  }

  function field(label, hint, control) {
    return h(
      'div',
      { class: 'field' },
      h('div', { class: 'field__label' }, h('b', { text: label }), hint ? h('span', { text: hint }) : null),
      h('div', { class: 'field__control' }, control)
    );
  }

  function toggle(on, onChange) {
    const node = h('button', { class: `switch${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false' });
    node.addEventListener('click', () => {
      const next = !node.classList.contains('on');
      node.classList.toggle('on', next);
      node.setAttribute('aria-pressed', next ? 'true' : 'false');
      onChange(next);
    });
    return node;
  }

  function seg(options, value, onChange) {
    const node = h('div', { class: 'seg' });
    options.forEach(([val, label]) => {
      node.appendChild(
        h(
          'button',
          {
            class: value === val ? 'on' : '',
            onclick: (e) => {
              node.querySelectorAll('button').forEach((n) => n.classList.remove('on'));
              e.currentTarget.classList.add('on');
              onChange(val);
            },
          },
          h('span', { text: label })
        )
      );
    });
    return node;
  }

  global.Views = global.Views || {};
  global.Views.settings = { title: '设置', render };
})(window);
