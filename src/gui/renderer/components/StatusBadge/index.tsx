// 写し元: cc-park `src/gui/renderer/components/StatusBadge/index.tsx` @ `d1f0f2d`（v0.25.0）
import type { CharacterState } from '../../../../types/agent.js';
import { getAppearance } from '../../../../shared/characters.js';
import { inkColor } from '../../colors.js';

interface StatusBadgeProps {
  readonly state: CharacterState;
}

/** 状態ラベルを固定幅で描画する。 */
export const StatusBadge = ({ state }: StatusBadgeProps) => {
  const { color, label } = getAppearance(state);
  return (
    <span className="status-badge" style={{ color: inkColor(color) }}>
      {label}
    </span>
  );
};
