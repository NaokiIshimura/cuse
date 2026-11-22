/**
 * README 冒頭の GIF（docs/cuse.gif）を撮る。
 *
 *   npm run build
 *   node scripts/demo/record.mjs            # Linux で画面が無いときは xvfb-run -a を前につける
 *
 * 本物の `claude` は呼ばない。ダミーの HOME に台帳と transcript を置き、偽の claude（fake-claude.mjs）を
 * PATH の先頭に置いて cuse を動かし、台本（scenario.mjs）どおりに状態を進めながら撮る。
 * 撮るのは Chromium の CDP の `Page.captureScreenshot`（OS の画面収録の権限が要らない。cc-park と同じ）。
 * GIF にまとめるのに ImageMagick（`magick` か `convert`）を使う。
 *
 * オプション:
 *   --out <path>   出力先（既定: docs/cuse.gif）
 *   --home <dir>   ダミーの HOME（既定: 一時ディレクトリ）。画面に出るパスを短くしたいときに使う
 *   --keep         撮ったコマ（PNG）とダミーの HOME を消さずに残す
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareScenario, RECORD_MS, SCENE_AT_MS } from './scenario.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

/** ウィンドウの描画領域。main.ts の既定のウィンドウ（1280x800）と同じにする。 */
const WIDTH = 1280;
const HEIGHT = 800;
/** コマを撮る間隔。Clawd の AA が 200ms ごとに動くので合わせる（App.tsx の ANIMATION_INTERVAL_MS）。 */
const FRAME_MS = 200;
/** 起動してから撮り始めるまで。最初の場面が画面に出そろうのを待つ。 */
const WARMUP_MS = 7000;
const DEBUG_PORT = 9333;

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(REPO, 'docs', 'cuse.gif') },
    home: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** ImageMagick 7 は `magick`、6 は `convert`。 */
const imageMagick = () => {
  for (const command of ['magick', 'convert']) {
    if (spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0) {
      return command;
    }
  }
  throw new Error('ImageMagick（magick か convert）が見つかりません。brew install imagemagick などで入れてください。');
};

const main = async () => {
  const magick = imageMagick();
  if (!existsSync(join(REPO, 'dist', 'gui', 'main.js'))) {
    throw new Error('dist/gui/main.js がありません。先に npm run build を実行してください。');
  }

  const home = values.home === undefined ? mkdtempSync(join(tmpdir(), 'cuse-demo-')) : resolve(values.home);
  const demoDir = join(home, '.demo');
  // 作り直すために消すのは、前にこのスクリプトが作ったダミーの HOME（.demo がある）か空のフォルダだけ。
  // 間違えて本物のフォルダを渡しても消さない
  if (existsSync(home) && readdirSync(home).length > 0 && !existsSync(demoDir)) {
    throw new Error(`${home} は空でなく、デモで作ったフォルダでもないので使いません。空のフォルダか、無いパスを渡してください。`);
  }
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  const binDir = join(demoDir, 'bin');
  const framesDir = join(demoDir, 'frames');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(framesDir, { recursive: true });

  // 偽の claude を PATH の先頭に置く
  copyFileSync(join(HERE, 'fake-claude.mjs'), join(binDir, 'claude'));
  chmodSync(join(binDir, 'claude'), 0o755);
  // cuse は起動時にログインシェルへ PATH を聞く（src/core/shellPath.ts）。本物のシェルだと rc ファイルが
  // PATH を並べ直し、本物の claude が先に見つかるおそれがあるので、いまの PATH をそのまま答えるシェルを渡す
  const fakeShell = join(binDir, 'login-shell');
  writeFileSync(fakeShell, "#!/bin/sh\nprintf '%s' '__CC_PARK_PATH__'; printenv PATH; printf '%s' '__CC_PARK_PATH__'\n");
  chmodSync(fakeShell, 0o755);

  const { scenes } = prepareScenario(home, demoDir);
  scenes[0]();

  const electron = createRequire(import.meta.url)('electron');
  const args = [
    join(REPO, 'dist', 'gui', 'main.js'),
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${join(demoDir, 'user-data')}`,
    // Linux の root（コンテナなど）では Chromium のサンドボックスが起きないため
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ];
  const env = { ...process.env, HOME: home, SHELL: fakeShell, PATH: `${binDir}:${process.env.PATH ?? ''}` };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electron, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });

  try {
    const cdp = await connect();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await sleep(WARMUP_MS);

    const frames = [];
    const startedAt = Date.now();
    let scene = 1;
    while (Date.now() - startedAt < RECORD_MS) {
      const elapsed = Date.now() - startedAt;
      while (scene < scenes.length && elapsed >= SCENE_AT_MS[scene]) {
        scenes[scene]();
        scene += 1;
      }
      const shotAt = Date.now();
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const path = join(framesDir, `frame-${String(frames.length).padStart(3, '0')}.png`);
      writeFileSync(path, Buffer.from(data, 'base64'));
      frames.push({ path, at: shotAt });
      await sleep(Math.max(0, FRAME_MS - (Date.now() - shotAt)));
    }
    cdp.close();

    // コマの間隔は撮った時刻の差にする（撮るのに時間がかかっても、動きの速さを変えない）
    const delayArgs = frames.flatMap((frame, index) => {
      const next = frames[index + 1]?.at ?? frame.at + FRAME_MS * 10;
      return ['-delay', String(Math.max(2, Math.round((next - frame.at) / 10))), frame.path];
    });
    mkdirSync(dirname(values.out), { recursive: true });
    // +remap で全コマを共通の色にそろえないと差分の圧縮が効かない。-dither None は平らな背景の点状のノイズを防ぐ
    const built = spawnSync(
      magick,
      ['-loop', '0', ...delayArgs, '-dither', 'None', '-colors', '128', '+remap', '-layers', 'Optimize', values.out],
      { stdio: 'inherit' },
    );
    if (built.status !== 0) {
      throw new Error('GIF を組み立てられませんでした。');
    }
    console.log(`${values.out} を作りました（${frames.length} コマ）。`);
  } finally {
    app.kill();
    if (!values.keep) {
      rmSync(home, { recursive: true, force: true });
    } else {
      console.log(`コマとダミーの HOME を残しました: ${home}`);
    }
  }
};

/** CDP でウィンドウのページにつなぐ。起動を待つため、つながるまで取り直す。 */
const connect = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
      if (page !== undefined) {
        return await openSocket(page.webSocketDebuggerUrl);
      }
    } catch {
      // まだ起きていない
    }
    await sleep(500);
  }
  throw new Error('cuse のウィンドウにつなげませんでした。');
};

const openSocket = (url) =>
  new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const waiter = pending.get(message.id);
      if (waiter !== undefined) {
        pending.delete(message.id);
        if (message.error === undefined) {
          waiter.resolve(message.result);
        } else {
          waiter.reject(new Error(message.error.message));
        }
      }
    });
    socket.addEventListener('error', () => reject(new Error('CDP につなげませんでした。')));
    socket.addEventListener('open', () => {
      resolveSocket({
        send: (method, params = {}) =>
          new Promise((resolveCall, rejectCall) => {
            const id = nextId++;
            pending.set(id, { resolve: resolveCall, reject: rejectCall });
            socket.send(JSON.stringify({ id, method, params }));
          }),
        close: () => socket.close(),
      });
    });
  });

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
