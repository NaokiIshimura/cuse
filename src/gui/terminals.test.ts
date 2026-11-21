import { describe, expect, it } from 'vitest';
import { clampSize, createTerminalManager, type Pty, type SpawnPty } from './terminals.js';

const fakePty = () => {
  const spawned: { file: string; args: readonly string[]; cols: number; rows: number; pty: FakePty }[] = [];
  const spawnPty: SpawnPty = (file, args, options) => {
    const pty = new FakePty();
    spawned.push({ file, args, cols: options.cols, rows: options.rows, pty });
    return pty;
  };
  return { spawned, spawnPty };
};

class FakePty implements Pty {
  dataListener: ((data: string) => void) | undefined;
  exitListener: ((event: { exitCode: number }) => void) | undefined;
  written: string[] = [];
  sizes: [number, number][] = [];
  killed = false;
  onData = (listener: (data: string) => void) => {
    this.dataListener = listener;
  };
  onExit = (listener: (event: { exitCode: number }) => void) => {
    this.exitListener = listener;
  };
  write = (data: string) => {
    this.written.push(data);
  };
  resize = (cols: number, rows: number) => {
    this.sizes.push([cols, rows]);
  };
  kill = () => {
    this.killed = true;
  };
}

const setup = () => {
  const { spawned, spawnPty } = fakePty();
  const events: string[] = [];
  const manager = createTerminalManager({
    spawnPty,
    cwd: '/h',
    env: () => ({}),
    onData: (tabId, data) => events.push(`data:${tabId}:${data}`),
    onExit: (tabId, code) => events.push(`exit:${tabId}:${code}`),
  });
  return { spawned, events, manager };
};

describe('createTerminalManager', () => {
  it('タブごとに claude attach <短縮 ID> を動かし、出力をタブ付きで返す', () => {
    const { spawned, events, manager } = setup();
    manager.open('leader', 'abcd1234', 120, 40);
    expect(spawned.map(({ file, args, cols, rows }) => ({ file, args, cols, rows }))).toEqual([
      { file: 'claude', args: ['attach', 'abcd1234'], cols: 120, rows: 40 },
    ]);
    spawned[0]?.pty.dataListener?.('hello');
    expect(events).toEqual(['data:leader:hello']);
  });

  it('入力と大きさの変更を渡す', () => {
    const { spawned, manager } = setup();
    manager.open('t', 'id', 80, 24);
    manager.write('t', 'y');
    manager.resize('t', 100, 30);
    expect(spawned[0]?.pty.written).toEqual(['y']);
    expect(spawned[0]?.pty.sizes).toEqual([[100, 30]]);
  });

  it('閉じると attach を切る（すべて閉じるときも）', () => {
    const { spawned, manager } = setup();
    manager.open('a', 'id1', 80, 24);
    manager.open('b', 'id2', 80, 24);
    manager.close('a');
    expect(spawned[0]?.pty.killed).toBe(true);
    expect(manager.has('a')).toBe(false);
    manager.closeAll();
    expect(spawned[1]?.pty.killed).toBe(true);
  });

  it('開き直すと前の attach を切り、前の出力は流さない', () => {
    const { spawned, events, manager } = setup();
    manager.open('a', 'id', 80, 24);
    manager.open('a', 'id', 80, 24);
    expect(spawned[0]?.pty.killed).toBe(true);
    spawned[0]?.pty.dataListener?.('old');
    spawned[1]?.pty.dataListener?.('new');
    expect(events).toEqual(['data:a:new']);
  });

  it('attach が終わったら知らせる', () => {
    const { spawned, events, manager } = setup();
    manager.open('a', 'id', 80, 24);
    spawned[0]?.pty.exitListener?.({ exitCode: 0 });
    expect(events).toEqual(['exit:a:0']);
    expect(manager.has('a')).toBe(false);
  });
});

describe('clampSize', () => {
  it('おかしな値は既定に倒す', () => {
    expect(clampSize(100, 80)).toBe(100);
    expect(clampSize(0, 80)).toBe(80);
    expect(clampSize(1.5, 80)).toBe(80);
    expect(clampSize('9', 80)).toBe(80);
    expect(clampSize(99999, 80)).toBe(80);
  });
});
