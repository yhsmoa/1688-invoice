'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// useDragScroll — 넓은 표를 마우스로 잡아 끌어 이동 (손바닥 패닝)
//
//   purchase-agent 장바구니 표의 같은 이름 훅과 동일한 동작.
//
// 동작:
//   · 표 위에서 마우스를 누른 채 끌면 스크롤이 따라온다 (가로·세로·대각선)
//   · 세로는 컨테이너에 세로 스크롤이 있으면 컨테이너를, 없으면 페이지(window)를 움직인다
//   · THRESHOLD(px) 이상 움직여야 패닝 시작 → 단순 클릭(시간 셀 수정·선택)과 충돌하지 않음
//   · 마우스가 표 밖으로 나가도 계속 따라가도록 window 에 리스너를 단다
//   · 실제로 패닝했다면 이어지는 click 1회를 삼킨다 (끌고 놓은 셀의 모달이 열리지 않게)
//
// 반환:
//   · onMouseDown : 스크롤 컨테이너에 연결
//   · isPanning   : 커서·텍스트 선택 방지 클래스 분기용
// ============================================================

/** 이 픽셀 이상 움직여야 '드래그'로 인정 (클릭 오인 방지) */
const THRESHOLD = 5;

/** 드래그 시작을 무시할 요소 — 입력·버튼은 원래 동작 우선 */
const IGNORE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

export function useDragScroll(containerRef: React.RefObject<HTMLElement>) {
  const [isPanning, setIsPanning] = useState(false);

  // ── 드래그 시작 시점 스냅샷 (렌더링과 무관 → ref) ──
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const startScrollTopRef = useRef(0);
  const activeRef = useRef(false);          // 마우스 눌린 상태
  const pannedRef = useRef(false);          // THRESHOLD 를 넘어 실제 패닝했는지
  const selfScrollsYRef = useRef(false);    // 세로를 컨테이너가 담당하는지 (아니면 window)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // 좌클릭(0)·휠클릭(1)만 — 우클릭 메뉴는 그대로
      if (e.button !== 0 && e.button !== 1) return;
      if (IGNORE_TAGS.has((e.target as HTMLElement).tagName)) return;

      const el = containerRef.current;
      if (!el) return;

      activeRef.current = true;
      pannedRef.current = false;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      startScrollLeftRef.current = el.scrollLeft;

      const selfScrollsY = el.scrollHeight > el.clientHeight + 1;
      selfScrollsYRef.current = selfScrollsY;
      startScrollTopRef.current = selfScrollsY ? el.scrollTop : window.scrollY;
    },
    [containerRef],
  );

  // ── window 리스너: 표 밖으로 나가도 드래그 유지 ──
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!activeRef.current) return;
      const el = containerRef.current;
      if (!el) return;

      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;

      if (!pannedRef.current) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        pannedRef.current = true;
        setIsPanning(true);
        window.getSelection()?.removeAllRanges();   // 누르는 순간 잡힌 텍스트 선택 해제
      }

      // 끄는 방향으로 내용이 따라오도록 (PDF 손바닥 방식)
      el.scrollLeft = startScrollLeftRef.current - dx;
      if (selfScrollsYRef.current) {
        el.scrollTop = startScrollTopRef.current - dy;
      } else {
        window.scrollTo({ left: window.scrollX, top: startScrollTopRef.current - dy });
      }
      e.preventDefault();                            // 드래그 중 텍스트 선택 방지
    };

    const handleUp = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      if (pannedRef.current) {
        setIsPanning(false);
        // 패닝 직후의 click 1회를 삼킨다 (놓은 위치의 셀이 수정 모달을 열지 않도록)
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        // click 이 발생하지 않는 경우(표 밖에서 놓음 등)를 대비해 다음 틱에 해제
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      pannedRef.current = false;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [containerRef]);

  return { onMouseDown, isPanning };
}
