/* ============================================================
   此间 · 打卡页
   流程：选一张「照片」→ 相纸从相机缝里吐出 → 冲印显影 2.4s
        → 写背面感想 → 可选 AI 润色 → 提交（粒子庆祝）
   ============================================================ */
(function (global) {
  'use strict';

  const { h, icon, wait, burst, magnetize, stagger } = global.UI;
  const { Store, themeById, EMOTIONS, taskById, tasksOf } = global.CJ;
  const { photo, normalizeUpload } = global.Photo;

  const MAX_LEN = 500;

  function render(ctx) {
    const cycle = ctx.cycle;
    const day = ctx.day;
    const theme = themeById(cycle.theme);
    const task = Store.currentDraw(cycle, day) || taskById(tasksOf(cycle.theme)[0].id);
    const existing = Store.checkinOf(cycle, day);

    const wrap = h('div', { class: 'view-inner' });
    wrap.appendChild(
      h(
        'div',
        { class: 'page-head' },
        h('div', { class: 'page-head__kicker' }, h('i'), h('span', { text: `CHECK IN · 第 ${day} 天` })),
        existing
          ? h('h1', {}, '今天这张，', h('em', { text: '已经收藏好了' }))
          : h('h1', {}, '把这一刻，', h('em', { text: '洗成相纸' })),
        h('p', {
          text: existing
            ? '每天的相纸只有一张，提交后不可修改 —— 这也是它珍贵的原因。'
            : '拍一张照，写下背面那几行字。相纸一旦洗出来，就不再修改。',
        })
      )
    );

    const grid = h('div', { class: 'checkin-grid' });

    /* ---------------- 左：相纸舞台 ---------------- */
    const stageEl = h('div', { class: 'print-stage', 'data-light': true });
    const holder = h('div', { class: 'print-holder' });
    const slot = h('div', { class: 'print-slot' });
    const black = h('div', { class: 'print-black no-photo' });
    const caption = h('div', { class: 'print-caption' });

    let chosenSrc = existing ? existing.photo : null;
    let polaroid = null;
    let reflection = existing ? existing.reflection : '';
    let emotion = existing ? existing.emotion : null;
    let polished = existing ? existing.polished : null;

    const rseeds = [day * 977 + cycle.startDate.length, day * 331 + 41, day * 1877 + 7].map((s) => Math.abs(s | 0));
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        chosenSrc = await normalizeUpload(file, 720);
        await showPrint(chosenSrc, { eject: true });
        global.UI.toast('已把本机照片洗成相纸', '📷');
        refreshPicker();
      } catch (err) {
        global.UI.toast('这张图片读不出来，换一张试试', '✦');
      }
    });

    const picker = h('div', { class: 'shot-picker', 'data-light': true });

    function refreshPicker() {
      picker.innerHTML = '';
      if (chosenSrc) {
        picker.appendChild(h('div', { class: 'shot-picker__icon' }, icon('check', 24)));
        picker.appendChild(h('h3', { text: '相纸已经洗好了' }));
        picker.appendChild(h('p', { text: '点相纸可以翻到背面，看看你写下的那句话。不喜欢这张画面？换一张重新冲印。' }));
      } else {
        picker.appendChild(h('div', { class: 'shot-picker__icon' }, icon('camera', 24)));
        picker.appendChild(h('h3', { text: '选一张今天的画面' }));
        picker.appendChild(
          h('p', { text: 'Demo 里没有真实相机，所以准备了三种画面备选。你也可以用本机的一张照片，它会被压成拍立得尺寸并加上胶片质感。' })
        );
      }
      const row = h('div', { class: 'shot-picker__row' });
      row.appendChild(
        h('button', { class: 'btn btn--quiet', onclick: () => fileInput.click() }, icon('down', 14), h('span', { text: '用本机图片' }))
      );
      rseeds.forEach((s, i) => {
        const src = photo(s, 560);
        row.appendChild(
          h(
            'button',
            {
              class: `shot-thumb${chosenSrc === src ? ' on' : ''}`,
              title: `画面 ${i + 1}`,
              onclick: async () => {
                chosenSrc = src;
                await showPrint(chosenSrc, { eject: true });
                refreshPicker();
              },
            },
            h('img', { src: photo(s, 320), alt: '' })
          )
        );
      });
      picker.appendChild(h('div', { class: 'shot-thumbs' }, row));
    }

    async function showPrint(src, opts = {}) {
      holder.innerHTML = '';
      black.classList.remove('no-photo');
      polaroid = global.Polaroid.create({
        src,
        day,
        date: new Date(),
        theme: cycle.theme,
        task: task.title,
        reflection,
        emotion: emotion || 'calm',
        size: 'lg',
      });
      holder.appendChild(polaroid.el);
      caption.style.display = '';
      caption.textContent = '拍立得相纸 · 点一下可以翻到背面';
      if (opts.eject) await global.Polaroid.eject(polaroid.el, 130);
      await polaroid.develop(opts.delay || 0);
      syncBack();
    }

    function syncBack() {
      if (polaroid) polaroid.setReflection(reflection || '');
    }

    stageEl.appendChild(slot);
    stageEl.appendChild(black);
    stageEl.appendChild(holder);
    stageEl.appendChild(caption);

    if (existing) {
      chosenSrc = existing.photo || photo(existing.photoSeed || rseeds[0], 560);
      polaroid = global.Polaroid.create({
        src: chosenSrc,
        day,
        date: new Date(existing.createdAt),
        theme: cycle.theme,
        task: taskById(existing.taskId).title,
        reflection: existing.reflection,
        emotion: existing.emotion,
        size: 'lg',
      });
      holder.appendChild(polaroid.el);
      caption.textContent = '点一下相纸，翻到背面重读那天的感想';
    } else {
      stageEl.appendChild(picker);
      refreshPicker();
      requestAnimationFrame(async () => {
        chosenSrc = photo(rseeds[0], 560);
        await showPrint(chosenSrc, { eject: true, delay: 320 });
        refreshPicker();
      });
    }

    stageEl.appendChild(fileInput);
    grid.appendChild(stageEl);

    /* ---------------- 右：写感想 ---------------- */
    const panel = h('div', { class: 'write-panel' });

    const textarea = h('textarea', {
      placeholder: '写下今天的感觉。一句话也可以。',
      maxlength: String(MAX_LEN + 200),
      disabled: existing ? true : null,
    });
    textarea.value = reflection;
    const counter = h('span', { text: `${Array.from(reflection).length} / ${MAX_LEN}` });

    textarea.addEventListener('input', () => {
      reflection = textarea.value;
      const len = Array.from(reflection).length;
      counter.textContent = `${len} / ${MAX_LEN}`;
      counter.classList.toggle('over', len > MAX_LEN);
      syncBack();
    });

    const emoRow = h('div', { class: 'emotion-row' });
    EMOTIONS.forEach((e) => {
      const node = h(
        'button',
        {
          class: `emotion${emotion === e.id ? ' on' : ''}`,
          style: { '--emo': e.color },
          onclick: () => {
            if (existing) return;
            emotion = e.id;
            emoRow.querySelectorAll('.emotion').forEach((n) => n.classList.remove('on'));
            node.classList.add('on');
            refreshBackEmotion();
          },
        },
        h('i'),
        h('span', { text: e.label })
      );
      emoRow.appendChild(node);
    });

    function refreshBackEmotion() {
      if (!polaroid) return;
      const emo = EMOTIONS.find((x) => x.id === emotion) || EMOTIONS[0];
      const backEmo = polaroid.el.querySelector('.polaroid__emo');
      if (backEmo) {
        backEmo.style.setProperty('--emo', emo.color);
        backEmo.textContent = `◍ ${emo.label}`;
      }
    }

    const polishHost = h('div', {});
    let polishText = polished || null;

    function renderPolish() {
      polishHost.innerHTML = '';
      if (!polishText) return;
      polishHost.appendChild(
        h(
          'div',
          { class: 'polish' },
          h('div', { class: 'polish__head' }, h('span', {}, 'AI 润色 · 草稿'), h('span', { class: 'faint', text: '原意与第一人称已保留' })),
          h('p', { class: 'polish__text', text: polishText }),
          h(
            'div',
            { class: 'polish__row' },
            h(
              'button',
              {
                class: 'btn btn--quiet',
                onclick: () => {
                  reflection = polishText;
                  textarea.value = polishText;
                  counter.textContent = `${Array.from(reflection).length} / ${MAX_LEN}`;
                  syncBack();
                  global.UI.toast('已采用润色版', '✦');
                },
              },
              h('span', { text: '采用这一版' })
            ),
            h(
              'button',
              {
                class: 'btn btn--ghost',
                onclick: () => {
                  polishHost.innerHTML = '';
                  polishText = null;
                },
              },
              h('span', { text: '还是保留原文' })
            )
          )
        )
      );
    }
    renderPolish();

    const polishBtn = h(
      'button',
      { class: 'btn btn--quiet', onclick: () => runPolish() },
      icon('spark', 14),
      h('span', { text: '帮我润色一下' })
    );

    async function runPolish() {
      const text = textarea.value.trim();
      if (Array.from(text).length < 6) {
        global.UI.toast('先写几个字，我再帮你顺一顺', '✦');
        return;
      }
      polishBtn.setAttribute('disabled', '');
      const label = polishBtn.querySelector('span:last-child');
      if (label) label.textContent = '正在润色…';
      await wait(880);
      polishText = polish(text);
      renderPolish();
      polishBtn.removeAttribute('disabled');
      if (label) label.textContent = '帮我润色一下';
    }

    /* 提交 */
    const submitBtn = h(
      'button',
      { class: 'btn btn--primary btn--lg', onclick: () => submit() },
      icon('check', 16),
      h('span', { text: existing ? '今天已经提交过了' : '封存这张相纸' })
    );
    if (existing) submitBtn.setAttribute('disabled', '');

    async function submit() {
      const text = textarea.value.trim();
      if (!chosenSrc) {
        global.UI.toast('先选一张今天的画面', '✦');
        return;
      }
      if (Array.from(text).length < 2) {
        global.UI.toast('背面还空着，写一句也好', '✦');
        textarea.focus();
        return;
      }
      submitBtn.setAttribute('disabled', '');
      Store.submitCheckin(cycle, day, {
        taskId: task.id,
        photo: chosenSrc,
        reflection: text,
        polished: polishText,
        emotion: emotion || autoEmotion(text),
      });
      burst(stageEl, { count: 34, power: 210 });
      if (polaroid) {
        await polaroid.flip(true);
        await wait(420);
        await polaroid.develop(0);
        polaroid.flip(false);
      }
      global.UI.toast('第 ' + day + ' 张相纸，封存好了', '✦');
      setTimeout(() => ctx.rerender(), 900);
    }

    panel.appendChild(
      h(
        'div',
        { class: 'write-block', 'data-light': true },
        h('div', { class: 'write-block__label' }, h('span', { text: '背面 · 写点什么' }), h('span', { text: `第 ${day} 天` })),
        h('p', { class: 'write-prompt', text: task.writingPrompt }),
        h('div', { class: 'write-field' }, textarea),
        h('div', { class: 'write-meta' }, counter, h('span', { text: '提交后不可修改' })),
        h('div', { class: 'write-meta' }, h('span', { text: '情绪标签（可选）' })),
        emoRow,
        h('div', { class: 'write-actions', style: { marginTop: '18px' } }),
        polishHost
      )
    );

    const actionRow = panel.querySelector('.write-actions');
    actionRow.appendChild(submitBtn);
    if (!existing) actionRow.appendChild(polishBtn);

    panel.appendChild(
      h(
        'div',
        { class: 'write-block', 'data-light': true },
        h(
          'div',
          { class: 'write-block__label' },
          h('span', { text: '今天的任务卡' }),
          h('span', { text: `No.${String(task.index).padStart(2, '0')}` })
        ),
        h('p', { class: 'write-prompt', text: task.title }),
        h('p', { class: 'write-hint', text: `📷 ${task.photoGuide}` }),
        h(
          'div',
          { class: 'write-actions', style: { marginTop: '14px' } },
          h('button', { class: 'btn btn--quiet', onclick: () => ctx.go('draw') }, icon('draw', 14), h('span', { text: '看看这张卡' }))
        ),
        h('p', {
          class: 'write-hint',
          style: { marginTop: '14px' },
          text: '如果真的做不了，也可以跳过 —— 跳过不算失败，只是今天不抽这一张。',
        })
      )
    );

    grid.appendChild(panel);
    wrap.appendChild(grid);

    requestAnimationFrame(() => {
      stagger(wrap.querySelectorAll('.write-block, .shot-picker'));
      magnetize(submitBtn, 0.16, 6);
    });

    return wrap;
  }

  /* ---------------- 简易「润色」：不加信息、只顺语句 ---------------- */
  function polish(text) {
    let out = String(text).trim().replace(/\s+/g, ' ');
    const rules = [
      [/(^|[。！？\n])\s*然后\s*/g, '$1'],
      [/非常非常/g, '非常'],
      [/我觉得我觉得/g, '我觉得'],
      [/\s*，\s*/g, '，'],
      [/，{2,}/g, '，'],
      [/([。！？])\1+/g, '$1'],
      [/一下下/g, '一下'],
      [/特别的/g, '特别'],
      [/的话呢/g, ''],
      [/然后呢/g, '然后'],
      [/额+|嗯{2,}/g, ''],
    ];
    rules.forEach(([re, rep]) => {
      out = out.replace(re, rep);
    });
    out = out.trim();
    if (out && !/[。！？…～]$/.test(out)) out += '。';
    out = out.replace(/([^，。！？]{46,}?)，/g, '$1。');
    return out;
  }

  function autoEmotion(text) {
    const t = String(text);
    if (/(累|疲惫|难过|沉|重|不想|哭)/.test(t)) return 'heavy';
    if (/(开心|高兴|轻|不错|舒服|愉快)/.test(t)) return 'bright';
    if (/(暖|温柔|感|谢谢|喜欢)/.test(t)) return 'warm';
    if (/(静|平静|安静|空)/.test(t)) return 'calm';
    if (/(忽然|意识到|发现|想通)/.test(t)) return 'awake';
    return 'tender';
  }

  global.Views = global.Views || {};
  global.Views.checkin = { title: '打卡', render };
})(window);
