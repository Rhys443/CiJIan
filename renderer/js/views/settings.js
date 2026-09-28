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

    /* --- 周期主题 ---
        用户原话：「我不需要 3 个板块来负责同一个页面的主题色问题。」
        颜色那一半早就搬去「外观」板块了；**任务池这一半也搬走了** ——
        它现在在左下角 TODAY 卡点开的日历里。
        理由：它和日历回答的是同一件事（这一轮在练什么、走到哪了），
        是同一条链上的信息；设置页只留真正的配置。
        （之前这里是 themeRow 那一整块选主题的 UI，现在整个撤掉。） */

    /* --- 外观：一个板块，三行 ---
        强调色 / 明暗 / 底图 —— 三者是一条链，不是三件互不相干的事：
          底图决定背景，并自带一个推荐强调色；
          强调色可以手动覆盖它（「自动」就是听底图的）；
          明暗只决定玻璃厚薄与取色档位，不再决定颜色。 */
    const ACCENTS = [
      ['auto', '自动'],
      ['red', '红'],
      ['orange', '橙'],
      ['yellow', '黄'],
      ['green', '绿'],
      ['cyan', '青'],
      ['blue', '蓝'],
      ['purple', '紫'],
    ];
    const accentRow = h('div', { class: 'theme-picker' });
    ACCENTS.forEach(([id, label]) => {
      const on = (settings.accent || 'auto') === id;
      accentRow.appendChild(
        h('button', {
          class: `theme-opt accent-opt${on ? ' on' : ''}`,
          dataset: { accent: id },
          title: id === 'auto' ? '跟着底图走（没底图时跟着周期主题）' : label,
          onclick: () => {
            settings.accent = id;
            Store.save();
            ctx.applyTheme();
            // 只换一行选中态，不整页重画：重画会把滚动位置也一起弹回去
            accentRow.querySelectorAll('.accent-opt').forEach((n) => {
              n.classList.toggle('on', n.dataset.accent === id);
            });
            global.UI.toast(id === 'auto' ? '强调色改为跟着底图' : `强调色换成${label}`, '✦');
          },
        }, h('div', { class: 'accent-opt__dot' }), h('div', { class: 'theme-opt__name', text: label }))
      );
    });

    const bgControl = (() => {
      const layer = global.Router.background;
      const cur = (layer && layer.current()) || { type: 'none', id: '' };

      const chip = (label, on, fn) =>
        h('button', {
          class: 'bg-chip' + (on ? ' on' : ''),
          text: label,
          onclick: fn,
        });

      const chips = h('div', { class: 'bg-chips' });
      /* 「极光」不是一个底图选项，而是**没有底图**这个状态本身。
         原来它和黄昏/林间/夜色并列摆在一起，于是能出现「极光 + 一张照片」
         这种自相矛盾的状态 —— 表现是半透明面板压在照片上，
         像蒙了一层白内障，字也没法读。文案改成「移除底图」，语义就通了。 */
      chips.appendChild(chip('移除底图（极光）', cur.type === 'none', () => {
        if (layer) layer.clear();
        ctx.rerender();
      }));
      ((layer && layer.presets) || []).forEach((p) => {
        chips.appendChild(chip(p.name, cur.type === 'preset' && cur.id === p.id, () => {
          if (layer) layer.setPreset(p.id);
          ctx.rerender();
        }));
      });
      chips.appendChild(h('button', {
        class: 'bg-chip',
        text: '上传…',
        onclick: async () => {
          const api = global.cijian;
          if (!api || !api.pickBackground) {
            global.UI.toast('这个版本不支持上传底图', '✦');
            return;
          }
          const r = await api.pickBackground();
          if (!r || r.canceled) return;          // 用户自己取消，不提示
          if (!r.ok) {
            global.UI.toast(r.error || '这个文件没能读进来', '✦');
            return;
          }
          if (layer) layer.setFile(r.name);
          global.UI.toast('底图换好了', '🖼');
          ctx.rerender();
        },
      }));

      const actions = h('div', { class: 'bg-actions' });
      if (cur.type === 'image' || cur.type === 'video') {
        actions.appendChild(h('span', {
          class: 'bg-current',
          text: (cur.type === 'video' ? '视频：' : '图片：') + (cur.name || ''),
        }));
      }
      return h('div', { class: 'bg-picker' }, chips, actions);
    })();

    box.appendChild(
      card('外观', [
        field(
          '强调色',
          '界面上所有颜色的唯一来源。选「自动」时跟着底图走 —— 林间配绿、夜色配蓝、黄昏配暖橙，自己传的照片取它自己的主色调（饱和度会压低，免得脏）。',
          h('div', { class: 'accent-col' }, accentRow, (() => {
            /* 玻璃模糊程度，放在色块**下面**、和颜色那一行同宽。
               整行铺开会太长（横跨整个卡片），而它和「界面长什么样」
               是同一件事，收在颜色下面读起来是一条线。
               原来是写死的、而且有底图时程序自动加一档 ——
               那是"替你判断"；现在是一根明确的旋钮。 */
            const row = h('div', { class: 'blur-row' });
            /* 读之前先兜底：存档里可能没有这个键（老存档、或种子状态漏了），
               直接读会显示成 undefined。 */
            const cur = typeof settings.glassBlur === 'number' ? settings.glassBlur : 50;
            settings.glassBlur = cur;
            const out = h('output', { class: 'blur-out', text: String(cur) });
            const input = h('input', {
              type: 'range', min: '0', max: '100', step: '5',
              class: 'blur-slider',
              value: String(cur),
              'aria-label': '玻璃模糊程度',
            });
            /* 划过的那一段是一个**独立的胶囊元素**，不是背景色块 ——
               背景层没法单独圆角，右端会是直边，看起来像一块方块卡在槽里。
               宽度按圆钮的真实行程算（见 css 的 .blur-fill）。 */
            const box = h('div', {
              class: 'blur-slider-box',
              style: { '--fill-ratio': String(cur / 100) },
            }, h('i', { class: 'blur-base' }), h('i', { class: 'blur-fill' }), input);
            input.addEventListener('input', () => {
              settings.glassBlur = Number(input.value);
              Store.save();
              out.textContent = String(settings.glassBlur);
              box.style.setProperty('--fill-ratio', String(settings.glassBlur / 100));
              // 光学层要重传那张降采样图，画面才会跟着动
              if (global.Router.optics) global.Router.optics.refresh();
            });
            row.appendChild(h('span', { class: 'blur-tag', text: '清晰' }));
            row.appendChild(box);
            row.appendChild(h('span', { class: 'blur-tag', text: '糊' }));
            row.appendChild(out);
            // 不再配说明段落：两端的字 + 数字已经说清了，文字越少越好
            return h('div', { class: 'blur-wrap' }, row);
          })())
        ),
        field(
          '明暗',
          '暖纸是产品默认的纸感语言；暗房是暖褐的屏 + 琥珀的光；空间是近黑底 + 毛玻璃层级，偏冷、信息密度更高。它只决定玻璃的厚薄与取色档位，不再改颜色。',
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
        field(
          '底图',
          '选一张照片或一段视频铺在窗口最底层，界面会变成半透明玻璃压在它上面 —— 底图是穿过玻璃的，不是被盖住的。不设底图时用程序化极光。',
          bgControl
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
