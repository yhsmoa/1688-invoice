'use client';

import { useEffect, useState } from 'react';

// ============================================================
// useTopMenuHeight — 상단 메뉴(sticky) 높이
//   sv2-table 머리줄이 상단 메뉴 바로 아래에 붙도록 `--sv2-sticky-top` 으로 넘긴다.
//   메뉴 높이를 실제로 재므로 메뉴가 바뀌어도 맞는다.
//   쓰는 곳: 쉽먼트 V2 표(ShipmentTable) · 통관서류 작성 표(CustomsTable)
// ============================================================
const TOP_MENU_SELECTOR = '.topside-menu';

export function useTopMenuHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(TOP_MENU_SELECTOR);
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return height;
}
