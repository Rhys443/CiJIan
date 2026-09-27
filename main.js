'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REQUIRED_PLAN = {
  sha256: 'e6a509d5096d1f174faede44d5cb616c9c2e127be82f4d9567460a5792b37172',
  bytes: 31649,
  name: '「此间」APP 产品规划与零基础零成本 MVP 落地方案',
  path: 'C:\\Users\\legion\\.dsh\\attachments\\v1\\files\\e6\\e6a509d5096d1f174faede44d5cb616c9c2e127be82f4d9567460a5792b37172\\「此间」APP 产品规划与零基础零成本 MVP 落地方案',
};

let mainWindow = null;

/* 自己记最大化状态。
   无边框 + 透明窗口在 Windows 上 isMaximized() 并不可靠：maximize() 之后
   立刻查往往还是 false。于是 toggle 永远走 maximize 分支 ——
   现象就是「只能最大化，回不到原来的大小」。改成只信事件。 */
let maximizedFlag = false;

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
    hasShadow: true,
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

  mainWindow.on('maximize', () => {
    maximizedFlag = true;
    mainWindow.webContents.send('window:state', { maximized: true });
  });
  mainWindow.on('unmaximize', () => {
    maximizedFlag = false;
    mainWindow.webContents.send('window:state', { maximized: false });
  });

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
  // 用自己维护的状态，不用 isMaximized()（见文件上方说明）
  if (maximizedFlag) mainWindow.unmaximize();
  else mainWindow.maximize();
  return maximizedFlag;
});
ipcMain.handle('window:close', () => mainWindow && mainWindow.close());
ipcMain.handle('window:isMaximized', () => Boolean(mainWindow) && maximizedFlag);

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

app.whenReady().then(() => {
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
