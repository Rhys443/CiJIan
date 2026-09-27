/* ============================================================
   此间 · 打卡页
   流程：选一张「照片」→ 相纸从相机缝里吐出 → 冲印显影 2.4s
        → 写背面感想 → 可选 AI 润色 → 提交（粒子庆祝）
   ============================================================ */
(function (global) {
  'use strict';

  const { h, icon, wait, burst, magnetize, stagger } = global.UI;
  const { Store, themeById, EMOTIONS, taskOr, tasksOf } = global.CJ;
  const { photo, normalizeUpload } = global.Photo;

  const MAX_LEN = 500;

  function render(ctx) {
    const cycle = ctx.cycle;
    const day = ctx.day;
    const theme = themeById(cycle.theme);
    const task = Store.currentDraw(cycle, day) || taskOr(tasksOf(cycle.theme)[0].id);
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
        chosenSrc = await normalizeUpload(file);
        await showPrint(chosenSrc, { eject: true });
        global.UI.toast('已把本机照片洗成相纸', '📷');
        refreshPicker();
      } catch (err) {
        // 把真正的失败原因说出来（太大 / 解不开 / 读不出），
        // 而不是一律「读不出来」——否则用户不知道该换什么
        global.UI.toast((err && err.message) || '这张图片读不出来，换一张试试', '✦');
      } finally {
        /* 必须清空。
           不然下次再选**同一个文件**时 value 没变，Chromium 不会触发 change，
           表现为「点了完全没反应」—— 用户会以为按钮坏了。 */
        fileInput.value = '';
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
        task: taskOr(existing.taskId).title,
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
      // 这里**不设 maxlength**：属性按 UTF-16 计长，而界面上的计数器按码点计
      // （Array.from），两把尺子混用就会出现「计数器说超了、输入框还让打」。
      // 上限统一交给 clampNote()。
      disabled: existing ? true : null,
    });

    /* 500 字是硬限制。
       以前只把 500 写在计数器上，maxlength 却给了 700 —— 多出来的 200 字
       照样能打进输入框，提交时也没人管，于是存档里留着一段界面明明标红
       「超了」却还是收下的字。
       截断不做无声处理：真的截了就当场说一句（同一段超长只提醒一次，
       不跟着每一次按键重复念），计数器同时更新。 */
    function clampNote(text, notify) {
      const str = String(text);
      const chars = Array.from(str);
      if (chars.length <= MAX_LEN) return str;
      if (notify) global.UI.toast(`背面最多 ${MAX_LEN} 字，多出来的没有收进去`, '✦');
      return chars.slice(0, MAX_LEN).join('');
    }

    textarea.value = clampNote(reflection, false);
    reflection = textarea.value;
    const counter = h('span', { text: `${Array.from(reflection).length} / ${MAX_LEN}` });

    let limitNoted = false; // 一次超长只提醒一次，避免每按一个键就弹一条

    /** 输入 → state → 计数器（必要时先截断），三条路都走这里 */
    function syncNote(notify) {
      const raw = textarea.value;
      const clipped = clampNote(raw, notify && !limitNoted);
      if (clipped !== raw) {
        limitNoted = true;
        // 截断后光标会被顶到末尾，尽量放回原来的位置（越界就收到末尾）
        const start = Math.min(textarea.selectionStart, clipped.length);
        const end = Math.min(textarea.selectionEnd, clipped.length);
        textarea.value = clipped;
        textarea.setSelectionRange(start, end);
      }
      reflection = clipped;
      const len = Array.from(reflection).length;
      if (len < MAX_LEN) limitNoted = false;
      counter.textContent = `${len} / ${MAX_LEN}`;
      // 走到这里 len 一定 <= MAX_LEN；保留这个判断是为了兜住旧存档里超长的记录
      counter.classList.toggle('over', len > MAX_LEN);
      syncBack();
    }

    textarea.addEventListener('input', (e) => {
      /* 输入法组字过程中不改 value：那会把正在拼的字打断，
         超出的部分等 compositionend 再截。 */
      if (e.isComposing) return;
      syncNote(true);
    });
    textarea.addEventListener('compositionend', () => syncNote(true));

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
                  // 润色版也可能超长，走同一条闸门（截断 + 计数器一起更新）
                  textarea.value = polishText;
                  syncNote(true);
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
      // 存进去的那一刻再夹一次：无论如何都不会有超过 500 字的相纸
      const text = clampNote(textarea.value.trim(), false);
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
      /* 写盘失败必须当场说清楚。
         以前 save() 把异常整个吞掉，界面照常弹「封存好了」，
         用户重启才发现那天是空的；而且一旦配额爆了，
         之后所有写入（设置、抽卡、打卡）都会一起失效，全程无声。 */
      if (Store.lastSaveError) {
        global.UI.toast('本地存储已满，这张相纸没能保存下来', '⚠');
        submitBtn.removeAttribute('disabled');
        return;
      }
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
