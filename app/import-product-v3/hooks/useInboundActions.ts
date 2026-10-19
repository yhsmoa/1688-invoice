'use client';

import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type { FtOrderItem, FtUser } from '../../import-product-v2/hooks/useFtData';
import { saveLabelData } from '../../import-product-v2/utils/saveLabelData';
import { printLabels, type AudienceTemplates, type PrintLabelResult } from '../../import-product-v2/utils/printLabels';
import type { LabelType } from '../../../lib/labelTypes';
import { remainingOf } from '../utils/groupKeys';

// ============================================================
// 상품입고 V3 — 저장 / 라벨 즉시 출력 (페이지 → 모달로 내려주는 핸들러)
//
// 저장 = V2 handleReadySave 와 같은 두 호출
//   1) POST /api/ft/fulfillments { items: ARRIVAL[] }
//   2) saveLabelData (BarTender invoiceManager_label, 바코드 있는 행)
// V3 추가 방어
//   · 주문 사용자 ≠ 선택 사용자면 거부 — 배송번호 조회는 사용자 필터가 없다
//   · 저장 직전 서버에서 입고/취소를 다시 받아 한도 재검증 — 모달 열린 사이 다른 PC 저장 대비
//
// 출력 = printLabels(..., mergeSets:false) — 세트 접기는 utils/stickerPlan.ts 가 이미 했다
// ============================================================

interface Params {
  selectedUserId: string;
  selectedUser: FtUser | null;
  users: FtUser[];
  /** Worker 드롭박스 값 → operator_name / printed_by */
  selectedWorker: string;
  selectedPcNo: number | null;
  refreshFulfillments: () => void;
  t: TFunction;
}

type FulfillmentRow = { order_item_id: string; type: string; quantity: number | null };

export function useInboundActions({
  selectedUserId,
  selectedUser,
  users,
  selectedWorker,
  selectedPcNo,
  refreshFulfillments,
  t,
}: Params) {
  // ============================================================
  // 저장
  // ============================================================
  const save = useCallback(
    async (alloc: Map<string, number>, rowsById: Map<string, FtOrderItem>): Promise<boolean> => {
      // ── 선택값 검증 ──
      if (!selectedWorker) {
        alert(t('importProductV3.alerts.selectWorker'));
        return false;
      }
      if (!selectedPcNo) {
        alert(t('importProductV3.alerts.selectPcNo'));
        return false;
      }
      if (!selectedUserId) {
        alert(t('importProductV3.alerts.selectUser'));
        return false;
      }

      const entries = Array.from(alloc.entries())
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => ({ item: rowsById.get(id), qty }))
        .filter((e): e is { item: FtOrderItem; qty: number } => !!e.item);
      if (entries.length === 0) {
        alert(t('importProductV3.alerts.nothingToSave'));
        return false;
      }

      // ── 사용자 일치 ──
      const foreign = entries.filter(({ item }) => item.user_id && item.user_id !== selectedUserId);
      if (foreign.length > 0) {
        const codes = Array.from(
          new Set(foreign.map(({ item }) => users.find((u) => u.id === item.user_id)?.user_code ?? item.user_id ?? '?'))
        ).join(', ');
        alert(t('importProductV3.alerts.userMismatch', { codes }));
        return false;
      }

      try {
        // ── 한도 재검증 (최신 입고/취소) ──
        const checkRes = await fetch('/api/ft/fulfillments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_item_ids: entries.map(({ item }) => item.id) }),
        });
        const checkJson = await checkRes.json();
        if (!checkRes.ok || !checkJson.success) throw new Error(checkJson.error || '입고 수량 확인 실패');

        const freshArrival = new Map<string, number>();
        const freshCancel = new Map<string, number>();
        for (const row of checkJson.data as FulfillmentRow[]) {
          const target = row.type === 'ARRIVAL' ? freshArrival : row.type === 'CANCEL' ? freshCancel : null;
          if (target) target.set(row.order_item_id, (target.get(row.order_item_id) ?? 0) + (row.quantity ?? 0));
        }
        const over = entries.filter(({ item, qty }) => qty > remainingOf(item, freshArrival, freshCancel));
        if (over.length > 0) {
          const list = over
            .map(({ item, qty }) => `${item.item_no ?? item.id}: ${qty} > ${remainingOf(item, freshArrival, freshCancel)}`)
            .join('\n');
          alert(t('importProductV3.alerts.limitChanged', { list }));
          refreshFulfillments();
          return false;
        }

        // ── 1) ft_fulfillments (ARRIVAL) — V2 payload 와 동일 ──
        const fulfillmentItems = entries.map(({ item, qty }) => ({
          order_item_id: item.id,
          type: 'ARRIVAL',
          quantity: qty,
          operator_name: selectedWorker,
          order_no: item.order_no || null,
          item_no: item.item_no || null,
          product_no: item.product_no || null,
          product_id: item.product_id || null,
          user_id: selectedUserId,
        }));

        // ── 2) BarTender 라벨 저장 (바코드 있는 행만) ──
        const barcodeEntries = entries.filter(({ item }) => item.barcode);

        const promises: Promise<unknown>[] = [
          fetch('/api/ft/fulfillments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: fulfillmentItems }),
          }).then(async (res) => {
            const json = await res.json();
            if (!res.ok || !json.success) throw new Error(json.error || '입고 저장 실패');
            return json;
          }),
        ];
        if (barcodeEntries.length > 0) {
          promises.push(
            saveLabelData({
              items: barcodeEntries,
              brand: selectedUser?.brand || null,
              operatorNo: selectedPcNo,
            }).then((result) => {
              if (!result.success) console.error('라벨 저장 실패:', result.error);
              return result;
            })
          );
        }

        await Promise.all(promises);
        refreshFulfillments();
        return true;
      } catch (error) {
        console.error('V3 입고 저장 오류:', error);
        alert(error instanceof Error ? error.message : t('importProductV2.alerts.saveError'));
        return false;
      }
    },
    [selectedWorker, selectedPcNo, selectedUserId, selectedUser, users, refreshFulfillments, t]
  );

  // ============================================================
  // 라벨 즉시 출력
  // ============================================================
  const printLabel = useCallback(
    async (
      rows: { item: FtOrderItem; qty: number }[],
      labelType: LabelType,
      templates: AudienceTemplates
    ): Promise<PrintLabelResult> => {
      if (!selectedPcNo) return { success: false, printed: 0, error: t('importProductV3.alerts.selectPcNo') };
      return printLabels({
        items: rows,
        selectedUser,
        brand: selectedUser?.brand || null,
        stationNo: selectedPcNo,
        labelType,
        templates,
        printedBy: selectedWorker || null,
        mergeSets: false,
      });
    },
    [selectedPcNo, selectedUser, selectedWorker, t]
  );

  return { save, printLabel };
}
