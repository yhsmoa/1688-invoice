'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import { setInstanceKeyOf } from '../utils/groupKeys';
import { planStickers, type StickerPlan } from '../utils/stickerPlan';
import type { BatchStatus } from './useAllocationBatch';

// ============================================================
// 세트 라벨 스티커 계획 — 미리보기 + 출력 직전 최신 계산
//
//   preview    : 화면 표시용. 페이지가 가진 입고/취소 합계 + 모달을 열 때 받은
//                출력 기록으로 계산한다 (조금 늦을 수 있음 — 숫자 안내용)
//   buildFresh : 출력 직전에 서버에서 구성품·입고/취소·출력 기록을 "다시" 받아 계산한다.
//                두 PC 가 같은 세트를 이어서 작업하는 창을 최소화하기 위해
//                페이지 state 가 아닌 최신 DB 값을 쓴다.
//   overrides  : 작업자가 세트별로 직접 지정한 장수 (BarTender 시절 출력분 보정용)
// ============================================================

interface Params {
  isOpen: boolean;
  alloc: Map<string, number>;
  status: BatchStatus;
  /** 배분 대상 행 조회 (보드 행) */
  rowsById: Map<string, FtOrderItem>;
  /** product_id → 구성품 (형제 포함) */
  partsByProductId: Map<string, FtOrderItem[]>;
  arrivalMap: Map<string, number>;
  cancelMap: Map<string, number>;
  /** 보드의 세트 구성품 id 전체 — 출력 기록 조회 범위 */
  partIds: string[];
}

// ── 공통 조회 헬퍼 ──
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || `${url} 실패`);
  return json.data as T;
}

/** 라벨 스티커 마지막 출력 — 언제·누가·어느 PC */
export interface LastPrint {
  at: string;
  by: string | null;
  station: number | null;
}

interface PrintSummaryEntry {
  barcode: number;
  care: number;
  lastBarcode: LastPrint | null;
}

/** order_item_id[] → 라벨 스티커 출력 장수 + 마지막 출력 정보 */
async function fetchPrintSummary(
  ids: string[]
): Promise<{ qty: Map<string, number>; last: Map<string, LastPrint> }> {
  if (ids.length === 0) return { qty: new Map(), last: new Map() };
  const data = await postJson<Record<string, PrintSummaryEntry>>('/api/label-print-logs/summary', {
    order_item_ids: ids,
  });
  const qty = new Map<string, number>();
  const last = new Map<string, LastPrint>();
  for (const [id, v] of Object.entries(data)) {
    qty.set(id, v.barcode);
    if (v.lastBarcode) last.set(id, v.lastBarcode);
  }
  return { qty, last };
}

/** 세트별 "이미 출력됨" 정보 — 재출력 확인 문구용 */
export interface SetPrintedInfo extends LastPrint {
  /** 출력 기록이 남은 구성품의 색상 (어느 색상 입고 때 뽑았는지) */
  color: string | null;
}

export interface FreshStickerPlan {
  plan: StickerPlan<FtOrderItem>;
  /** product_id → 가장 최근 출력 정보 (출력 기록이 있는 세트만) */
  printedInfo: Map<string, SetPrintedInfo>;
}

export function useStickerPlan({
  isOpen,
  alloc,
  status,
  rowsById,
  partsByProductId,
  arrivalMap,
  cancelMap,
  partIds,
}: Params) {
  const [printedByItem, setPrintedByItem] = useState<Map<string, number>>(new Map());
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());

  // ============================================================
  // 출력 기록 — 모달이 열려 있고 세트 구성품이 바뀔 때 조회
  // ============================================================
  const partIdsKey = useMemo(() => [...partIds].sort().join(','), [partIds]);

  const refreshPrinted = useCallback(async () => {
    if (!partIdsKey) {
      setPrintedByItem(new Map());
      return;
    }
    try {
      setPrintedByItem((await fetchPrintSummary(partIdsKey.split(','))).qty);
    } catch (err) {
      console.error('라벨 출력 기록 조회 오류:', err);
    }
  }, [partIdsKey]);

  useEffect(() => {
    if (isOpen) refreshPrinted();
  }, [isOpen, refreshPrinted]);

  // 모달을 닫으면 직접 지정값 초기화
  useEffect(() => {
    if (!isOpen) setOverrides(new Map());
  }, [isOpen]);

  // ============================================================
  // 미리보기
  // ============================================================
  const preview: StickerPlan<FtOrderItem> = useMemo(
    () =>
      planStickers({
        alloc,
        rowsById,
        partsByProductId,
        arrivalMap,
        cancelMap,
        printedBarcodeByItem: printedByItem,
        includePending: status === 'editing',
        overrides,
      }),
    [alloc, rowsById, partsByProductId, arrivalMap, cancelMap, printedByItem, status, overrides]
  );

  // ============================================================
  // 출력 직전 최신 계산
  //   includePending — 배분이 아직 저장 전이면 true (DB ARRIVAL 에 없으니 더한다)
  // ============================================================
  const buildFresh = useCallback(
    async (includePending: boolean): Promise<FreshStickerPlan> => {
      const productIds = Array.from(
        new Set(
          Array.from(alloc.keys())
            .map((id) => rowsById.get(id))
            .filter((r): r is FtOrderItem => !!r)
            .map(setInstanceKeyOf)
            .filter((v): v is string => v !== null)
        )
      );

      // 세트가 없으면 서버 조회 없이 단품만 계산
      if (productIds.length === 0) {
        const plan = planStickers({
          alloc,
          rowsById,
          partsByProductId: new Map(),
          arrivalMap: new Map(),
          cancelMap: new Map(),
          printedBarcodeByItem: new Map(),
          includePending,
          overrides,
        });
        return { plan, printedInfo: new Map() };
      }

      // ── 1) 구성품 전체 ──
      const parts = await postJson<FtOrderItem[]>('/api/ft/order-items/by-product-ids', {
        product_ids: productIds,
      });
      const ids = parts.map((p) => p.id);

      // ── 2) 입고/취소 합계 + 출력 기록 (병렬) ──
      const [fulfillments, printed] = await Promise.all([
        postJson<{ order_item_id: string; type: string; quantity: number | null }[]>('/api/ft/fulfillments', {
          order_item_ids: ids,
        }),
        fetchPrintSummary(ids),
      ]);

      const freshArrival = new Map<string, number>();
      const freshCancel = new Map<string, number>();
      for (const row of fulfillments) {
        const qty = row.quantity ?? 0;
        if (row.type === 'ARRIVAL') freshArrival.set(row.order_item_id, (freshArrival.get(row.order_item_id) ?? 0) + qty);
        else if (row.type === 'CANCEL') freshCancel.set(row.order_item_id, (freshCancel.get(row.order_item_id) ?? 0) + qty);
      }

      const freshParts = new Map<string, FtOrderItem[]>();
      for (const p of parts) {
        const key = setInstanceKeyOf(p);
        if (!key) continue;
        const list = freshParts.get(key) ?? [];
        list.push(p);
        freshParts.set(key, list);
      }

      const plan = planStickers({
        alloc,
        rowsById,
        partsByProductId: freshParts,
        arrivalMap: freshArrival,
        cancelMap: freshCancel,
        printedBarcodeByItem: printed.qty,
        includePending,
        overrides,
      });

      // ── 세트별 가장 최근 출력 (구성품 중 최신 기록) ──
      const printedInfo = new Map<string, SetPrintedInfo>();
      for (const [productId, list] of freshParts) {
        for (const p of list) {
          const last = printed.last.get(p.id);
          if (!last) continue;
          const prev = printedInfo.get(productId);
          if (!prev || last.at > prev.at) printedInfo.set(productId, { ...last, color: p.china_option1 });
        }
      }

      return { plan, printedInfo };
    },
    [alloc, rowsById, overrides]
  );

  // ── 직접 지정 ──
  const setOverride = useCallback((productId: string, qty: number | null) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      if (qty == null) next.delete(productId);
      else next.set(productId, Math.max(0, Math.floor(qty)));
      return next;
    });
  }, []);

  const resetOverrides = useCallback(() => setOverrides(new Map()), []);

  return { preview, buildFresh, refreshPrinted, overrides, setOverride, resetOverrides };
}

export type StickerPlanState = ReturnType<typeof useStickerPlan>;
