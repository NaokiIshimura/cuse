import type { Agent, CharacterState } from '../../src/types/agent.js';

/** テスト用のセッションを作る。必要な項目だけ上書きする。 */
export const makeAgent = (overrides: Partial<Agent> & { readonly name: string }): Agent => ({
  sessionId: `${overrides.name}-session`,
  cwd: '/Users/example/project',
  kind: 'background',
  startedAt: 1_000,
  state: 'working' as CharacterState,
  rawState: 'working',
  pid: undefined,
  id: `${overrides.name}-id`,
  meta: undefined,
  launchApp: undefined,
  ...overrides,
});
