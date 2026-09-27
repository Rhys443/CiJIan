'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bgProtocol = require('./bg-protocol');

/* 自定义协议 bg:// —— 渲染进程用它读用户上传的背景图/视频。
   实现在 bg-protocol.js：和 dev/shot.js 共用同一份，
   免得截图工具里 bg:// 无人处理、底图一律加载失败。 */
bgProtocol.registerScheme();

const { bgDir, resolveBgPath } = bgProtocol;

const REQUIRED_PLAN = {
  sha256: 'e6a509d5096d1f174faede44d5cb616c9c2e127be82f4d9567460a5792b37172',
  bytes: 31649,
  name: '「此间」APP 产品规划与零基础零成本 MVP 落地方案',
  path: 'C:\\Users\\legion\\.dsh\\attachments\\v1\\files\\e6\\e6a509d5096d1f174faede44d5cb616c9c2e127be82f4d9567460a5792b37172\\「此间」APP 产品规划与零基础零成本 MVP 落地方案',
};

let mainWindow = null;

/* 最大化 / 还原完全手写，不用 maximize() / unmaximize()。
   ────────────────────────────────────────────────────────────
   frame:false + transparent:true 的窗口在 Windows 上**根本不被当作可最大化窗口管理**。
   dev/win-test.js 量出来的结果：

                       maximize() 之后                    unmaximize() 之后
     透明无边框        bounds 撑到 0,0 1708×1020，          bounds 纹丝不动，
                       但 isMaximized() 仍是 false          卡在最大化
     普通无边框(对照)  isMaximized() = true                 回到 133,59 1440×902

   也就是说 maximize 事件压根不发 —— 早期那版「只信事件」的 maximizedFlag
   永远是 false，点按钮永远走 maximize 分支。这就是「只能最大化，回不到正常大小」。
   改成自己记正常尺寸 + setBounds()，行为完全确定。 */
let isMaximized = false;
let normalBounds = null;

function createWindow() {
  // 窗口/任务栏图标：打包后由 exe 自带，开发期显式指定
  const iconPath = path.join(__dirname, 'build', 'icon.ico');

  // 注意：BrowserWindow 的 width/height 是 DIP，而 x/y 在 Windows 上是**物理像素**。
  // 两者不能混用，否则在 150% 缩放的屏幕上窗口会比屏幕还大。
  const envInt = (key, fallback) => {
    const v = parseInt(process.env[key] || '', 10);
    return Number.isFinite(v) ? v : fallback;
  };

  mainWindow = new BrowserWindow({
    width: envInt('CJ_WIN_W', 1440),
    height: envInt('CJ_WIN_H', 900),
    x: process.env.CJ_WIN_X !== undefined ? envInt('CJ_WIN_X', 60) : undefined,
    y: process.env.CJ_WIN_Y !== undefined ? envInt('CJ_WIN_Y', 60) : undefined,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    frame: false,
    // 透明窗口 + CSS 圆角。
    // Windows 不会给无边框窗口做 DWM 圆角，窗口永远是个硬矩形，
    // 所以四个角只能靠 CSS 的 border-radius 裁，并且窗口必须真透明，
    // 桌面才能从圆角之外透进来。
    //
    // 旧注释里写「透明窗口会拖累整页合成，内容区会画不出来」——
    // 那是在玻璃还依赖 backdrop-filter 的时候测的。现在玻璃整层已经换成
    // WebGL 光学层，全项目 backdrop-filter 已清零（有自检脚本守着这条），
    // 那个前提不成立了，所以这里重新启用。
    transparent: true,
    backgroundColor: '#00000000',
    /* 关掉系统投影。
       Windows 是围着**矩形窗口**画投影的，不会跟着 CSS 的 border-radius 走 ——
       透明窗口 + CSS 圆角这个组合下，它会在四条边和四个角外侧留下一圈深色残留，
       看上去就是「左边有一条竖线、圆角是方的」，而且三套外观上都有（不是主题问题）。
       A/B 截图对比过：关掉之后边界干净，只留 CSS 圆角。
       不丢东西 —— .app 自己已经有一层跟着圆角走的 CSS 投影，系统那层是重复的。 */
    hasShadow: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  /* 注意：maximize / unmaximize 事件在这个窗口上不会触发（见文件上方说明），
     所以这里不再监听它们 —— 状态由 toggleMaximize 自己维护。 */

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return false;

  /* 取窗口当前所在那块屏的工作区，而不是主屏 ——
     双屏时窗口在副屏上，铺满主屏的工作区会把窗口搬到另一块屏去。 */
  const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;

  if (isMaximized) {
    if (normalBounds) mainWindow.setBounds(normalBounds);
    isMaximized = false;
  } else {
    normalBounds = mainWindow.getBounds();
    mainWindow.setBounds({ x: area.x, y: area.y, width: area.width, height: area.height });
    isMaximized = true;
  }
  mainWindow.webContents.send('window:state', { maximized: isMaximized });
  return isMaximized;
});
ipcMain.handle('window:close', () => mainWindow && mainWindow.close());
ipcMain.handle('window:isMaximized', () => Boolean(mainWindow) && isMaximized);

ipcMain.handle('app:version', () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
}));

ipcMain.handle('plan:verify', () => {
  try {
    const buf = fs.readFileSync(REQUIRED_PLAN.path);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    return {
      found: true,
      ok: sha256 === REQUIRED_PLAN.sha256 && buf.length === REQUIRED_PLAN.bytes,
      sha256,
      bytes: buf.length,
      expectedSha256: REQUIRED_PLAN.sha256,
      expectedBytes: REQUIRED_PLAN.bytes,
      path: REQUIRED_PLAN.path,
    };
  } catch (err) {
    return { found: false, ok: false, error: String(err && err.message ? err.message : err), path: REQUIRED_PLAN.path };
  }
});

ipcMain.handle('data:export', async (_evt, payload) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出「此间」数据备份',
    defaultPath: `cijian-backup-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, path: filePath };
});

ipcMain.handle('open:external', (_evt, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  return true;
});

/* ---------- 背景图/视频 ----------
   文件由主进程复制进 userData/background/，渲染进程只拿到文件名。
   刻意不走 localStorage：一张手机照片 3～8 MB、视频更大，塞进去必然爆配额，
   而配额一爆会连带把打卡数据一起写失败 —— 那才是真正的数据事故。 */
ipcMain.handle('background:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择背景图片或视频',
    properties: ['openFile'],
    filters: [
      { name: '图片与视频', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mov', 'm4v'] },
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] },
      { name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v'] },
    ],
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };

  const src = filePaths[0];
  try {
    const st = await fs.promises.stat(src);
    const MAX = 200 * 1024 * 1024;
    if (st.size > MAX) return { ok: false, error: '文件超过 200 MB，请换小一点的' };

    const dir = bgDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const ext = (path.extname(src) || '').toLowerCase();
    const name = 'bg-' + Date.now() + ext;
    /* 异步复制。这里是主进程，copyFileSync 期间整个界面是冻住的 ——
       200 MB 的视频要冻好几秒，用户会以为程序卡死了。 */
    await fs.promises.copyFile(src, path.join(dir, name));

    // 只留最新一个，避免目录无限膨胀
    for (const f of await fs.promises.readdir(dir)) {
      if (f === name) continue;
      try { await fs.promises.unlink(path.join(dir, f)); } catch (e) { /* 占用中就算了 */ }
    }
    return { ok: true, name, size: st.size };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

app.whenReady().then(() => {
  // bg:// 的实体：把 background 目录里的文件当成正常响应吐回去
  bgProtocol.registerHandler();

  // 开发期自检：设置 CJ_PROBE=1 时用真实主进程跑一遍冒烟测试并截图后退出。
  if (process.env.CJ_PROBE === '1') {
    require('./dev/probe.js').run();
    return;
  }
  if (process.env.CJ_DIAG === '1') {
    require('./dev/diag.js').run();
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
