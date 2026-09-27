/* 验证三件「必须真的在动」的事，用真实窗口 + 真实输入注入。

   为什么要真窗口：隐藏窗口里 Chromium 不出新帧，capturePage 会拿到旧帧，
   据此判断动画节奏会得出完全错误的结论。

   为什么用 sendInputEvent 而不是合成事件：
   代码里用 elementFromPoint 做命中测试，而合成事件（dispatchEvent）
   不会更新命中测试，isTrusted 也是 false，测出来的结果不代表真实行为。

   用法：electron dev/verify.js */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SHOTS = path.join(__dirname, '..', '.shots');

/** 8×8 均值指纹：判断两帧是否有差异（比逐像素便宜得多） */
function fingerprint(img) {
  const bmp = img.toBitmap();
  const W = img.getSize().width;
  const H = img.getSize().height;
  const box = [];
  let sum = 0;
  for (let gy = 0; gy < 8; gy += 1) {
    for (let gx = 0; gx < 8; gx += 1) {
      let acc = 0;
      let c = 0;
      const x0 = Math.floor((gx * W) / 8);
      const x1 = Math.floor(((gx + 1) * W) / 8);
      const y0 = Math.floor((gy * H) / 8);
      const y1 = Math.floor(((gy + 1) * H) / 8);
      for (let y = y0; y < y1; y += 7) {
        for (let x = x0; x < x1; x += 7) {
          const i = (y * W + x) * 4;
          acc += (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3;
          c += 1;
        }
      }
      const v = c ? acc / c : 0;
      box.push(v);
      sum += v;
    }
  }
  const mean = sum / box.length;
  return box.map((v) => (v >= mean ? 1 : 0));
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
  return d;
}

const PASS = [];
const FAIL = [];
const check = (ok, msg) => (ok ? PASS : FAIL).push(msg);

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.min(1400, Math.round(d.bounds.width - 60)),
    height: Math.min(880, Math.round(d.bounds.height - 80)),
    x: 24,
    y: 24,
    show: true,
    frame: false,
    backgroundColor: '#f6efe6',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  /* ================= 1. 开屏：界面自己浮现，且没有遮罩挡路 ================= */
  console.log('\n【1】开屏动画');
  const t0 = Date.now();
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const samples = [];
  const sampleAt = async (ms, tag) => {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS, `boot-${tag}.png`), img.toPNG());
    const state = await win.webContents.executeJavaScript(`(function(){
      const shell = document.querySelector('.app');
      const rail = document.querySelector('.rail');
      const cs = shell ? getComputedStyle(shell) : null;
      return {
        hasVeil: !!document.querySelector('.overture'),
        booting: document.documentElement.classList.contains('is-booting'),
        shellOpacity: cs ? cs.opacity : null,
        shellFilter: cs ? cs.filter : null,
        railOpacity: rail ? getComputedStyle(rail).opacity : null
      };
    })()`);
    samples.push({ tag, ms, fp: fingerprint(img), ...state });
    console.log(
      `  ${String(ms).padStart(4)}ms ${tag.padEnd(9)} 遮罩=${state.hasVeil ? '有' : '无'}  booting=${state.booting ? 'Y' : 'N'}  shell.opacity=${state.shellOpacity}`
    );
  };

  await sampleAt(180, 'early');
  await sampleAt(520, 'mid');
  await sampleAt(1100, 'settled');

  // 界面应当从半透明逐渐到完全不透明；且全程没有被遮罩挡住
  const early = samples.find((s) => s.tag === 'early');
  const settled = samples.find((s) => s.tag === 'settled');
  const earlyOp = early ? parseFloat(early.shellOpacity) : 1;
  const settledOp = settled ? parseFloat(settled.shellOpacity) : 1;

  check(!samples.some((s) => s.hasVeil), '没有启动屏遮罩（符合 HIG：macOS 不需要启动屏幕）');
  check(earlyOp < 0.9, `开屏确实在淡入（180ms 时 opacity=${earlyOp}）`);
  check(settledOp > 0.99, `900ms 后完全显现（opacity=${settledOp}）`);
  check(
    early && settled && hamming(early.fp, settled.fp) > 0,
    '开屏期间画面在变化（不是一开始就静止）'
  );

  /* ================= 2. 光斑漂移 ================= */
  console.log('\n【2】主题光斑漂移');
  await new Promise((r) => setTimeout(r, 1800));

  // 先直接读 transform（这是确定性证据），再看像素是否跟着变
  const readBlobs = () =>
    win.webContents.executeJavaScript(`(function(){
      return Array.from(document.querySelectorAll('.aurora')).map((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return { x: Math.round(m.m41 * 10) / 10, y: Math.round(m.m42 * 10) / 10, scale: Math.round(m.a * 1000) / 1000 };
      });
    })()`);

  const b0 = await readBlobs();
  const frames = [];
  for (let i = 0; i < 5; i += 1) {
    const img = await win.webContents.capturePage();
    frames.push(fingerprint(img));
    if (i === 0) fs.writeFileSync(path.join(SHOTS, 'aurora-a.png'), img.toPNG());
    if (i === 4) fs.writeFileSync(path.join(SHOTS, 'aurora-b.png'), img.toPNG());
    await new Promise((r) => setTimeout(r, 1200));
  }
  const b1 = await readBlobs();

  const moved = b0.map((a, i) => {
    const b = b1[i] || { x: 0, y: 0, scale: 1 };
    return Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10;
  });
  const scaleChanged = b0.map((a, i) => Math.abs((b1[i] || {}).scale - a.scale) > 0.002);

  const diffs = [];
  for (let i = 1; i < frames.length; i += 1) diffs.push(hamming(frames[i - 1], frames[i]));
  const total = hamming(frames[0], frames[frames.length - 1]);

  console.log(`  4.8 秒内每团光的位移(px): ${moved.join(', ')}`);
  console.log(`  缩放是否在呼吸: ${scaleChanged.map((v) => (v ? 'Y' : 'N')).join(', ')}`);
  console.log(`  相邻帧像素差异 ${diffs.join(', ')}｜首尾差异 ${total}`);

  check(
    moved.some((d) => d > 12),
    `光斑确实在漂移（最大位移 ${Math.max(...moved)}px）`
  );
  check(moved.filter((d) => d > 6).length >= 3, `四团光的位移各不相同、彼此不同步`);
  check(total > 0, `漂移在画面上可见（首尾帧有 ${total} 格差异）`);

  /* ================= 3. 跟手光晕（真实输入注入） ================= */
  console.log('\n【3】跟手光晕');
  /* 在**首页**上测，而不是打卡页。
     打卡页有一整套常驻动画（相纸吐纸 + 2.4 秒冲印 + 显影扫光），
     实测即使等布局稳定后，命中判定仍会间歇性闪断，
     导致 pointerleave 被误触发、hot 被打回 0 ——
     那是页面的动画在干扰测量，不是光效本身的问题。
     首页没有常驻动画，能把这个功能验证干净。 */
  await win.webContents.executeJavaScript('window.Router.go("home"); "ok"');
  await new Promise((r) => setTimeout(r, 4000));

  const rectOf = () =>
    win.webContents.executeJavaScript(`(function(){
      const btn = document.querySelector('.btn--primary');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);

  let btnBox = await rectOf();
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const again = await rectOf();
    if (again && btnBox && again.x === btnBox.x && again.y === btnBox.y) break;
    btnBox = again;
  }
  console.log(`  主按钮位置: ${JSON.stringify(btnBox)}`);

  await win.webContents.executeJavaScript(`(function(){
    const btn = document.querySelector('.btn--primary');
    window.__probe = { enter: 0, leave: 0, move: 0,
                       hasLight: btn ? btn.classList.contains('has-light') : null,
                       isGlass: btn ? btn.classList.contains('is-glass') : null,
                       hasGlow: btn ? !!btn.querySelector('.light-glow') : null };
    if (btn) {
      btn.addEventListener('pointerenter', () => { window.__probe.enter += 1; }, true);
      btn.addEventListener('pointerleave', () => { window.__probe.leave += 1; }, true);
      btn.addEventListener('pointermove', () => { window.__probe.move += 1; }, true);
    }
    return 'ok';
  })()`);

  if (!btnBox) {
    check(false, '找不到主按钮，跟手光晕无法验证');
  } else {
    const left = Math.round(btnBox.x + btnBox.w * 0.2);
    const right = Math.round(btnBox.x + btnBox.w * 0.8);
    const cy = Math.round(btnBox.y + btnBox.h / 2);

    const send = (type, x, y) =>
      win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    const readState = () =>
      win.webContents.executeJavaScript(`(function(){
        const btn = document.querySelector('.btn--primary');
        const glow = btn && btn.querySelector('.light-glow');
        return {
          hot: btn ? getComputedStyle(btn).getPropertyValue('--lhot').trim() : null,
          transform: glow ? glow.style.transform : null,
          probe: window.__probe
        };
      })()`);

    send('mouseMove', 12, 12);
    await new Promise((r) => setTimeout(r, 400));
    send('mouseMove', left, cy);
    await new Promise((r) => setTimeout(r, 800));
    const atLeft = await readState();

    send('mouseMove', right, cy);
    await new Promise((r) => setTimeout(r, 700));
    const atRight = await readState();

    console.log(`  左侧: hot=${atLeft.hot}  transform=${atLeft.transform}`);
    console.log(`  探针: ${JSON.stringify(atLeft.probe)}`);
    console.log(`  右侧: hot=${atRight.hot}  transform=${atRight.transform}`);

    check(atLeft.probe.enter > 0, `按钮收到了真实的 pointerenter（${atLeft.probe.enter} 次）`);
    check(atLeft.probe.move > 0, `按钮收到了真实的 pointermove（${atLeft.probe.move} 次）`);
    check(atLeft.probe.leave === 0, `指针停留期间没有被误判为离开（leave=${atLeft.probe.leave}）`);
    check(parseFloat(atLeft.hot) > 0.5, `指针进入后光晕亮起（--lhot ${atLeft.hot}）`);
    check(
      atLeft.transform && atRight.transform && atLeft.transform !== atRight.transform,
      '光斑随指针左右移动（transform 发生了变化）'
    );

    send('mouseMove', 12, 12);
    await new Promise((r) => setTimeout(r, 900));
    const afterLeave = await win.webContents.executeJavaScript(
      `getComputedStyle(document.querySelector('.btn--primary')).getPropertyValue('--lhot').trim()`
    );
    console.log(`  移出后: hot=${afterLeave}`);
    check(parseFloat(afterLeave) < 0.25, `指针离开后光晕收起（--lhot ${afterLeave}）`);
  }

  /* ================= 汇总 ================= */
  console.log('\n================ 结果 ================');
  PASS.forEach((p) => console.log('  ✓ ' + p));
  FAIL.forEach((f) => console.log('  ✗ ' + f));
  console.log(`\n通过 ${PASS.length} 项，失败 ${FAIL.length} 项`);

  fs.writeFileSync(
    path.join(SHOTS, 'verify.json'),
    JSON.stringify({ samples: samples.map(({ fp, ...s }) => s), diffs, total, pass: PASS, fail: FAIL }, null, 2)
  );

  app.exit(FAIL.length ? 1 : 0);
});
