import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { MAX_WORKERS } from '../config/defaults.js';
import { createAgentsObserver } from '../core/agentsDebug.js';
import { checkClaudeVersion, type ClaudeVersionCheck } from '../core/claudeVersion.js';
import { fetchAgents } from '../core/fetchAgents.js';
import { readLedger } from '../core/ledger.js';
import { resolveShellPath } from '../core/shellPath.js';
import { IPC_CHANNELS, type GuiEnvironment, type Snapshot } from './ipc.js';

/**
 * Electron の main プロセス（cc-park `src/gui/main.ts` @ `d1f0f2d` の骨組みを元に、
 * 読み取りの取り次ぎだけを残したもの）。
 *
 * 判断を伴う処理は持たず、ウィンドウ生成と core への取り次ぎだけを行う
 * （ロジックは共有モジュール側でテストする）。
 * ウィンドウを閉じても配下は止めない。配下は Claude Code の background セッションとして動き続ける。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * アプリ名。`electron dist/gui/main.js` のように直接起動すると "Electron" になり、
 * userData の保存先などがその名前になってしまうため、app.whenReady() より前に明示する。
 */
app.setName('cuse');

/** 3 列（左の一覧・中央の会話・右のプレビュー）が並ぶ横長のウィンドウ。 */
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 560;

/** 配色の背景。描画前のちらつきを防ぐため、styles.css の --bg と揃える。 */
const BACKGROUND_COLOR = '#0e1014';

const home = homedir();

/** 起動時に確かめた Claude Code のバージョン。PATH を整えてから確かめる。 */
let claudeVersion: ClaudeVersionCheck = {
  ok: false,
  kind: 'unknown',
  version: null,
  message: 'Claude Code のバージョンを確かめています。',
};

/** 出力仕様の変化の見張り。解釈できない値は main プロセスのログへ値ごとに 1 回出す。 */
const observeAgents = createAgentsObserver({
  warn: (message) => {
    console.warn(message);
  },
});

ipcMain.handle(
  IPC_CHANNELS.getEnvironment,
  (): GuiEnvironment => ({ claudeVersion, maxWorkers: MAX_WORKERS, platform: process.platform }),
);

ipcMain.handle(IPC_CHANNELS.getSnapshot, async (): Promise<Snapshot> => {
  // transcript の読み取りは node 側でしかできないため、ここで合成して renderer へ返す
  const [agents, ledger] = await Promise.all([
    fetchAgents({ all: true, meta: true, home, observe: observeAgents }),
    readLedger({ home }),
  ]);
  return { agents, ledger, at: Date.now() };
});

/** vite の dev サーバ経由で起動する場合の URL。未設定ならビルド済み HTML を読む。 */
const devServerUrl = process.env['CUSE_DEV_SERVER'];

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: 'cuse',
    backgroundColor: BACKGROUND_COLOR,
    // 描画が整うまで待ってから見せ、白い画面のちらつきを防ぐ
    show: false,
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // renderer の中で別のページへ移らせない。外部のリンクは普段のブラウザで開く
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  if (devServerUrl !== undefined && devServerUrl !== '') {
    await window.loadURL(devServerUrl);
    return;
  }
  await window.loadFile(join(HERE, 'renderer', 'index.html'));
};

/**
 * Finder から起動したときは PATH が `/usr/bin:/bin:/usr/sbin:/sbin` しか無く、
 * `~/.local/bin` などに入る `claude` を見つけられない。
 * 最初の取得が走る前に、ログインシェルと同じ PATH へ揃えておく。
 */
const preparePath = async (): Promise<void> => {
  process.env['PATH'] = await resolveShellPath({ home });
};

const prepareVersion = async (): Promise<void> => {
  claudeVersion = await checkClaudeVersion();
};

/*
 * ここで top-level await を使うとモジュール評価が終わらず、Electron の ready
 * イベントが発火しないまま停止する（ESM エントリ固有の制約）。必ず then で受ける。
 */
app
  .whenReady()
  .then(preparePath)
  .then(prepareVersion)
  .then(createWindow)
  .catch((error: unknown) => {
    console.error('ウィンドウの起動に失敗しました:', error);
    app.quit();
  });

app.on('activate', () => {
  // macOS では Dock から再アクティブ化されたときにウィンドウを作り直す
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

// ウィンドウを閉じたらアプリは終える。配下は background セッションなので止まらない
app.on('window-all-closed', () => {
  app.quit();
});
