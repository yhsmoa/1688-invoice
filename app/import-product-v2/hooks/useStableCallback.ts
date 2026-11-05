import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// ============================================================
// useStableCallback — 항상 같은 함수 참조를 돌려주되, 호출하면 최신 클로저를 실행한다
//
// 용도: 테이블 행(ItemTableRow)을 React.memo 로 감싸서 "바뀐 행만 다시 그리기" 위해
//   행에 넘기는 핸들러의 참조가 키 입력마다 바뀌면 안 된다. 그런데 finishEditingCell
//   처럼 cellValue 를 읽는 핸들러는 useCallback 으로는 매 입력마다 새 함수가 된다.
//   → 참조는 고정, 본문은 ref 로 최신화 (React 의 useEffectEvent 와 같은 패턴).
//
// 주의: 렌더 중에 호출하는 용도가 아니라 이벤트 핸들러 전용이다.
// ============================================================
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useIsoLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
