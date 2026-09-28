const { app, BrowserWindow, Menu, Notification, Tray, globalShortcut, ipcMain, nativeImage, powerMonitor, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

// 防止 GPU 进程在 macOS 上崩溃导致整个应用退出（直接运行 Electron 时常见）
app.commandLine.appendSwitch("disable-gpu-compositing");

const APP_NAME = "LifeOS";
const HOST = "127.0.0.1";

let mainWindow = null;
let tray = null;
let serverProcess = null;
let quitting = false;
let scheduleTimer = null;
let serverPort = 0;

app.setName(APP_NAME);
app.userAgentFallback = `${APP_NAME}/${app.getVersion()} Electron/${process.versions.electron}`;

function statePath() {
  return path.join(app.getPath("userData"), "desktop-state.json");
}

function logPath() {
  return path.join(app.getPath("userData"), "desktop.log");
}

function log(message) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(logPath(), `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

const BACKUP_DIR_NAME = `${APP_NAME} 备份`;

function baseUrl() {
  return `http://${HOST}:${serverPort}`;
}

// Packaged builds ship dist/ and a pruned node_modules/ under Resources, so the
// app never depends on a source checkout existing somewhere on disk.
function runtimeRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "runtime") : path.resolve(__dirname, "..");
}

function wranglerCliCandidates() {
  const base = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
  const relative = path.join("node_modules", "wrangler", "bin", "wrangler.js");
  return [
    path.join(base, "app", relative),
    path.join(base, "app.asar.unpacked", relative),
    path.join(base, relative),
  ];
}

function wranglerCliPath() {
  return wranglerCliCandidates().find(fs.existsSync) ?? wranglerCliCandidates()[0];
}

function persistRoot() {
  const dir = path.join(app.getPath("userData"), "database");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stateSourceDir() {
  // `wrangler dev --persist-to DIR` writes the D1 file straight to DIR/v3/…
  return persistRoot();
}

function getBackupDir() {
  return path.join(app.getPath("documents"), BACKUP_DIR_NAME);
}

function backupIdFromDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function directorySize(dirPath) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) total += directorySize(fullPath);
      else if (entry.isFile()) total += fs.statSync(fullPath).size;
    }
  } catch {}
  return total;
}

function copyDirectoryRecursive(source, target) {
  fs.mkdirSync(target, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const dstPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectoryRecursive(srcPath, dstPath);
    else if (entry.isFile()) fs.copyFileSync(srcPath, dstPath);
  }
}

function formatBackupSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createBackupNow(recordCounts = {}) {
  const statePath = stateSourceDir();
  if (!fs.existsSync(statePath)) throw new Error("找不到数据库目录，无法备份");
  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });
  const id = backupIdFromDate(new Date());
  const backupPath = path.join(backupDir, id);
  copyDirectoryRecursive(statePath, path.join(backupPath, "state"));
  const sizeBytes = directorySize(backupPath);
  const manifest = { id, createdAt: new Date().toISOString(), recordCounts, sizeBytes };
  fs.writeFileSync(path.join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { id, createdAt: manifest.createdAt, sizeLabel: formatBackupSize(sizeBytes), recordCounts };
}

function listBackupsNow() {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) return [];
  const backups = [];
  const entries = fs.readdirSync(backupDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(backupDir, entry.name, "manifest.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      backups.push({ id: entry.name, createdAt: manifest.createdAt, sizeLabel: formatBackupSize(manifest.sizeBytes ?? 0), recordCounts: manifest.recordCounts ?? {} });
    } catch {}
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function restoreBackupNow(backupId) {
  const backupPath = path.join(getBackupDir(), backupId);
  const sourceStatePath = path.join(backupPath, "state");
  if (!fs.existsSync(sourceStatePath)) throw new Error("这个备份不存在或已损坏");
  const statePath = stateSourceDir();
  const tempPath = statePath + `.pre-restore-${Date.now()}`;
  if (fs.existsSync(statePath)) fs.renameSync(statePath, tempPath);
  try {
    copyDirectoryRecursive(sourceStatePath, statePath);
    fs.rmSync(tempPath, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(statePath)) fs.rmSync(statePath, { recursive: true, force: true });
    if (fs.existsSync(tempPath)) fs.renameSync(tempPath, statePath);
    throw error;
  }
}

function deleteBackupNow(backupId) {
  const backupPath = path.join(getBackupDir(), backupId);
  if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { recursive: true, force: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(statePath(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function resolveServerRuntimeRoot() {
  const root = runtimeRoot();
  // workerd's static-asset router has historically failed to serve from paths
  // containing non-ASCII characters, so launch through an ASCII alias when the
  // install directory is not plain ASCII.
  if (/^[\x20-\x7E]+$/.test(root)) return root;
  const alias = path.join(app.getPath("temp"), `lifeos-runtime-${process.pid}`);
  try {
    fs.unlinkSync(alias);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  fs.symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  return alias;
}

function missingRuntimeMessage() {
  return `缺少本地运行文件：${wranglerCliPath()}`;
}

// Wrangler's CLI does not initialise under ELECTRON_RUN_AS_NODE, so the shell
// ships a real Node binary and prefers it over anything on the host.
function nodeCandidates() {
  const base = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..");
  const binary = process.platform === "win32" ? "node.exe" : "node";
  return [
    path.join(base, "node", binary),
    path.join(base, "node", "bin", binary),
    path.join(base, "node_modules", ".bin", binary),
  ];
}

function resolveNodeExecutable() {
  const bundled = nodeCandidates().find(fs.existsSync);
  if (bundled) return bundled;
  const fromPath = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, process.platform === "win32" ? "node.exe" : "node"))
    .find(fs.existsSync);
  if (fromPath) return fromPath;
  throw new Error("没有找到可用的 Node.js 运行时，请重新安装应用。");
}

async function workspaceResponse() {
  const response = await fetch(`${baseUrl()}/api/workspace`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`工作台接口返回 ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.tasks) || !data.assistant) throw new Error("当前端口不是个人工作台");
  return data;
}

async function serverIsReady() {
  try {
    await workspaceResponse();
    return true;
  } catch {
    return false;
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once("error", reject);
    tester.listen(0, HOST, () => {
      const { port } = tester.address();
      tester.close(() => resolve(port));
    });
  });
}

async function waitForServer(timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await serverIsReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureServer() {
  if (await serverIsReady()) return;
  if (serverProcess) {
    if (await waitForServer()) return;
    throw new Error("本地服务启动超时");
  }
  if (!fs.existsSync(wranglerCliPath())) throw new Error(missingRuntimeMessage());

  const serverRoot = resolveServerRuntimeRoot();
  serverPort = await findFreePort();
  const logDir = path.join(app.getPath("userData"), "runtime-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const childEnvironment = {
    ...process.env,
    WRANGLER_LOG: "info",
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_LOG_PATH: path.join(logDir, "wrangler.log"),
    LIFEOS_STATE_DIR: stateSourceDir(),
    LIFEOS_BACKUP_DIR: getBackupDir(),
  };

  const nodeExecutable = resolveNodeExecutable();
  log(`starting local server from ${serverRoot} on port ${serverPort} with ${nodeExecutable}`);
  serverProcess = spawn(nodeExecutable, [
    wranglerCliPath(),
    "dev",
    "--config", path.join(serverRoot, "dist", "server", "wrangler.json"),
    "--port", String(serverPort),
    "--ip", HOST,
    "--persist-to", persistRoot(),
  ], {
    cwd: serverRoot,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (chunk) => log(`[server] ${String(chunk).trim()}`));
  serverProcess.stderr.on("data", (chunk) => log(`[server:error] ${String(chunk).trim()}`));
  serverProcess.once("exit", (code, signal) => {
    log(`local server stopped code=${code} signal=${signal}`);
    serverProcess = null;
    if (!quitting) setTimeout(() => void recoverServer(), 1500);
  });
  serverProcess.once("error", (error) => log(`local server spawn failed: ${error.message}`));

  if (!(await waitForServer())) throw new Error("本地服务没有在 45 秒内准备好");
}

async function recoverServer() {
  try {
    await ensureServer();
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(baseUrl());
  } catch (error) {
    log(`server recovery failed: ${error.message}`);
  }
}

function localDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function currentPeriodKey(periodType, now = new Date()) {
  const today = localDateKey(now);
  if (periodType === "daily") return today;
  if (periodType === "monthly") return today.slice(0, 7);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(now);
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const monday = new Date(new Date(`${today}T12:00:00+08:00`).getTime() - ((index + 6) % 7) * 86400000);
  return localDateKey(monday);
}

function isMonthEnd(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function afterReviewTime(reviewTime, now = new Date()) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return time >= reviewTime;
}

function notify(title, body, destination) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: false });
  if (destination) notification.on("click", () => showWindow(destination));
  notification.show();
}

async function postWorkspace(payload) {
  const response = await fetch(`${baseUrl()}/api/workspace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
  return result;
}

async function runBackgroundTasks({ manual = false } = {}) {
  try {
    await ensureServer();
    const data = await workspaceResponse();
    const today = localDateKey();
    const state = readState();
    if (data.assistant?.reviewTime) writeState({ reviewTime: data.assistant.reviewTime });

    if (manual || state.lastBackupDate !== today) {
      try {
        const recordCounts = {
          tasks: data.tasks?.length ?? 0,
          events: data.events?.length ?? 0,
          expenses: data.expenses?.length ?? 0,
          ingredients: data.ingredients?.length ?? 0,
          workouts: data.workouts?.length ?? 0,
          deals: data.deals?.length ?? 0,
        };
        const backup = createBackupNow(recordCounts);
        writeState({ lastBackupDate: today });
        log(`auto backup created: ${backup.id} (${backup.sizeLabel})`);
      } catch (error) {
        log(`auto backup failed: ${error.message}`);
      }
    }

    const assistant = data.assistant;
    if (assistant?.configured && assistant.autoReview && afterReviewTime(assistant.reviewTime || "21:30")) {
      const reviewTime = assistant.reviewTime || "21:30";
      // 复盘数据日期：00:00 执行时复盘前一天（当天数据已完整），否则复盘执行当天
      const dataDate = reviewTime === "00:00"
        ? localDateKey(new Date(new Date(`${today}T12:00:00+08:00`).getTime() - 86400000))
        : today;
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date(`${dataDate}T12:00:00+08:00`));
      const periods = ["daily"];
      if (weekday === "Sun") periods.push("weekly");
      if (isMonthEnd(dataDate)) periods.push("monthly");
      let reviewAllSucceeded = true;
      for (const periodType of periods) {
        const periodKey = currentPeriodKey(periodType, new Date(`${dataDate}T12:00:00+08:00`));
        const exists = assistant.reviews.some((review) => review.periodType === periodType && review.periodKey === periodKey);
        if (exists) continue;
        try {
          await postWorkspace({ kind: "assistant_review_generate", periodType, automatic: true, dataDate });
          const label = periodType === "weekly" ? "本周" : periodType === "monthly" ? "本月" : "今日";
          notify(APP_NAME, `${label}复盘已经生成`, "review");
        } catch (error) {
          reviewAllSucceeded = false;
          log(`review generate failed (${periodType}): ${error.message}`);
        }
      }
      if (!reviewAllSucceeded) {
        const retryCount = (state.reviewRetryCount || 0) + 1;
        if (retryCount <= 3) {
          const retryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          writeState({ reviewRetryCount: retryCount, reviewRetryAt: retryAt });
          log(`review will retry in 30 min (attempt ${retryCount}/3)`);
        } else {
          writeState({ reviewRetryCount: retryCount, reviewRetryAt: "" });
          log(`review exhausted retries (${retryCount}), waiting for tomorrow`);
        }
      } else if (state.reviewRetryCount || state.reviewRetryAt) {
        writeState({ reviewRetryCount: 0, reviewRetryAt: "" });
      }
    }

    if (manual) notify(APP_NAME, "检查完成", "today");
    writeState({ lastBackgroundCheckAt: new Date().toISOString() });
  } catch (error) {
    log(`background check failed: ${error.message}`);
    if (manual) notify(APP_NAME, "这次检查没有完成，请打开工作台查看", "connections");
  } finally {
    scheduleNextBackgroundRun();
  }
}

function scheduleNextBackgroundRun() {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  const now = new Date();
  const state = readState();
  const today = localDateKey(now);
  const reviewTime = state.reviewTime || "21:30";

  // 如果今天复盘失败且有待重试，安排到重试时间
  if (state.reviewRetryAt) {
    const retryAt = new Date(state.reviewRetryAt);
    if (retryAt.getTime() > now.getTime()) {
      log(`scheduling review retry at ${retryAt.toISOString()}`);
      scheduleTimer = setTimeout(() => void runBackgroundTasks(), Math.max(1000, retryAt.getTime() - now.getTime()));
      return;
    }
  }

  let target = new Date(`${today}T${reviewTime}:00+08:00`);
  if (target.getTime() <= now.getTime() + 5000) target = new Date(target.getTime() + 86400000);
  scheduleTimer = setTimeout(() => void runBackgroundTasks(), Math.max(1000, target.getTime() - now.getTime()));
}

function sendNavigation(destination) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("workbench:navigate", destination);
}

function showWindow(destination) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (app.dock) void app.dock.show();
  mainWindow.show();
  mainWindow.focus();
  if (destination) {
    if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", () => sendNavigation(destination));
    else sendNavigation(destination);
  }
}

function setAutostart(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled });
  writeState({ autostartConfigured: true });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "打开工作台", click: () => showWindow("today") },
    { label: "告诉助理…", accelerator: "CommandOrControl+Shift+Space", click: () => showWindow("assistant") },
    { label: "复盘日志", click: () => showWindow("review") },
    { type: "separator" },
    { label: "立即检查", click: () => void runBackgroundTasks({ manual: true }) },
    {
      label: "登录时自动启动",
      type: "checkbox",
      enabled: app.isPackaged,
      checked: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false,
      click: (item) => { setAutostart(item.checked); if (tray) tray.setContextMenu(buildTrayMenu()); },
    },
    { label: "打开备份文件夹", click: () => void shell.openPath(getBackupDir()) },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const source = path.join(runtimeRoot(), "public", "favicon.png");
  const icon = nativeImage.createFromPath(source).resize({ width: 18, height: 18 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => showWindow("today"));
}

function createApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "打开备份文件夹", click: () => void shell.openPath(getBackupDir()) },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { label: "退出", accelerator: "Command+Q", click: () => { quitting = true; app.quit(); } },
      ],
    },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "显示", submenu: [{ role: "reload" }, { role: "togglefullscreen" }] },
  ]));
}

function createWindow(hiddenAtLaunch) {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f7f7f1",
    icon: path.join(runtimeRoot(), "public", "favicon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(baseUrl())) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    }
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    log(`window load failed code=${code} description=${description}`);
    setTimeout(() => void recoverServer(), 1200);
  });
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (app.dock) app.dock.hide();
  });
  mainWindow.once("ready-to-show", () => {
    if (!hiddenAtLaunch) showWindow();
    else if (app.dock) app.dock.hide();
  });
  void mainWindow.loadURL(baseUrl());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow("today"));
  app.whenReady().then(async () => {
    try {
      if (!fs.existsSync(wranglerCliPath())) throw new Error(missingRuntimeMessage());
      await ensureServer();
      if (app.isPackaged && !readState().autostartConfigured) setAutostart(true);
      const openedAtLogin = app.isPackaged && Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
      createApplicationMenu();
      createTray();
      ipcMain.handle("workbench:focus-complete", (_event, minutes) => {
        notify(APP_NAME, `${Number(minutes) || 30} 分钟专注完成`, "review");
        return { ok: true };
      });
      ipcMain.handle("workbench:backup-now", () => {
        try {
          const backup = createBackupNow();
          return { ok: true, backup };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
      ipcMain.handle("workbench:backup-list", () => {
        try {
          return { ok: true, backups: listBackupsNow() };
        } catch (error) {
          return { ok: false, error: error.message, backups: [] };
        }
      });
      ipcMain.handle("workbench:backup-restore", (_event, backupId) => {
        try {
          restoreBackupNow(backupId);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
      ipcMain.handle("workbench:backup-delete", (_event, backupId) => {
        try {
          deleteBackupNow(backupId);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
      createWindow(openedAtLogin || process.argv.includes("--background"));
      globalShortcut.register("CommandOrControl+Shift+Space", () => showWindow("assistant"));
      powerMonitor.on("resume", () => void runBackgroundTasks());
      void runBackgroundTasks();
    } catch (error) {
      log(`startup failed: ${error.stack || error.message}`);
      const failure = new BrowserWindow({ width: 620, height: 260, backgroundColor: "#f7f7f1" });
      const message = encodeURIComponent(`${APP_NAME}没有启动成功\n\n${error.message}\n\n日志：${logPath()}`);
      void failure.loadURL(`data:text/plain;charset=utf-8,${message}`);
    }
  });
}

app.on("activate", () => showWindow("today"));
app.on("before-quit", () => {
  quitting = true;
  if (scheduleTimer) clearTimeout(scheduleTimer);
  globalShortcut.unregisterAll();
  if (serverProcess && !serverProcess.killed) serverProcess.kill("SIGTERM");
});
