import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron';
import { spawn as spawnPty } from 'node-pty';
import { runKill } from '../commands/kill.js';
import { runStart } from '../commands/start.js';
import { MAX_WORKERS } from '../config/defaults.js';
import { createAgentsObserver } from '../core/agentsDebug.js';
import { checkClaudeVersion, type ClaudeVersionCheck } from '../core/claudeVersion.js';
import { fetchAgents } from '../core/fetchAgents.js';
import { readLedger } from '../core/ledger.js';
import { withoutLeaderToken } from '../core/leaderToken.js';
import { resolveShellPath } from '../core/shellPath.js';
import { defaultDeps } from '../runCli.js';
import { resolveAttachTarget } from './attachTarget.js';
import {
  IPC_CHANNELS,
  type GuiEnvironment,
  type OpenTerminalRequest,
  type OpenTerminalResult,
  type Snapshot,
  type StopWorkerResult,
} from './ipc.js';
import { createLeaderStartup, startupCwd } from './leaderStartup.js';
import { createTerminalManager } from './terminals.js';

/**
 * Electron の main プロセス（cc-park `src/gui/main.ts` @ `d1f0f2d` の骨組みを元に、
 * 読み取りの取り次ぎだけを残したもの）。
 *
 * 判断を伴う処理は持たず、ウィンドウ生成と core への取り次ぎだけを行う
 * （ロジックは共有モジュール側でテストする）。
 * ウィンドウを閉じても指揮役と配下は止めない。埋め込み端末の attach を切るだけで、
 * セッションは Claude Code の background セッションとして動き続ける。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * アプリ名。`electron dist/gui/main.js` のように直接起動すると "Electron" になり、
 * userData の保存先などがその名前になってしまうため、app.whenReady() より前に明示する。
 */
app.setName('cuse');

/**
 * ウィンドウは 1 つだけにする。`cuse start` を何度実行しても、前のウィンドウを前に出す。
 * 指揮役がマシンに 1 人なので、それを映すウィンドウも 1 つでよい。
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (window !== undefined) {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }
});

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

/**
 * アプリを開いたら指揮役をそろえる（`cuse start` と同じ処理）。
 * 指揮役がいなければ起こし、止まっていれば再開し、動いていれば何もしない。
 */
const leaderStartup = createLeaderStartup({
  start: (cwd) => runStart({ cwd }, defaultDeps()),
  hasLeader: async () => {
    const ledger = await readLedger({ home });
    return ledger.kind === 'ok' && ledger.ledger.leader !== null;
  },
  initialCwd: startupCwd(process.cwd(), home),
});

ipcMain.handle(IPC_CHANNELS.ensureLeader, () => leaderStartup.ensure());

/**
 * 指揮役を起こすフォルダを選んでもらう。
 *
 * Finder から開いたときは置き場所が分からず、ホームフォルダは Claude Code が指揮役に使わせないので、
 * 作業するリポジトリなどを人に選んでもらう。
 */
ipcMain.handle(IPC_CHANNELS.chooseLeaderFolder, async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: '指揮役を起こすフォルダ',
    message: '指揮役を起こすフォルダを選んでください（作業するリポジトリなど。ホームフォルダは使えません）',
    buttonLabel: 'ここで起こす',
    defaultPath: home,
    properties: ['openDirectory' as const],
  };
  const picked =
    window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
  const folder = picked.canceled ? undefined : picked.filePaths[0];
  if (folder === undefined) {
    return leaderStartup.status();
  }
  return leaderStartup.ensure(folder);
});

ipcMain.handle(IPC_CHANNELS.getSnapshot, async (): Promise<Snapshot> => {
  // transcript の読み取りは node 側でしかできないため、ここで合成して renderer へ返す
  const [agents, ledger] = await Promise.all([
    fetchAgents({ all: true, meta: true, home, observe: observeAgents }),
    readLedger({ home }),
  ]);
  return { agents, ledger, leaderStartup: leaderStartup.status(), at: Date.now() };
});

/** 出力を送る先のウィンドウ。閉じたあとは送らない。 */
let terminalTarget: WebContents | null = null;

const sendToRenderer = (channel: string, ...args: unknown[]): void => {
  if (terminalTarget !== null && !terminalTarget.isDestroyed()) {
    terminalTarget.send(channel, ...args);
  }
};

/** 埋め込み端末。`claude attach` だけを動かす。指揮役のトークンは渡さない。 */
const terminals = createTerminalManager({
  spawnPty: (file, args, options) =>
    spawnPty(file, [...args], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env as Record<string, string>,
    }),
  cwd: home,
  env: () => ({ ...withoutLeaderToken(process.env), TERM: 'xterm-256color' }),
  onData: (tabId, data) => {
    sendToRenderer(IPC_CHANNELS.terminalData, tabId, data);
  },
  onExit: (tabId, exitCode) => {
    sendToRenderer(IPC_CHANNELS.terminalExit, tabId, exitCode);
  },
});

ipcMain.handle(
  IPC_CHANNELS.openTerminal,
  async (event, request: OpenTerminalRequest): Promise<OpenTerminalResult> => {
    if (typeof request?.tabId !== 'string' || typeof request.sessionId !== 'string') {
      return { ok: false, message: '開く相手が分かりません。' };
    }
    // 開く相手と実行するコマンドは、renderer の値をそのまま使わずに台帳と一覧から決める
    const [agents, ledger] = await Promise.all([fetchAgents({ all: true, home }), readLedger({ home })]);
    const target = resolveAttachTarget(
      request.sessionId,
      ledger.kind === 'ok' ? ledger.ledger : null,
      agents.ok ? agents.agents : [],
    );
    if (!target.ok) {
      return target;
    }
    terminalTarget = event.sender;
    terminals.open(request.tabId, target.shortId, request.cols, request.rows);
    return { ok: true, name: target.name, shortId: target.shortId, role: target.role };
  },
);

ipcMain.on(IPC_CHANNELS.writeTerminal, (_event, tabId: unknown, data: unknown) => {
  if (typeof tabId === 'string' && typeof data === 'string') {
    terminals.write(tabId, data);
  }
});

ipcMain.on(IPC_CHANNELS.resizeTerminal, (_event, tabId: unknown, cols: unknown, rows: unknown) => {
  if (typeof tabId === 'string') {
    terminals.resize(tabId, cols as number, rows as number);
  }
});

ipcMain.on(IPC_CHANNELS.closeTerminal, (_event, tabId: unknown) => {
  if (typeof tabId === 'string') {
    terminals.close(tabId);
  }
});

/**
 * 人が配下を止める。指揮役のトークンは要らないが、止められるのは台帳の配下だけ（runKill が確かめる）。
 */
ipcMain.handle(
  IPC_CHANNELS.stopWorker,
  async (_event, sessionId: unknown, reason: unknown): Promise<StopWorkerResult> => {
    if (typeof sessionId !== 'string' || typeof reason !== 'string' || reason.trim() === '') {
      return { ok: false, message: '止める理由を書いてください。' };
    }
    const outcome = await runKill(
      { name: sessionId, reason: `人がウィンドウから止めた: ${reason.trim()}`, byHuman: true },
      defaultDeps(),
    );
    return outcome.ok
      ? { ok: true, message: outcome.text }
      : { ok: false, message: outcome.error.message };
  },
);

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

  // ウィンドウを閉じたら attach を切る（セッションは止めない）
  window.on('closed', () => {
    terminals.closeAll();
    terminalTarget = null;
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
  // ウィンドウを先に見せてから指揮役をそろえる（起動を待つ間も一覧は見られる）
  .then(() => {
    void leaderStartup.ensure();
  })
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
  terminals.closeAll();
  app.quit();
});
