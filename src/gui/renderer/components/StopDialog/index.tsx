import { useState } from 'react';

interface StopDialogProps {
  readonly name: string;
  readonly onConfirm: (reason: string) => Promise<string | null>;
  readonly onCancel: () => void;
}

/**
 * 配下を止める前の確認。理由は台帳に残るので必ず書いてもらう。
 * 止めるだけで、会話や変更は消えないことも伝える。
 */
export const StopDialog = ({ name, onConfirm, onCancel }: StopDialogProps) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-label={`${name} を止める`}
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim() === '') {
            setError('理由を書いてください（台帳に残ります）。');
            return;
          }
          setBusy(true);
          void onConfirm(reason.trim()).then((message) => {
            setBusy(false);
            setError(message);
          });
        }}
      >
        <h2 className="dialog__title">{name} を止めますか？</h2>
        <p className="dialog__text">
          claude stop で止めます。会話・変更・worktree は消えません。指揮役から cuse prompt で再開できます。
        </p>
        <label className="dialog__label">
          理由
          <input
            className="dialog__input"
            value={reason}
            autoFocus
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
        {error === null ? null : <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="link-button" onClick={onCancel} disabled={busy}>
            やめる
          </button>
          <button type="submit" className="danger-button" disabled={busy}>
            止める
          </button>
        </div>
      </form>
    </div>
  );
};
