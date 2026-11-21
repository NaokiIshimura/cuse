import { useMemo } from 'react';
import { highlightLines } from './highlight.js';

/**
 * 行番号つきで、言語ごとに色を付けて文字を見せる。
 * 色付けは HTML を差し込まず、断片を React の部品として並べる（ファイルの中身を HTML として扱わない）。
 */
export const CodeView = ({
  text,
  language,
  numbered = true,
}: {
  readonly text: string;
  readonly language: string | null;
  readonly numbered?: boolean;
}) => {
  const lines = useMemo(() => highlightLines(text, language), [text, language]);
  return (
    <pre className={language === null ? 'preview-text' : `preview-text hljs language-${language}`}>
      {lines.map((segments, index) => (
        // 行の中身は変わりうるので、行番号を鍵にする
        <div className="preview-text__line" key={index}>
          {numbered ? <span className="preview-text__number">{index + 1}</span> : null}
          <span>
            {segments.length === 0
              ? ' '
              : segments.map((segment, at) =>
                  segment.classes.length === 0 ? (
                    <span key={at}>{segment.text}</span>
                  ) : (
                    <span key={at} className={segment.classes.join(' ')}>
                      {segment.text}
                    </span>
                  ),
                )}
          </span>
        </div>
      ))}
    </pre>
  );
};
