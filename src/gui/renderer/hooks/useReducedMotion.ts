import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * OS の「視差効果を減らす」設定。オンなら Clawd の動きを止める。
 * 設定を変えたらその場で追従する。
 */
export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => {
      setReduced(media.matches);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  return reduced;
};
