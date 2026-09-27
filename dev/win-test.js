/* ============================================================
   无边框 + 透明窗口的最大化 / 还原行为测试

   用户反馈：「只能最大化，不能回到原来的正常大小」。
   这个组合（frame:false + transparent:true）在 Windows 上确实有一堆
   已知的怪行为，但具体是哪一种必须实测 —— 猜不出来。

   逐步打印 bounds 与 isMaximized，就能看出是哪一环断的：
     · maximize() 之后 isMaximized 仍为 false  → 事件没发
     · unmaximize() 之后 bounds 没变回原尺寸   → 平台不还原
     · unmaximize() 之后 isMaximized 仍为 true → 状态没更新

   用法：electron dev/win-test.js
   ============================================================ */
'use strict';

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 1180, minHeight: 760,
    show: true, frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    titleBarStyle: 'hidden',
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadURL('data:text/html,<body style="background:%23e6dbca"></body>');
  await wait(1200);

  const log = (label) => {
    const b = win.getBounds();
    console.log(
      label.padEnd(26) +
      ' bounds=' + b.x + ',' + b.y + ' ' + b.width + 'x' + b.height +
      '  isMax=' + win.isMaximized() +
      '  isFull=' + win.isFullScreen()
    );
  };
  const disp = screen.getPrimaryDisplay();
  console.log('workArea =', JSON.stringify(disp.workArea), ' bounds =', JSON.stringify(disp.bounds));

  log('初始');

  console.log('--- maximize() ---');
  win.maximize();
  await wait(900);
  log('maximize 之后');

  console.log('--- unmaximize() ---');
  win.unmaximize();
  await wait(900);
  log('unmaximize 之后');

  console.log('--- 再来一轮 ---');
  win.maximize(); await wait(700); log('第二次 maximize');
  win.unmaximize(); await wait(700); log('第二次 unmaximize');

  console.log('--- 对照：不带 transparent 的窗口 ---');
  const plain = new BrowserWindow({ width: 1440, height: 900, show: true, frame: false });
  await plain.loadURL('data:text/html,<body>x</body>');
  await wait(600);
  const plog = (l) => {
    const b = plain.getBounds();
    console.log(l.padEnd(26) + ' bounds=' + b.x + ',' + b.y + ' ' + b.width + 'x' + b.height +
      '  isMax=' + plain.isMaximized());
  };
  plog('plain 初始');
  plain.maximize(); await wait(800); plog('plain maximize');
  plain.unmaximize(); await wait(800); plog('plain unmaximize');

  console.log('--- 方案：不用 maximize()/unmaximize()，改用 setBounds 手动实现 ---');
  const w2 = new BrowserWindow({
    width: 1440, height: 900, x: 133, y: 59,
    minWidth: 1180, minHeight: 760,
    show: true, frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: true, titleBarStyle: 'hidden',
    webPreferences: { backgroundThrottling: false },
  });
  await w2.loadURL('data:text/html,<body style="background:%23e6dbca"></body>');
  await wait(900);

  const d2 = screen.getPrimaryDisplay().workArea;   // DIP
  let saved = null;
  let isMax = false;

  const doToggle = () => {
    if (isMax) {
      if (saved) w2.setBounds(saved);
      isMax = false;
    } else {
      saved = w2.getBounds();
      w2.setBounds({ x: d2.x, y: d2.y, width: d2.width, height: d2.height });
      isMax = true;
    }
  };
  const w2log = (l) => {
    const b = w2.getBounds();
    console.log(l.padEnd(26) + ' bounds=' + b.x + ',' + b.y + ' ' + b.width + 'x' + b.height + '  flag=' + isMax);
  };

  w2log('manual 初始');
  doToggle(); await wait(700); w2log('manual 最大化');
  doToggle(); await wait(700); w2log('manual 还原');
  doToggle(); await wait(700); w2log('manual 再最大化');
  doToggle(); await wait(700); w2log('manual 再还原');

  app.exit(0);
});
