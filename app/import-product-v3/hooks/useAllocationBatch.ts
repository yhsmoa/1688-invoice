'use client';

import { useCallback, useState } from 'react';

// ============================================================
// 배분 배치 — 모달 안에서 한 번의 [저장] 단위로 묶이는 작업 수량
//
//   editing : 입력 중. alloc 은 아직 DB 에 없다 (라벨 계산 시 더해서 본다)
//   saved   : [저장] 성공. alloc 은 이어서 [라벨 스티커]/[케어 라벨] 출력에 쓰려고 남겨 둔다.
//             이 상태에서 어떤 옵션이든 새로 입력하면 → 새 배치 시작 (이전 alloc 버림)
//             (저장된 수량은 이미 DB ARRIVAL 에 반영돼 잔여가 줄어 있으므로 다시 담지 않는다)
//
// 모달을 닫으면 reset.
// ============================================================

export type BatchStatus = 'editing' | 'saved';

export function useAllocationBatch() {
  const [alloc, setAlloc] = useState<Map<string, number>>(new Map());
  const [status, setStatus] = useState<BatchStatus>('editing');

  // ── 옵션 단위 교체 — 그 옵션 행들의 기존 배분을 지우고 새 배분으로 ──
  const setOptionAlloc = useCallback(
    (optionRowIds: string[], optionAlloc: Map<string, number>) => {
      setAlloc((prev) => {
        const next = status === 'saved' ? new Map<string, number>() : new Map(prev);
        for (const id of optionRowIds) next.delete(id);
        for (const [id, qty] of optionAlloc) if (qty > 0) next.set(id, qty);
        return next;
      });
      setStatus('editing');
    },
    [status]
  );

  // ── 행 단위 수정 (오른쪽 표의 작업 셀) ──
  const setRowAlloc = useCallback(
    (rowId: string, qty: number) => {
      setAlloc((prev) => {
        const next = status === 'saved' ? new Map<string, number>() : new Map(prev);
        if (qty > 0) next.set(rowId, qty);
        else next.delete(rowId);
        return next;
      });
      setStatus('editing');
    },
    [status]
  );

  const markSaved = useCallback(() => setStatus('saved'), []);

  const reset = useCallback(() => {
    setAlloc(new Map());
    setStatus('editing');
  }, []);

  /** 저장 안 된 입력이 있는가 (닫기 확인용) */
  const hasPending = status === 'editing' && alloc.size > 0;

  return { alloc, status, setOptionAlloc, setRowAlloc, markSaved, reset, hasPending };
}

export type AllocationBatch = ReturnType<typeof useAllocationBatch>;
