/* ============================================================
   此间 · 数据层
   · TASKS：任务池（100% 取自产品文档第四章示例，三主题各 10 张）
   · Store：本地持久化（localStorage）+ 周期/打卡/徽章派生态
   ============================================================ */
(function (global) {
  'use strict';

  const CYCLE_DAYS = 15;
  const STORAGE_KEY = 'cijian.state.v1';
  const SCHEMA = 'cijian/1';
  /* 认不出来的存档会被原样挪到这里，而不是就地覆盖。
     只有一个键的时候，「schema 不匹配 → 铺种子」等于把用户真实的
     打卡、感想、照片全删了，而且没有任何提示。 */
  const BACKUP_KEY = 'cijian.state.backup';
  const BACKUP_META_KEY = 'cijian.state.backup.meta';
  /* 旧 schema → 迁移函数。目前只有 v1，留这张表是为了下次改结构时
     有一条路可走，而不是只能清库。 */
  const MIGRATIONS = {};
  const THEME_ORDER = ['move', 'make', 'link'];

  /* ---------------- 主题 ---------------- */
  const THEMES = [
    {
      id: 'move',
      name: '动起来',
      glyph: '🏃',
      category: '身体唤醒',
      tagline: '让身体先醒过来，脑子会跟上。',
      accent: '#cf6438',
      prompt: '今天，你身体哪个部位最先活过来？',
    },
    {
      id: 'make',
      name: '造点什么',
      glyph: '🎨',
      category: '创造力唤醒',
      tagline: '不用做得好，只要做出来。',
      accent: '#b0793c',
      prompt: '今天你造出的那点东西，是从哪儿冒出来的？',
    },
    {
      id: 'link',
      name: '连上谁',
      glyph: '🤝',
      category: '连接唤醒',
      tagline: '世界比你以为的更愿意回应你。',
      accent: '#7d6a8f',
      prompt: '今天有人因为你，稍微好过了一点点吗？',
    },
  ];

  const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

  /* ---------------- 任务池（源自产品文档 4.3） ---------------- */
  const RAW = {
    move: [
      ['出门走一条从未走过的路', '拍下路上最让你意外的一个画面', '如果这条路是你的人生，你会怎么形容它？', 1],
      ['跟着音乐随意舞动3分钟', '拍下跳舞时你的影子或脚', '身体哪个部位最先「活」过来了？', 1],
      ['用非惯用手吃一顿饭', '拍下你用非惯手持餐具的瞬间', '笨拙的感觉让你想起了什么？', 2],
      ['对着镜子做一个夸张的表情并保持10秒', '自拍这个表情', '你平时藏起来的是哪种表情？', 1],
      ['赤脚踩在地面上站1分钟', '拍下你的脚和地面的接触', '地面给你的第一个感觉是什么词？', 1],
      ['爬一段楼梯，每上一层深呼吸一次', '拍下楼梯尽头的风景', '爬到第几层时呼吸变了？', 2],
      ['用手指描摹一片叶子的脉络', '拍下叶子和你的手指', '这条脉络像不像你最近的某条思路？', 1],
      ['闭眼听完一首完整的歌', '拍下播放界面或耳机', '这首歌在你脑海里画了什么颜色？', 1],
      ['做一组拉伸，停在最酸的那个点5秒', '拍下你拉伸时的姿势', '那个「酸」是在提醒你什么？', 2],
      ['早起后第一件事：开窗深吸三口气', '拍下窗外的晨光或天色', '今天的空气闻起来像什么味道？', 1],
    ],
    make: [
      ['用手机拍一张「你觉得美但别人可能觉得普通」的东西', '就是这张照片本身', '你为什么觉得它美？', 1],
      ['用三种颜色画出今天的心情', '拍下你的画', '这三种颜色分别代表什么？', 2],
      ['写一封不会寄出的信（3行就够）', '拍下信纸（可以遮住内容）', '写信时你的手有没有停顿？在哪一行？', 2],
      ['把桌上任意三样东西摆成一个「作品」', '拍下你的装置', '这三样东西之间有什么隐藏的联系？', 1],
      ['录一段30秒的环境音', '拍下录音波形或录音场景', '这段声音里你最想留住哪一秒？', 2],
      ['用一个词形容今天的天气，然后把它写成一首三行诗', '拍下你的诗', '这个词是怎么冒出来的？', 2],
      ['翻到手机相册里最旧的一张照片', '截屏那张照片', '当时的你和现在的你，最大的区别是什么？', 1],
      ['给一个物品起一个新名字', '拍下这个物品', '为什么它配得上这个新名字？', 1],
      ['用身体摆出一个字母的形状', '拍下你的造型', '这个字母对你有什么特殊含义？', 2],
      ['找一面墙，拍下它的纹理', '就是这张纹理特写', '如果把这种纹理穿在身上，你会是什么感觉？', 1],
    ],
    link: [
      ['给一个超过30天没说话的人发一条消息', '拍下聊天界面（可打码）', '按下发送键之前你犹豫了几秒？', 2],
      ['对一个陌生人说一句真诚的谢谢', '拍下当时的场景（不必拍到人）', '对方的反应和你预期的一样吗？', 3],
      ['问身边一个人：「你最近好吗？」然后认真听', '拍下你们所在的空间', 'ta 回答时你有没有听到没说出口的部分？', 2],
      ['写下你最想对过去的自己说的一句话', '拍下手写的这句话', '说完之后你有什么感觉？', 2],
      ['观察一个路人30秒，在心里祝 ta 好', '拍下你观察的方向（不拍人脸）', '你为什么选了这个人？', 1],
      ['给未来的自己留一条语音备忘录', '拍下录音界面', '你最希望未来的自己记住什么？', 2],
      ['找到一个让你感到安全的地方，坐一会儿', '拍下这个空间的角落', '「安全」在这里具体是什么感觉？', 1],
      ['回忆一个帮助过你的人，写下 ta 的名字', '拍下这个名字（可以用化名）', '你现在最想告诉 ta 什么？', 2],
      ['把手机里一张合照设为壁纸一天', '拍下锁屏界面', '设成壁纸后你今天多看手机了吗？', 1],
      ['对着镜头说一句鼓励自己的话', '自拍或拍下镜头', '说出口和自己想的时候，感觉有什么不同？', 2],
    ],
  };

  const TASKS = [];
  Object.keys(RAW).forEach((theme) => {
    RAW[theme].forEach((row, i) => {
      TASKS.push({
        id: `${theme}_${String(i + 1).padStart(2, '0')}`,
        theme,
        index: i + 1,
        title: row[0],
        photoGuide: row[1],
        writingPrompt: row[2],
        difficulty: row[3],
        isHidden: false,
      });
    });
  });

  const tasksOf = (theme) => TASKS.filter((t) => t.theme === theme);
  const taskById = (id) => TASKS.find((t) => t.id === id) || null;

  /* 存档里可能留着一张**已经不在任务池里**的卡（任务池改过、或从旧版本
     存下来的记录）。taskById 这时返回 null，而调用方以前直接
     `taskById(rec.taskId).title` —— 整个视图当场抛异常，页面一片空白，
     连设置页都进不去。所以取卡统一走这里：拿不到就给一张占位卡，
     界面照常渲染出「这张卡不在了」，而不是白屏。 */
  const MISSING_TASK = {
    id: '',
    theme: '',
    index: 0,
    difficulty: 1,
    isHidden: false,
    title: '这张卡已经不在任务池里了',
    photoGuide: '当时的画面只留在你的相纸里',
    writingPrompt: '写下当时想写的话就好',
  };
  const taskOr = (id) => taskById(id) || MISSING_TASK;

  /* ---------------- 徽章 ---------------- */
  const BADGES = [
    { id: 'b3', days: 3, glyph: '🌱', name: '破土', desc: '连续 3 天' },
    { id: 'b7', days: 7, glyph: '🌿', name: '抽枝', desc: '连续 7 天' },
    { id: 'b10', days: 10, glyph: '🌳', name: '成荫', desc: '连续 10 天' },
    { id: 'b15', days: 15, glyph: '🌻', name: '满格', desc: '连续 15 天' },
  ];

  /* ---------------- 情绪标签 ---------------- */
  const EMOTIONS = [
    { id: 'calm', label: '平静', score: 62, color: '#7d9aa8' },
    { id: 'warm', label: '温暖', score: 84, color: '#e0855c' },
    { id: 'bright', label: '轻快', score: 92, color: '#d9a441' },
    { id: 'tender', label: '柔软', score: 74, color: '#c79bb4' },
    { id: 'heavy', label: '沉', score: 34, color: '#7a6c8a' },
    { id: 'awake', label: '清醒', score: 70, color: '#7d8f6a' },
  ];

  /* ---------------- 工具 ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (base, n) => {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + n);
    return d;
  };
  const fromKey = (key) => {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
  const fmtCN = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()]}`;
  const fmtSlash = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;

  /** 确定性伪随机（同一个 seed 永远得到同一结果，方便复盘与"看起来真实"） */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hashStr = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  /* ---------------- 状态仓库 ---------------- */
  const Store = {
    state: null,
    listeners: new Set(),

    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    },
    emit() {
      this.listeners.forEach((fn) => fn(this.state));
    },

    /* 写盘。返回 true / false，不再把异常吞掉。
       以前是 catch{} 一吞：配额爆了照样弹「封存好了」，用户重启才发现
       那天是空的，连签和徽章数字还往下掉 —— 而且此后**所有**写入
       （设置、抽卡、打卡）都一起失效，全程无声。 */
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        this.lastSaveError = null;
        return true;
      } catch (err) {
        this.lastSaveError = err;
        if (global.console && console.warn) {
          console.warn('[Store] 本地存储写入失败：', (err && err.name) || '', (err && err.message) || '');
        }
        return false;
      }
    },

    /* 读到认不出的存档时，先原样备份再铺新数据。
       备份失败（比如配额满到连备份都写不进）时把 recoveredBackup 置 false，
       调用方据此提示用户 —— 至少要让人知道东西还在不在。 */
    quarantine(raw, schema) {
      try {
        localStorage.setItem(BACKUP_KEY, raw);
        localStorage.setItem(BACKUP_META_KEY, JSON.stringify({
          at: new Date().toISOString(),
          schema: schema == null ? null : schema,
        }));
        this.recoveredBackup = true;
      } catch (err) {
        this.recoveredBackup = false;
      }
    },

    /* 读进来的 state 一律过一遍这里。
       以前只检查 schema 就返回，于是缺 cycles / settings / startDate 的
       半截数据会让每个视图依次抛异常，连设置页（唯一有「恢复演示数据」
       按钮的地方）都打不开，用户只能手动去删 localStorage。 */
    normalize(s) {
      if (!s || typeof s !== 'object') return null;
      s.settings = Object.assign({
        mode: 'light', reminderTime: '09:00', streakReminder: true,
        reduceMotion: false, sound: false, skipRest: true,
        /* 强调色：'auto' = 跟着底图（没底图时跟着周期主题那一档）。
           具体值是 red/orange/yellow/green/cyan/blue/purple 之一。
           它是**界面颜色唯一的来源** —— 周期主题不再改颜色。 */
        accent: 'auto',
        /* 玻璃模糊程度 0–100（设置页「外观」那一行的滑杆）。
           50 = 原来的标准。底图细节多的时候自己往右拉 ——
           白字压在玻璃上被底下的细节干扰就不好读了。 */
        glassBlur: 50,
      }, (s.settings && typeof s.settings === 'object') ? s.settings : {});
      if (!Array.isArray(s.checkins)) s.checkins = [];
      if (!Array.isArray(s.archived)) s.archived = [];
      // 没有周期就无从修起 —— 交给上层铺种子，原始数据已进备份键
      if (!Array.isArray(s.cycles) || !s.cycles.length) return null;
      s.cycles = s.cycles.filter((c) => c && typeof c === 'object' && c.id);
      if (!s.cycles.length) return null;
      s.cycles.forEach((c) => {
        if (!c.draws || typeof c.draws !== 'object') c.draws = {};
        if (!c.theme || !themeById(c.theme)) c.theme = 'move';
        if (!c.startDate) c.startDate = dateKey(new Date());
        if (!c.status) c.status = 'active';
      });
      if (!s.cycles.some((c) => c.id === s.activeCycleId)) s.activeCycleId = s.cycles[s.cycles.length - 1].id;
      return s;
    },

    load() {
      let raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch (err) { return null; }
      if (!raw) return null;                        // 真的首次运行

      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (err) { parsed = null; }

      if (parsed && parsed.schema === SCHEMA) {
        const ok = this.normalize(parsed);
        if (ok) return ok;
      }

      if (parsed && MIGRATIONS[parsed.schema]) {
        try {
          const next = this.normalize(MIGRATIONS[parsed.schema](parsed));
          if (next) { next.schema = SCHEMA; this.state = next; this.save(); return next; }
        } catch (err) { /* 迁移失败就走备份 */ }
      }

      // 认不出来：原样备份，绝不静默丢弃
      this.quarantine(raw, parsed && parsed.schema);
      return null;
    },

    /** 首次运行：铺一个"已经走了 6 天"的真实场景，让 Demo 一打开就有内容可看 */
    seed() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const start = addDays(today, -6);
      const theme = 'move';
      const rand = mulberry32(hashStr('cijian-seed'));

      const state = {
        schema: SCHEMA,
        createdAt: new Date().toISOString(),
        settings: {
          mode: 'light',
          reminderTime: '09:00',
          streakReminder: true,
          reduceMotion: false,
          sound: false,
          skipRest: true,
          /* 这两个是「界面长什么样」的那一组设置。
             **种子状态必须和 normalize() 的默认值保持一致** ——
             这里不走 normalize，漏一个就会在设置页显示成 undefined
             （glassBlur 就这么漏过一次）。 */
          accent: 'auto',
          glassBlur: 50,
        },
        activeCycleId: 'cyc-1',
        cycles: [
          {
            id: 'cyc-1',
            theme,
            keyword: '动起来',
            startDate: dateKey(start),
            status: 'active',
            draws: {},
            createdAt: new Date().toISOString(),
          },
        ],
        checkins: [],
        archived: [],
      };

      // 已完成的 6 天（第 5 天空着，用来展示"空白相纸也很温柔"）
      const pool = tasksOf(theme).slice();
      const doneDays = [1, 2, 3, 4, 6];
      const notes = [
        '今天走的这条路拐进了一个我从没见过的小巷，墙上爬满了不知名的藤。站在那儿的时候，我忽然觉得"迷路"这件事没那么可怕。',
        '一开始觉得有点傻，音乐响起来的第三十秒忽然就松了。原来身体比我诚实得多。',
        '用左手夹菜，掉了两次。那种笨拙让我想起小学第一次拿筷子，当时一点也不觉得丢人。',
        '对着镜子做鬼脸，做到第三次的时候自己笑场了。我好像很久没有这样直视过自己。',
        '爬到第七层的时候，呼吸突然变深了。站在楼梯尽头的窗边，看见楼下一棵树的顶。',
      ];
      const emoIds = ['bright', 'warm', 'tender', 'calm', 'awake'];
      // 打卡时刻也做得真实一点：人不会每天同一分钟打卡，回顾页的「最常打卡时段」才有意义
      const hours = [21, 8, 19, 23, 7];

      doneDays.forEach((day, idx) => {
        const task = pool[idx % pool.length];
        const at = addDays(start, day - 1);
        at.setHours(hours[idx % hours.length], (idx * 17) % 60, 0, 0);
        state.checkins.push({
          id: `ck-${day}`,
          cycleId: 'cyc-1',
          dayNumber: day,
          taskId: task.id,
          photo: null,
          photoSeed: hashStr(task.id + day) % 100000,
          reflection: notes[idx] || '',
          polished: null,
          emotion: emoIds[idx % emoIds.length],
          createdAt: at.toISOString(),
        });
      });

      // 今日（第 7 天）已抽到的卡
      const drawn = pool[6];
      state.cycles[0].draws[7] = { taskId: drawn.id, redrawUsed: true, at: new Date().toISOString() };
      void rand;

      this.state = state;
      this.save();
      return state;
    },

    init() {
      this.state = this.load() || this.seed();
      return this.state;
    },

    reset(withSeed) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        /* ignore */
      }
      this.state = withSeed === false ? this.blank() : this.seed();
      this.save();
      this.emit();
    },

    blank() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return {
        schema: SCHEMA,
        createdAt: new Date().toISOString(),
        settings: {
          mode: 'light',
          reminderTime: '09:00',
          streakReminder: true,
          reduceMotion: false,
          sound: false,
          skipRest: true,
          /* 这两个是「界面长什么样」的那一组设置。
             **种子状态必须和 normalize() 的默认值保持一致** ——
             这里不走 normalize，漏一个就会在设置页显示成 undefined
             （glassBlur 就这么漏过一次）。 */
          accent: 'auto',
          glassBlur: 50,
        },
        activeCycleId: 'cyc-blank',
        cycles: [
          {
            id: 'cyc-blank',
            theme: 'move',
            keyword: '动起来',
            startDate: dateKey(today),
            status: 'active',
            draws: {},
            createdAt: new Date().toISOString(),
          },
        ],
        checkins: [],
        archived: [],
      };
    },

    /* ------- 选择器 ------- */
    activeCycle() {
      const s = this.state;
      return s.cycles.find((c) => c.id === s.activeCycleId) || s.cycles[s.cycles.length - 1];
    },
    /* 周期内的第几天，**不钳制**。
       钳制会带来两个连锁问题：第 16 天之后永远显示「第 15 天」，
       而且 app.js 的跨天监听比较的正是这个钳制值，跨天刷新一起失灵。
       另外用本地年月日差而不是毫秒差 —— 夏令时那天只有 23 小时，
       Math.floor(ms / 86400000) 会少算一天，之后整轮都差一天。 */
    dayIndex(cycle) {
      const start = fromKey(cycle.startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return Math.round((today - start) / 86400000) + 1;
    },
    /** 对外仍叫 dayNumber，钳到 1..15 */
    dayNumber(cycle) {
      return Math.max(1, Math.min(CYCLE_DAYS, this.dayIndex(cycle)));
    },
    /** 这一轮是否已经走完（第 16 天及以后） */
    isCycleComplete(cycle) {
      return this.dayIndex(cycle) > CYCLE_DAYS;
    },
    /* 开始下一轮：当前轮归档，新建一轮并激活。
       以前根本没有这条路 —— 走完 15 天之后应用就永久卡死：
       标题永远「第 15 天」、抽卡和打卡永远说「今天已经收藏好了」，
       再也记不了任何一天，界面上也没有任何出口。 */
    startNextCycle() {
      const s = this.state;
      const cur = this.activeCycle();
      if (cur) {
        cur.status = 'done';
        if (!s.archived.includes(cur.id)) s.archived.push(cur.id);
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const prev = cur && cur.theme;
      const i = THEME_ORDER.indexOf(prev);
      const theme = THEME_ORDER[(i + 1) % THEME_ORDER.length] || 'move';
      const meta = themeById(theme);
      const id = 'cyc-' + Date.now().toString(36);
      s.cycles.push({
        id,
        theme,
        /* 取 meta.name 而不是 meta.keyword —— THEMES 里根本没有 keyword 这个字段，
           原来那行永远落到 `cur.keyword`，也就是把上一轮的主题名抄过来。
           今天没有代码读 cycle.keyword 所以看不出来，但这是埋着的错。 */
        keyword: (meta && meta.name) || (cur && cur.keyword) || '',
        startDate: dateKey(today),
        status: 'active',
        draws: {},
        createdAt: new Date().toISOString(),
      });
      s.activeCycleId = id;
      this.save();
      this.emit();
      return id;
    },
    dayDate(cycle, n) {
      return addDays(fromKey(cycle.startDate), n - 1);
    },
    checkinOf(cycle, n) {
      return this.state.checkins.find((c) => c.cycleId === cycle.id && c.dayNumber === n) || null;
    },
    doneDays(cycle) {
      return this.state.checkins
        .filter((c) => c.cycleId === cycle.id)
        .map((c) => c.dayNumber)
        .sort((a, b) => a - b);
    },
    streak(cycle) {
      const done = new Set(this.doneDays(cycle));
      let best = 0;
      let run = 0;
      for (let i = 1; i <= CYCLE_DAYS; i += 1) {
        if (done.has(i)) {
          run += 1;
          best = Math.max(best, run);
        } else {
          run = 0;
        }
      }
      // 当前连续（从今天往回数）
      let current = 0;
      for (let i = this.dayNumber(cycle); i >= 1; i -= 1) {
        if (done.has(i)) current += 1;
        else break;
      }
      return { best, current };
    },
    badges(cycle) {
      const { best } = this.streak(cycle);
      return BADGES.map((b) => ({ ...b, unlocked: best >= b.days }));
    },

    /* ------- 动作 ------- */
    /* 抽卡。
       forcedId 是用户在牌面上**真正点开的那一张**，必须用它。
       以前这里完全无视用户的选择、自己在候选池里又随机抽一张写入存档，
       于是「翻开的卡」和「记进去的卡」永远是两张不同的卡 ——
       用户看到的任务和实际抽到的任务对不上，几乎每次都错。 */
    drawCard(cycle, day, forcedId) {
      const used = new Set(
        Object.values(cycle.draws || {})
          .map((d) => d.taskId)
          .filter(Boolean)
      );
      const pool = tasksOf(cycle.theme);
      let pick = null;

      if (forcedId) {
        const chosen = pool.find((t) => t.id === forcedId);
        // 只接受「属于本周期主题、且还没被用过」的卡；
        // 越界的 id 一律忽略并回退随机，避免前端传错时把不存在的任务写进存档。
        if (chosen && !used.has(chosen.id)) pick = chosen;
      }
      if (!pick) {
        let candidates = pool.filter((t) => !used.has(t.id));
        if (!candidates.length) {
          candidates = pool.filter((t) => t.id !== (cycle.draws[day] || {}).taskId);
        }
        pick = candidates[Math.floor(Math.random() * candidates.length)] || pool[0];
      }

      cycle.draws[day] = { taskId: pick.id, redrawUsed: false, at: new Date().toISOString() };
      this.save();
      this.emit();
      return taskById(pick.id);
    },
    currentDraw(cycle, day) {
      const d = (cycle.draws || {})[day];
      return d ? taskById(d.taskId) : null;
    },
    canRedraw(cycle, day) {
      const d = (cycle.draws || {})[day];
      return Boolean(d) && !d.redrawUsed;
    },
    redraw(cycle, day) {
      const d = (cycle.draws || {})[day];
      if (!d || d.redrawUsed) return null;
      const used = new Set(Object.values(cycle.draws).map((x) => x.taskId));
      const pool = tasksOf(cycle.theme).filter((t) => t.id !== d.taskId && !used.has(t.id));
      const fallback = tasksOf(cycle.theme).filter((t) => t.id !== d.taskId);
      const list = pool.length ? pool : fallback;
      const pick = list[Math.floor(Math.random() * list.length)];
      cycle.draws[day] = { taskId: pick.id, redrawUsed: true, at: new Date().toISOString() };
      this.save();
      this.emit();
      return taskById(pick.id);
    },
    /** 撤销今日抽卡（仅用于演示：可以重看一次洗牌 + 发牌 + 翻牌的完整动画） */
    clearDraw(cycle, day) {
      if (cycle.draws && cycle.draws[day]) {
        delete cycle.draws[day];
        this.save();
        this.emit();
        return true;
      }
      return false;
    },
    submitCheckin(cycle, day, payload) {
      const existing = this.checkinOf(cycle, day);
      if (existing) return existing;
      const record = {
        id: `ck-${cycle.id}-${day}-${Date.now()}`,
        cycleId: cycle.id,
        dayNumber: day,
        taskId: payload.taskId,
        photo: payload.photo || null,
        photoSeed: hashStr(payload.taskId + day) % 100000,
        reflection: payload.reflection || '',
        polished: payload.polished || null,
        emotion: payload.emotion || 'calm',
        createdAt: new Date().toISOString(),
      };
      this.state.checkins.push(record);
      this.save();
      this.emit();
      return record;
    },
    updateCheckin(id, patch) {
      const rec = this.state.checkins.find((c) => c.id === id);
      if (!rec) return null;
      Object.assign(rec, patch);
      this.save();
      this.emit();
      return rec;
    },

    /** 只看本轮已完成打卡的月份统计（用于回顾页） */
    stats(cycle) {
      const done = this.doneDays(cycle);
      const times = this.state.checkins
        .filter((c) => c.cycleId === cycle.id)
        .map((c) => new Date(c.createdAt).getHours());
      const buckets = {};
      times.forEach((h) => {
        const label = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 14 ? '午间' : h < 18 ? '下午' : h < 22 ? '傍晚' : '深夜';
        buckets[label] = (buckets[label] || 0) + 1;
      });
      const topSlot =
        Object.entries(buckets).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
      const { best, current } = this.streak(cycle);
      return {
        done: done.length,
        empty: CYCLE_DAYS - done.length,
        best,
        current,
        topSlot: topSlot[0],
        words: this.state.checkins
          .filter((c) => c.cycleId === cycle.id)
          .reduce((sum, c) => sum + (c.reflection || '').length, 0),
      };
    },
    exportJSON() {
      return JSON.stringify(this.state, null, 2);
    },
  };

  global.CJ = {
    CYCLE_DAYS,
    SCHEMA,
    THEMES,
    themeById,
    TASKS,
    tasksOf,
    taskById,
    taskOr,
    BADGES,
    EMOTIONS,
    Store,
    utils: {
      pad,
      dateKey,
      addDays,
      fromKey,
      fmtCN,
      fmtSlash,
      WEEK_CN,
      mulberry32,
      hashStr,
    },
  };
})(window);
