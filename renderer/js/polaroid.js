/* ============================================================
   此间 · 拍立得相纸组件
   · create()      生成一张相纸（正面照片 / 背面手写感想）
   · develop()     冲印显影动画（这一段的质感决定了整个 App 的高级感）
   · eject()       从"相机"里吐纸的动画
   · flip()        翻到背面
   ============================================================ */
(function (global) {
  'use strict';

  const { h, wait, tween, ease, escapeHtml } = global.UI;
  const { fmtSlash } = global.CJ.utils;
  const { photo, photoMeta } = global.Photo;

  const EMOTION_BY_ID = (id) => global.CJ.EMOTIONS.find((e) => e.id === id) || global.CJ.EMOTIONS[0];

  /**
   * @param {object} o
   *  o.src        照片 dataURL（缺省则用 seed 程序化生成）
   *  o.seed       程序化照片种子
   *  o.day        第几天
   *  o.date       Date
   *  o.theme      'move' | 'make' | 'link'
   *  o.task       任务文案（正面底部小字）
   *  o.reflection 背面感想
   *  o.emotion    情绪标签 id
   *  o.size       'sm' | 'md' | 'lg'
   *  o.flippable  是否可翻面
   *  o.showDay    是否显示日期角标
   */
  function create(o) {
    const opts = Object.assign(
      { size: 'md', flippable: true, showDay: true, reflection: '', emotion: 'calm', day: 1 },
      o
    );
    const theme = global.CJ.themeById(opts.theme);
    const src = opts.src || photo(opts.seed || 1, opts.size === 'sm' ? 320 : 560);
    const date = opts.date ? (opts.date instanceof Date ? opts.date : new Date(opts.date)) : new Date();
    const emo = EMOTION_BY_ID(opts.emotion);
    const meta = opts.src ? null : photoMeta(opts.seed || 1);

    const photoImg = h('img', {
      class: 'polaroid__img',
      src,
      alt: '',
      draggable: 'false',
    });

    // 正面：照片 + 底部留白 + 手写日期
    const front = h(
      'div',
      { class: 'polaroid__face polaroid__face--front' },
      h(
        'div',
        { class: 'polaroid__frame' },
        photoImg,
        h('div', { class: 'polaroid__develop' }),
        h('div', { class: 'polaroid__grain' }),
        h('div', { class: 'polaroid__sheen' }),
        opts.showDay ? h('div', { class: 'polaroid__stamp', text: `DAY ${String(opts.day).padStart(2, '0')}` }) : null
      ),
      h(
        'div',
        { class: 'polaroid__foot' },
        h('span', { class: 'polaroid__date hand', text: fmtSlash(date) }),
        opts.task ? h('span', { class: 'polaroid__task', text: truncate(opts.task, 16) }) : null
      )
    );

    // 背面：手写感想 + 情绪标签
    const back = h(
      'div',
      { class: 'polaroid__face polaroid__face--back' },
      h(
        'div',
        { class: 'polaroid__back-inner' },
        h('div', { class: 'polaroid__back-kicker' },
          h('span', { text: `${theme.glyph} ${theme.category}` }),
          h('span', { class: 'polaroid__back-day', text: `第 ${opts.day} 天` })
        ),
        h('div', { class: 'polaroid__rule' }),
        opts.reflection
          ? h('p', { class: 'polaroid__writing hand', html: escapeHtml(opts.reflection).replace(/\n/g, '<br>') })
          : h('p', { class: 'polaroid__writing polaroid__writing--empty', text: '这一天你在休息，也很好。' }),
        h(
          'div',
          { class: 'polaroid__back-foot' },
          h('span', { class: 'polaroid__emo', style: { '--emo': emo.color }, text: `◍ ${emo.label}` }),
          meta ? h('span', { class: 'polaroid__meta faint', text: `${meta.palette} · ${meta.scene}` }) : null
        )
      )
    );

    const inner = h('div', { class: 'polaroid__inner' }, front, back);
    const root = h(
      'div',
      {
        class: `polaroid polaroid--${opts.size}${opts.flippable ? ' is-flippable' : ''}`,
        tabindex: opts.flippable ? '0' : '-1',
        role: opts.flippable ? 'button' : 'figure',
        'aria-label': opts.reflection ? `第 ${opts.day} 天的相纸，按回车翻到背面` : `第 ${opts.day} 天的相纸`,
      },
      inner
    );

    const api = {
      el: root,
      front,
      back,
      img: photoImg,
      isFlipped: false,
      setReflection(text) {
        opts.reflection = text;
        const node = back.querySelector('.polaroid__writing');
        node.classList.remove('polaroid__writing--empty');
        node.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
        return api;
      },
      flip(to) {
        const target = typeof to === 'boolean' ? to : !api.isFlipped;
        api.isFlipped = target;
        root.classList.toggle('is-flipped', target);
        return api;
      },
      /**
       * 冲印显影 —— 全 App 最重要的 2.4 秒。
       * 真实的宝丽来不是"模糊变清晰"：它是先一片过曝的空白，
       * 带着偏冷绿的乳剂感，然后暗部才慢慢从白里长出来。
       * 所以 blur / brightness / contrast / saturate / sepia / hue-rotate 必须同时动。
       */
      develop(delay = 0) {
        const dev = front.querySelector('.polaroid__develop');
        dev.classList.remove('is-running');
        void dev.offsetWidth;
        /* 只动 filter 与 opacity，**不动 transform**。
           原来每一帧还带一个 scale(1.032) → scale(1)，那是把几何位移混进了
           显影里，观感就成了「里面的图片自己在动」。真实相纸的显影是化学过程，
           图像在纸面上原位长出来，不会缩放。相纸整体的运动交给 eject()。 */
        const keyframes = [
          {
            filter: 'blur(15px) brightness(1.58) contrast(0.34) saturate(0.22) sepia(0.34) hue-rotate(-8deg)',
            opacity: 0.14,
            offset: 0,
          },
          {
            filter: 'blur(9px) brightness(1.3) contrast(0.55) saturate(0.46) sepia(0.27) hue-rotate(-5deg)',
            opacity: 0.62,
            offset: 0.22,
          },
          {
            filter: 'blur(3.4px) brightness(1.1) contrast(0.85) saturate(0.78) sepia(0.13) hue-rotate(-2deg)',
            opacity: 0.93,
            offset: 0.56,
          },
          {
            filter: 'blur(0px) brightness(1) contrast(1) saturate(1) sepia(0) hue-rotate(0deg)',
            opacity: 1,
            offset: 1,
          },
        ];
        photoImg.style.transition = 'none';
        photoImg.style.filter = keyframes[0].filter;
        photoImg.style.opacity = String(keyframes[0].opacity);

        return wait(delay).then(() => {
          dev.classList.add('is-running');
          const anim = photoImg.animate(keyframes, {
            duration: 2400,
            easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            fill: 'both',
          });
          return anim.finished
            .catch(() => {})
            .then(() => {
              // 动画结束后交还给 CSS，避免 fill:both 长期占用合成层
              photoImg.style.transition = '';
              photoImg.style.filter = 'none';
              photoImg.style.opacity = '1';
              photoImg.style.transform = 'none';
              photoImg.getAnimations().forEach((a) => a.cancel());
              dev.classList.remove('is-running');
            });
        });
      },
    };

    if (opts.flippable) {
      const toggle = () => api.flip();
      root.addEventListener('click', toggle);
      root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    }

    return api;
  }

  /**
   * 吐纸：从上方那条缝里慢慢出来。
   *
   * 和上一版的区别（上一版做反了）：
   *   · 方向 —— 从**上方**的出口往下走，不是从下方弹上来
   *   · 速度 —— 出纸机构是匀速的，要"慢慢吐"，不是弹出来
   *   · 幅度 —— 起点要完全藏进缝里（位移 = 相纸自身高度 + 余量），
   *             否则一开头就有一截已经露在外面，穿帮
   *
   * 所以位移加在相纸这一个元素上（整张当刚体），缓动接近线性、
   * 只在头尾各软一点，像被滚轮匀速推出来；再留 0.5° 以内的极轻摇摆，
   * 免得机械得像 UI 动画。
   */
  function eject(el, distance = 40) {
    const h = el.offsetHeight || 340;
    const travel = h + distance;   // 起点：整张相纸都在缝的上方
    const anim = el.animate(
      [
        { transform: `translate3d(0, ${-travel}px, 0) rotate(0.5deg)`,
          offset: 0, easing: 'cubic-bezier(0.42, 0, 0.28, 1)' },
        { transform: `translate3d(0, ${-travel * 0.62}px, 0) rotate(-0.32deg)`,
          offset: 0.38, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
        { transform: `translate3d(0, ${-travel * 0.24}px, 0) rotate(0.16deg)`,
          offset: 0.72, easing: 'cubic-bezier(0.38, 0, 0.32, 1)' },
        { transform: 'translate3d(0, 0, 0) rotate(0deg)', offset: 1 },
      ],
      { duration: 2600, fill: 'both' }   // 慢慢吐：出纸过程本身就是这支动画的主角
    );
    // 等完全吐出来再显影 —— 先是一张白纸出来，然后图像才慢慢长出来。
    //
    // 收尾必须 cancel()：fill:'both' 会让元素永久保留一个 transform，
    // 于是它一直被提升为独立合成层，边缘在缩放屏幕上容易出现 1px 接缝
    // （就是"相纸出来之后中间多了一道很细的线"）。
    // 动画终点本来就是 translate(0,0)，取消不会产生跳变。
    return anim.finished
      .then(() => { anim.cancel(); })
      .catch(() => {});
  }

  /** 静止叠放的小相纸（用于日历墙） */
  function mini(o) {
    const card = create(Object.assign({ size: 'sm', flippable: true, showDay: true }, o));
    return card;
  }

  function truncate(s, n) {
    const str = String(s || '');
    return str.length > n ? `${str.slice(0, n)}…` : str;
  }

  /** 空白相纸（未打卡的日子） */
  function blank(o) {
    const opts = Object.assign({ day: 1, date: new Date(), size: 'sm', theme: 'move' }, o);
    const theme = global.CJ.themeById(opts.theme);
    const root = h(
      'div',
      { class: `polaroid polaroid--${opts.size} polaroid--blank` },
      h(
        'div',
        { class: 'polaroid__inner' },
        h(
          'div',
          { class: 'polaroid__face polaroid__face--front' },
          h(
            'div',
            { class: 'polaroid__frame polaroid__frame--empty' },
            h('div', { class: 'polaroid__empty-glyph', text: `${theme.glyph}` }),
            h('div', { class: 'polaroid__empty-hint', text: '这一格还空着' }),
            h('div', { class: 'polaroid__stamp', text: `DAY ${String(opts.day).padStart(2, '0')}` })
          ),
          h(
            'div',
            { class: 'polaroid__foot' },
            h('span', { class: 'polaroid__date hand', text: fmtSlash(opts.date) }),
            h('span', { class: 'polaroid__task faint', text: '等待填满' })
          )
        )
      )
    );
    return { el: root, isFlipped: false, flip() {}, setReflection() {}, develop: () => Promise.resolve() };
  }

  /** 相纸背面（独立排版，用于放大查看） */
  function backOnly(o) {
    const opts = Object.assign({ reflection: '', emotion: 'calm', day: 1, theme: 'move' }, o);
    const theme = global.CJ.themeById(opts.theme);
    const emo = EMOTION_BY_ID(opts.emotion);
    return h(
      'div',
      { class: 'polaroid__face polaroid__face--back polaroid__face--solo' },
      h(
        'div',
        { class: 'polaroid__back-inner' },
        h('div', { class: 'polaroid__back-kicker' },
          h('span', { text: `${theme.glyph} ${theme.category}` }),
          h('span', { class: 'polaroid__back-day', text: `第 ${opts.day} 天` })
        ),
        h('div', { class: 'polaroid__rule' }),
        h('p', { class: 'polaroid__writing hand', html: escapeHtml(opts.reflection).replace(/\n/g, '<br>') }),
        h('div', { class: 'polaroid__back-foot' },
          h('span', { class: 'polaroid__emo', style: { '--emo': emo.color }, text: `◍ ${emo.label}` })
        )
      )
    );
  }

  global.Polaroid = { create, mini, blank, eject, backOnly, truncate };

  void tween;
  void ease;
})(window);
