/**
 * README の GIF の台本（scripts/demo/record.mjs が使う）。
 *
 * 指揮役に「設定画面にダークモードの切り替えを足して」と頼み、指揮役が 2 つの配下に分ける。
 * 場面ごとに、`claude agents --json` の出力（偽の claude が返す state.json）と transcript を書き足す。
 *
 * 1. 配下 2 つが作業中。指揮役は SettingsPage.tsx を読んだので、右のプレビューにはそのコードが出る
 * 2. toggle-tests が承認待ちになる（左のカードに「開いて承認する」が出る）
 * 3. dark-toggle が終わる。指揮役が差分を確かめて README を読み、右のプレビューが README に変わる
 *
 * 名前・パス・ID はすべて作りもの。
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 場面の切り替わり（撮り始めからのミリ秒）。cuse の取り直しは 2 秒ごとなので、間を 4 秒以上あける。 */
export const SCENE_AT_MS = [0, 4500, 9000];
/** 撮る長さ。最後の場面が出そろってから少し止めておく。 */
export const RECORD_MS = 15_000;

const LEADER = {
  name: 'cuse-leader',
  shortId: 'a1b2c3d4',
  sessionId: 'a1b2c3d4-0000-4000-8000-000000000001',
};

const WORKERS = [
  {
    name: 'dark-toggle',
    shortId: 'b2c3d4e5',
    sessionId: 'b2c3d4e5-0000-4000-8000-000000000002',
    task: '設定画面にダークモードの切り替えを足し、README に使い方を書く',
  },
  {
    name: 'toggle-tests',
    shortId: 'c3d4e5f6',
    sessionId: 'c3d4e5f6-0000-4000-8000-000000000003',
    task: 'ダークモードの切り替えのテストを書く',
  },
];

/**
 * 前の依頼で動かして、もう終わった配下。左の一覧の「DONE」に出す。
 * 動いている配下は上限（3）より少なくしておく（上限に達すると上端に警告が出て、見せたいものが紛れるため）。
 */
const FINISHED_WORKER = {
  name: 'lint-fix',
  shortId: 'e5f6a7b8',
  sessionId: 'e5f6a7b8-0000-4000-8000-000000000005',
  task: 'lint の警告を直す',
};

const SETTINGS_PAGE = `import { useState } from 'react';
import { Section } from '../components/Section';
import { Switch } from '../components/Switch';
import { useSettings } from './useSettings';

/** 設定画面。項目はセクションごとにまとめる。 */
export const SettingsPage = () => {
  const { settings, update } = useSettings();
  const [saving, setSaving] = useState(false);

  const save = async (patch: Partial<typeof settings>) => {
    setSaving(true);
    await update(patch);
    setSaving(false);
  };

  return (
    <main className="settings">
      <h1>設定</h1>
      <Section title="通知">
        <Switch
          label="新しいコメントを知らせる"
          checked={settings.notifyComments}
          disabled={saving}
          onChange={(value) => save({ notifyComments: value })}
        />
      </Section>
      <Section title="表示">
        <Switch
          label="サイドバーを畳む"
          checked={settings.compactSidebar}
          disabled={saving}
          onChange={(value) => save({ compactSidebar: value })}
        />
      </Section>
    </main>
  );
};
`;

const README_AFTER = `# notes-app

チームで使うメモアプリです。

## ダークモード

設定画面の「表示」から切り替えられます。

| 設定 | 動き |
| --- | --- |
| 自動 | OS の外観に合わせる（既定） |
| ライト | いつも明るい配色 |
| ダーク | いつも暗い配色 |

切り替えはすぐに反映され、次に開いたときも同じ配色で始まります。

## 開発

\`\`\`bash
npm install
npm run dev
\`\`\`
`;

/** cwd を transcript の置き場所の名前にする（src/shared/transcriptPath.ts と同じ）。 */
const encodeProjectDir = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

const transcriptPath = (home, cwd, sessionId) =>
  join(home, '.claude', 'projects', encodeProjectDir(cwd), `${sessionId}.jsonl`);

/** transcript の 1 行を組み立てる。中身に要る項目だけ。 */
const createWriter = (home, cwd, sessionId) => {
  const path = transcriptPath(home, cwd, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
  let count = 0;
  let clock = Date.now() - 20 * 60_000;
  const write = (entry) => {
    count += 1;
    clock += 20_000;
    const line = {
      parentUuid: null,
      isSidechain: false,
      userType: 'external',
      cwd,
      sessionId,
      version: '2.1.330',
      uuid: `${sessionId.slice(0, 8)}-0000-4000-9000-${String(count).padStart(12, '0')}`,
      timestamp: new Date(clock).toISOString(),
      ...entry,
    };
    appendFileSync(path, `${JSON.stringify(line)}\n`);
  };
  const usage = { input_tokens: 12, cache_creation_input_tokens: 4000, cache_read_input_tokens: 38_000, output_tokens: 300 };
  return {
    user: (text) => {
      write({ type: 'user', message: { role: 'user', content: text } });
      write({ type: 'last-prompt', lastPrompt: text });
    },
    text: (text) => write({ type: 'assistant', message: { role: 'assistant', model: 'claude-demo', content: [{ type: 'text', text }], usage } }),
    tool: (id, name, input) =>
      write({ type: 'assistant', message: { role: 'assistant', model: 'claude-demo', content: [{ type: 'tool_use', id, name, input }], usage } }),
    result: (id, content) =>
      write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } }),
  };
};

const writeFile = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/**
 * 撮影の準備。ダミーの HOME に台帳・作業ディレクトリ・transcript を置き、
 * 場面を進める関数を返す。
 */
export const prepareScenario = (home, demoDir) => {
  const repo = join(home, 'work', 'notes-app');
  const leaderCwd = join(home, '.cuse', 'leader');
  const worktreeOf = (name) => join(repo, '.claude', 'worktrees', name);
  mkdirSync(leaderCwd, { recursive: true });

  writeFile(join(repo, 'src', 'settings', 'SettingsPage.tsx'), SETTINGS_PAGE);
  for (const worker of WORKERS) {
    writeFile(join(worktreeOf(worker.name), 'src', 'settings', 'SettingsPage.tsx'), SETTINGS_PAGE);
  }
  writeFile(join(worktreeOf('dark-toggle'), 'README.md'), README_AFTER);

  const now = Date.now();
  const startedAt = now - 25 * 60_000;
  writeFile(
    join(home, '.cuse', 'ledger.json'),
    `${JSON.stringify(
      {
        version: 1,
        leader: {
          ...LEADER,
          startedAt: new Date(startedAt).toISOString(),
          cwd: leaderCwd,
          permissionMode: null,
          tokenHash: null,
        },
        workers: [FINISHED_WORKER, ...WORKERS].map((worker, index) => ({
          ...worker,
          cwd: repo,
          worktree: worktreeOf(worker.name),
          startedAt: new Date(now - (index === 0 ? 48 : 15 - index) * 60_000).toISOString(),
          endedAt: index === 0 ? new Date(now - 31 * 60_000).toISOString() : null,
          endReason: index === 0 ? '作業を終えた' : null,
          promptCount: 1,
          cleanedAt: null,
        })),
      },
      null,
      2,
    )}\n`,
  );

  // 指揮役の会話（場面 1 の時点まで）
  const leader = createWriter(home, leaderCwd, LEADER.sessionId);
  leader.user('設定画面にダークモードの切り替えを足して。テストと README の説明もお願い');
  leader.text('設定画面のつくりを確かめてから、作業を分けます。');
  leader.tool('toolu_l1', 'Read', { file_path: join(repo, 'src', 'settings', 'SettingsPage.tsx') });
  leader.result('toolu_l1', SETTINGS_PAGE);
  leader.text('切り替えの実装と README を 1 つ、テストを 1 つに分けて、配下に任せます。');
  WORKERS.forEach((worker, index) => {
    const id = `toolu_spawn${index}`;
    leader.tool(id, 'Bash', { command: `cuse spawn ${worker.name} --cwd ~/work/notes-app "${worker.task}"` });
    leader.result(id, `${worker.name}（${worker.shortId}）を起動しました。`);
  });
  leader.text('2 つの配下が作業を始めました。終わったものから差分を確かめて報告します。');
  leader.tool('toolu_wait1', 'Bash', { command: 'cuse wait --any' });

  // 配下の transcript（カードの「最後の指示」と承認待ちの中身に使う）
  const workers = Object.fromEntries(
    [FINISHED_WORKER, ...WORKERS].map((worker) => {
      const writer = createWriter(home, worktreeOf(worker.name), worker.sessionId);
      writer.user(worker.task);
      writer.text('取りかかります。');
      return [worker.name, writer];
    }),
  );

  const agent = (record, cwd, state, minutesAgo, extra = {}) => ({
    id: record.shortId,
    cwd,
    kind: 'background',
    startedAt: now - minutesAgo * 60_000,
    sessionId: record.sessionId,
    name: record.name,
    status: state === 'working' ? 'busy' : 'waiting',
    state,
    ...extra,
  });

  /** 場面ごとの一覧。指揮役は pid を持たせる（cuse は pid のあるものを「動いている」と見て、起こし直さない）。 */
  const writeState = (leaderState, workerStates) => {
    const list = [
      agent(LEADER, leaderCwd, leaderState, 25, { pid: 40_001 }),
      agent(FINISHED_WORKER, worktreeOf(FINISHED_WORKER.name), 'done', 48),
      ...WORKERS.map((worker, index) =>
        agent(worker, worktreeOf(worker.name), workerStates[index], 14 - index, {
          pid: 40_002 + index,
          ...(workerStates[index] === 'blocked' ? { waitingFor: 'permission prompt' } : {}),
        }),
      ),
    ];
    writeFileSync(join(demoDir, 'state.json'), `${JSON.stringify(list, null, 2)}\n`);
  };

  const scenes = [
    () => {
      writeState('working', ['working', 'working']);
    },
    () => {
      workers['toggle-tests'].tool('toolu_t1', 'Bash', { command: 'npm install -D @testing-library/user-event' });
      writeState('working', ['working', 'blocked']);
    },
    () => {
      workers['dark-toggle'].tool('toolu_d1', 'Edit', { file_path: join(worktreeOf('dark-toggle'), 'README.md') });
      workers['dark-toggle'].result('toolu_d1', 'ok');
      workers['dark-toggle'].text('切り替えを足し、README に「ダークモード」の節を書きました。');
      leader.result('toolu_wait1', 'dark-toggle が依頼を待っています。');
      leader.tool('toolu_l2', 'Bash', { command: 'cuse review dark-toggle' });
      leader.result('toolu_l2', ' README.md                     | 14 ++++++++\n src/settings/SettingsPage.tsx | 12 +++++++\n 2 files changed, 26 insertions(+)');
      leader.tool('toolu_l3', 'Read', { file_path: join(worktreeOf('dark-toggle'), 'README.md') });
      leader.result('toolu_l3', README_AFTER);
      leader.text(
        'dark-toggle が終わりました。README に切り替えのしかたが入っています（右のプレビュー）。\n' +
          'toggle-tests は `npm install -D @testing-library/user-event` の承認を待っています。左のカードの「開いて承認する」から確かめてください。',
      );
      writeState('idle', ['idle', 'blocked']);
    },
  ];
  return { scenes };
};
