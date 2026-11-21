import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Notification, shell, type WebContents } from 'electron';
import { spawn as spawnPty } from 'node-pty';
import { runClean } from '../commands/clean.js';
import { runKill } from '../commands/kill.js';
import { approvalNotices } from '../shared/approvalNotices.js';
import { extractPreviewItems, previewKey, type PreviewItem } from '../shared/previewItems.js';
import { buildTranscriptPath } from '../shared/transcriptPath.js';
import { findLastCwd } from '../shared/parseTranscript.js';
import { resolveTerminalLink } from './previewLinks.js';
import { sendToLeader } from './leaderInput.js';
import { parseConversation, type ConversationEntry } from '../shared/conversation.js';
import { readPreviewContent } from '../core/previewContent.js';
import { readTail } from '../core/readOutput.js';
import { execFileRunner } from '../core/runCommand.js';
import type { Agent } from '../types/agent.js';
import { INITIAL_LEADER_PROMPT, RESUME_LEADER_PROMPT, runStart } from '../commands/start.js';
import { MAX_WORKERS } from '../config/defaults.js';
import { createAgentsObserver } from '../core/agentsDebug.js';
import { checkClaudeVersion, type ClaudeVersionCheck } from '../core/claudeVersion.js';
import { fetchAgents } from '../core/fetchAgents.js';
import { readLedger, type Ledger } from '../core/ledger.js';
import { withoutLeaderToken } from '../core/leaderToken.js';
import { resolveShellPath } from '../core/shellPath.js';
import { defaultDeps } from '../runCli.js';
import { resolveAttachTarget } from './attachTarget.js';
import {
  IPC_CHANNELS,
  type GuiEnvironment,
  type OpenTerminalRequest,
  type OpenTerminalResult,
  type OpenPreviewLinkResult,
  type SendToLeaderResult,
  LEADER_TAB_ID,
  type CleanWorkersResult,
  type OpenTrustTerminalRequest,
  type PreviewResult,
  type Snapshot,
  type StopWorkerResult,
} from './ipc.js';
import { createLeaderStartup, startWhenTrusted } from './leaderStartup.js';
import { readFolderTrusted } from '../core/claudeTrust.js';
import { ensureSpawnHelperExecutable } from '../core/ptyHelper.js';
import { installShim, nodeRunnerPath } from './cuseShim.js';
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
  (): GuiEnvironment => ({
    claudeVersion,
    maxWorkers: MAX_WORKERS,
    platform: process.platform,
  }),
);

/**
 * アプリを開いたら指揮役をそろえる（`cuse start` と同じ処理）。
 * 指揮役がいなければ起こし、止まっていれば再開し、動いていれば何もしない。
 */
const leaderStartup = createLeaderStartup((cwd) => runStart({ cwd }, defaultDeps()));

ipcMain.handle(IPC_CHANNELS.ensureLeader, () => leaderStartup.ensure());

/**
 * 指揮役を起こすフォルダを選んでもらう。
 *
 * 置き場所は既定で指揮役の居場所 `~/.cuse/leader`。別の場所（作業するリポジトリなど）で起こしたい人のための口。
 */
ipcMain.handle(IPC_CHANNELS.chooseLeaderFolder, async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: '指揮役を起こすフォルダ',
    message: '指揮役を起こすフォルダを選んでください（ホームフォルダは使えません）',
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
  if (agents.ok) {
    notifyApprovals(agents.agents, ledger.kind === 'ok' ? ledger.ledger : null);
  }
  return { agents, ledger, leaderStartup: leaderStartup.status(), at: Date.now() };
});

/** 前回の一覧。承認待ちになったかを知るため。 */
let lastAgents: readonly Agent[] | null = null;

/**
 * 配下・指揮役が承認待ちになったら OS 通知を出す。ウィンドウを見ている間は出さない（画面で分かるため）。
 * 通知を押すとウィンドウを前に出し、その配下を中央に開く。
 */
const notifyApprovals = (agents: readonly Agent[], ledger: Ledger | null): void => {
  const watched = new Set([
    ...(ledger?.workers.map((worker) => worker.sessionId) ?? []),
    ...(ledger?.leader === null || ledger?.leader === undefined ? [] : [ledger.leader.sessionId]),
  ]);
  const notices = approvalNotices(lastAgents, agents, watched, Date.now());
  lastAgents = agents;
  const [window] = BrowserWindow.getAllWindows();
  if (notices.length === 0 || !Notification.isSupported() || window?.isFocused() === true) {
    return;
  }
  for (const notice of notices) {
    const notification = new Notification({ title: notice.title, body: notice.body });
    notification.on('click', () => {
      const target = BrowserWindow.getAllWindows()[0];
      if (target === undefined) {
        return;
      }
      if (target.isMinimized()) {
        target.restore();
      }
      target.show();
      target.focus();
      target.webContents.send(IPC_CHANNELS.openSession, notice.sessionId);
    });
    notification.show();
  }
};

/** プレビューのために transcript の末尾から読む量。古いものまで拾いすぎないよう、表示の 512KB と同じにする。 */
const PREVIEW_TRANSCRIPT_BYTES = 512 * 1024;

/** そのセッションの作業ディレクトリ（transcript の置き場所を決める）。一覧か台帳から引く。 */
const sessionCwdOf = async (sessionId: string): Promise<string | undefined> => {
  const listed = lastAgents?.find((agent) => agent.sessionId === sessionId)?.cwd;
  if (listed !== undefined) {
    return listed;
  }
  const ledger = await readLedger({ home });
  if (ledger.kind !== 'ok') {
    return undefined;
  }
  return ledger.ledger.leader?.sessionId === sessionId
    ? ledger.ledger.leader.cwd
    : ledger.ledger.workers.find((worker) => worker.sessionId === sessionId)?.cwd;
};

/** そのセッションの transcript の末尾。読めなければ ''。 */
const transcriptChunkOf = async (sessionId: string): Promise<{ readonly chunk: string; readonly cwd: string | null }> => {
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { chunk: '', cwd: null };
  }
  const cwd = await sessionCwdOf(sessionId);
  const path = cwd === undefined ? null : buildTranscriptPath(home, cwd, sessionId);
  if (path === null) {
    return { chunk: '', cwd: cwd ?? null };
  }
  const chunk = await readTail(path, PREVIEW_TRANSCRIPT_BYTES).catch(() => '');
  // 相対パスは、セッションがいま作業している場所（worktree へ移った後の場所）から読む
  return { chunk, cwd: findLastCwd(chunk) ?? cwd ?? null };
};

/**
 * 端末で押されて足したもの（セッションごと）。transcript から拾えるものに加えてプレビューに出す。
 * 足すときに main が確かめたものだけが入る。
 */
const clickedItems = new Map<string, PreviewItem[]>();
const CLICKED_LIMIT = 20;

/** セッションに出てきたファイル・URL（transcript から拾ったものと、端末で押して足したもの）。 */
const previewItemsOf = async (sessionId: string): Promise<PreviewItem[]> => {
  const { chunk } = await transcriptChunkOf(sessionId);
  const extracted = extractPreviewItems(chunk);
  const keys = new Set(extracted.map(previewKey));
  const clicked = (clickedItems.get(sessionId) ?? []).filter((item) => !keys.has(previewKey(item)));
  return [...clicked, ...extracted];
};

/** 会話の画面に出す並び。cuse が指揮役を起こしたときの指示は、人の依頼と見分ける。 */
ipcMain.handle(IPC_CHANNELS.getConversation, async (_event, sessionId: unknown): Promise<ConversationEntry[]> => {
  const { chunk } = await transcriptChunkOf(typeof sessionId === 'string' ? sessionId : '');
  return parseConversation(chunk, { systemPrompts: [INITIAL_LEADER_PROMPT, RESUME_LEADER_PROMPT] });
});

/**
 * 会話の画面から指揮役に送る。送る先は renderer から受け取らず、指揮役のタブ（LEADER_TAB_ID）が
 * 台帳の指揮役に attach しているときだけ書き込む。承認待ち・作業中は送らない（leaderInput.ts）。
 */
ipcMain.handle(IPC_CHANNELS.sendToLeader, (_event, text: unknown): Promise<SendToLeaderResult> =>
  sendToLeader(text, {
    readState: async () => {
      const [agents, ledger] = await Promise.all([fetchAgents({ all: true, home }), readLedger({ home })]);
      const record = ledger.kind === 'ok' ? ledger.ledger.leader : null;
      const command = terminals.commandOf(LEADER_TAB_ID);
      const attachedShortId = command?.kind === 'attach' ? command.shortId : null;
      if (record === null) {
        return { leader: null, attachedShortId };
      }
      const agent = agents.ok ? agents.agents.find((candidate) => candidate.sessionId === record.sessionId) : undefined;
      const shortId = agent?.id ?? record.shortId;
      return {
        leader: shortId === null ? null : { shortId, state: agent?.state ?? null },
        attachedShortId,
      };
    },
    write: (data) => {
      terminals.write(LEADER_TAB_ID, data);
    },
  }),
);

ipcMain.handle(
  IPC_CHANNELS.openPreviewLink,
  async (_event, sessionId: unknown, text: unknown, kind: unknown): Promise<OpenPreviewLinkResult> => {
    if (typeof sessionId !== 'string' || typeof text !== 'string' || (kind !== 'url' && kind !== 'file')) {
      return { ok: false, message: '開くものが分かりません。' };
    }
    const { chunk, cwd } = await transcriptChunkOf(sessionId);
    const resolved = await resolveTerminalLink(text, kind, {
      chunk,
      cwd,
      home,
      now: Date.now(),
      isFile: (path) => stat(path).then((stats) => stats.isFile(), () => false),
    });
    if (!resolved.ok) {
      return resolved;
    }
    const key = previewKey(resolved.item);
    const current = (clickedItems.get(sessionId) ?? []).filter((item) => previewKey(item) !== key);
    clickedItems.set(sessionId, [resolved.item, ...current].slice(0, CLICKED_LIMIT));
    return { ok: true, key };
  },
);

ipcMain.handle(IPC_CHANNELS.getPreviewItems, (_event, sessionId: unknown) =>
  previewItemsOf(typeof sessionId === 'string' ? sessionId : ''),
);

/**
 * プレビューの中身。renderer から来た鍵をそのまま信じず、そのセッションに出てきたものかを
 * transcript から確かめてから読む（セッションに出ていないファイルや URL は開かない）。
 */
ipcMain.handle(
  IPC_CHANNELS.readPreview,
  async (_event, sessionId: unknown, key: unknown, reveal: unknown): Promise<PreviewResult> => {
    const items = await previewItemsOf(typeof sessionId === 'string' ? sessionId : '');
    const item = items.find((candidate) => previewKey(candidate) === key);
    if (item === undefined) {
      return { kind: 'unavailable', message: 'このセッションに出てきたものではないので開きません。' };
    }
    if (item.kind === 'url') {
      return { kind: 'url', url: item.url };
    }
    return readPreviewContent(item, { reveal: reveal === true, runner: execFileRunner });
  },
);

ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_event, sessionId: unknown, url: unknown) => {
  const items = await previewItemsOf(typeof sessionId === 'string' ? sessionId : '');
  if (typeof url !== 'string' || !items.some((item) => item.kind === 'url' && item.url === url)) {
    return false;
  }
  await shell.openExternal(url);
  return true;
});

/**
 * プレビューの Web 表示（<webview>）を隔離する。Node 連携なし・preload なし・専用のセッション領域
 * （保存しない）で、http(s) だけを開く。新しいウィンドウは開かず、普段のブラウザにも渡さない。
 */
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (attachEvent, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    params.partition = 'cuse-preview';
    if (!/^https?:\/\//i.test(params.src ?? '')) {
      attachEvent.preventDefault();
    }
  });
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
});

/** 人が終わった配下を片付ける。トークンは要らないが、台帳の配下だけ・未 commit / 未 push は残す（runClean）。 */
ipcMain.handle(IPC_CHANNELS.cleanWorkers, async (): Promise<CleanWorkersResult> => {
  const outcome = await runClean({ byHuman: true }, defaultDeps());
  return outcome.ok
    ? { ok: true, message: outcome.text, cleaned: outcome.value.cleaned.length }
    : { ok: false, message: outcome.error.message };
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

/**
 * 端末を起こす前に、node-pty の spawn-helper に実行権限があるか確かめる（1 回だけ）。
 * npm で入れた node-pty は実行権限が落ちていることがあり、そのままだと端末が真っ暗になる。
 */
let ptyReady: Promise<string | null> | null = null;
const preparePty = (): Promise<string | null> => {
  ptyReady ??= ensureSpawnHelperExecutable(
    dirname(createRequire(import.meta.url).resolve('node-pty/package.json')),
    { platform: process.platform, arch: process.arch },
  ).then(
    (result) => (result.ok ? null : result.message),
    (error: unknown) => `端末の準備に失敗しました: ${String(error)}`,
  );
  return ptyReady;
};

/** 端末を開く。失敗（node-pty が起きないなど）は理由にして返し、画面に出す。 */
const openTerminalSafely = async (
  open: () => void,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> => {
  const problem = await preparePty();
  if (problem !== null) {
    return { ok: false, message: problem };
  }
  try {
    open();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `端末を起こせませんでした: ${String(error)}` };
  }
};

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
    const opened = await openTerminalSafely(() => {
      terminals.open(request.tabId, { kind: 'attach', shortId: target.shortId }, request.cols, request.rows);
    });
    return opened.ok
      ? { ok: true, name: target.name, shortId: target.shortId, role: target.role }
      : opened;
  },
);

/**
 * 指揮役の居場所を信頼してもらう端末（初回だけ）。
 *
 * そのフォルダで引数なしの claude を動かし、Claude Code 自身の信頼の確認に人が答える
 * （cuse が信頼を書き込むことはしない）。動かせるのは、直前に「信頼していない」と断られたフォルダだけ。
 */
ipcMain.handle(
  IPC_CHANNELS.openTrustTerminal,
  async (event, request: OpenTrustTerminalRequest) => {
    const status = leaderStartup.status();
    if (status.kind !== 'failed' || status.untrustedFolder === null || typeof request?.tabId !== 'string') {
      return { ok: false as const, message: '信頼してもらうフォルダがありません。' };
    }
    const folder = status.untrustedFolder;
    terminalTarget = event.sender;
    return openTerminalSafely(() => {
      terminals.open(request.tabId, { kind: 'trust', folder }, request.cols, request.rows);
    });
  },
);

/**
 * 初回の信頼を待つ間、Claude Code がフォルダを信頼したかを 1.5 秒ごとに読む。
 * 信頼したと読めたら、人がボタンを押さなくても指揮役を起こす（読むだけで、書き込みはしない）。
 */
const TRUST_POLL_MS = 1500;
setInterval(() => {
  if (!terminals.has('trust')) {
    return;
  }
  void startWhenTrusted(leaderStartup, (folder) =>
    readFolderTrusted(folder, { home, env: process.env }),
  );
}, TRUST_POLL_MS).unref();

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
      { name: sessionId, sessionId, reason: `人がウィンドウから止めた: ${reason.trim()}`, byHuman: true },
      defaultDeps(),
    );
    return outcome.ok
      ? { ok: true, message: outcome.text }
      : { ok: false, message: outcome.error.message };
  },
);

/** vite の dev サーバ経由で起動する場合の URL。未設定ならビルド済み HTML を読む。 */
const devServerUrl = process.env['CUSE_DEV_SERVER'];

/**
 * 開発中（`npm run gui:dev`）に Dock とウィンドウへ出すアイコン。
 * .app には electron-packager が assets/icon.icns を入れるので、パッケージ済みのときは何もしない
 * （assets/ は .app に入れない）。
 */
const devIconPath = app.isPackaged ? undefined : join(HERE, '..', '..', 'assets', 'icon.png');

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    ...(devIconPath === undefined ? {} : { icon: devIconPath }),
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
      // 右のプレビューの Web 表示に使う。中身は will-attach-webview で隔離する
      webviewTag: true,
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

const prepareDevIcon = (): void => {
  if (devIconPath !== undefined && process.platform === 'darwin') {
    try {
      app.dock?.setIcon(devIconPath);
    } catch (error) {
      console.warn('開発中のアイコンを設定できませんでした:', error);
    }
  }
};

const prepareVersion = async (): Promise<void> => {
  claudeVersion = await checkClaudeVersion();
};

/**
 * 指揮役が使う cuse コマンドを ~/.cuse/bin/cuse に置く（指揮役をそろえる前に）。
 * アプリの中の CLI を、アプリ自身の Electron で動かすので、人は CLI を入れなくてよい。
 */
const prepareCuseCommand = async (): Promise<void> => {
  try {
    await installShim({
      home,
      // Dock に出ない補助プロセスがあれば、そちらで cuse コマンドを動かす（nodeRunnerPath）
      execPath: nodeRunnerPath(process.execPath, existsSync),
      cliPath: join(app.getAppPath(), 'dist', 'cli.js'),
    });
  } catch (error) {
    console.error('cuse コマンドを置けませんでした:', error);
  }
};

/*
 * ここで top-level await を使うとモジュール評価が終わらず、Electron の ready
 * イベントが発火しないまま停止する（ESM エントリ固有の制約）。必ず then で受ける。
 */
app
  .whenReady()
  .then(prepareDevIcon)
  .then(preparePath)
  .then(prepareVersion)
  .then(prepareCuseCommand)
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
