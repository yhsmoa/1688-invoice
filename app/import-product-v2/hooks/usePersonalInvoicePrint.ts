'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import type { FtOrderItem } from './useFtData';
import { mergeAndPrint } from '../../../lib/invoicePdfClient';

// ============================================================
// P(PERSONAL) 상품 운송장 출력 — V2 · V3 공용
//
//   · activeItems 의 P 상품 personal_order_no 집합이 바뀌면
//       ① Storage 에 PDF 가 있는지 (/api/ft/personal-invoices/check)
//       ② 이미 어떤 item 조합으로 출력됐는지 (/api/ft/personal-invoice-prints/check)
//     를 조회한다. 배지('운송장 출력') 와 출력 버튼이 같은 근거를 쓴다.
//   · 출력 가능 룰: PDF 존재 + (출력 이력 없음 OR 선택 item ⊆ 이전 출력 조합)
//     → 분실·손상 시 같은 조합 재출력만 허용, 다른 조합은 차단
//   · 출력: signed URL → 병렬 다운로드 → crop + merge + print → 출력 이력 UPSERT
//
// ItemCheck.tsx(V2) 에 인라인으로 있던 로직을 동작 변경 없이 옮겼다.
// 진입점(모달 [송장 출력] / 사이드바 [운송장])별 대상 item 고르기만 호출 측이 한다.
// ============================================================

interface Params {
  selectedUserId: string;
  /** 출력 이력의 printed_by */
  selectedWorker: string;
  /** 화면에 올라온 전체 항목 — PDF 존재·출력 이력 조회 범위 */
  activeItems: FtOrderItem[];
  t: TFunction;
}

const isPersonal = (item: FtOrderItem) => item.shipment_type?.trim().toUpperCase() === 'PERSONAL';

export function usePersonalInvoicePrint({ selectedUserId, selectedWorker, activeItems, t }: Params) {
  // ── activeItems 내 전체 P 상품의 personal_order_no 집합 (안정된 키) ──
  //    배지(운송장 출력) 표시 + 모달 송장 출력 양쪽에서 공유하는 단일 PDF 존재 맵 근거.
  const activePersonalOrderNosKey = useMemo(() => {
    const nos = new Set<string>();
    for (const item of activeItems) {
      if (!isPersonal(item)) continue;
      const no = item.personal_order_no?.trim();
      if (no) nos.add(no);
    }
    return [...nos].sort().join('|');
  }, [activeItems]);

  // Storage 에 PDF 가 존재하는 personal_order_no Set (activeItems 기준 전역)
  const [invoicePdfSet, setInvoicePdfSet] = useState<Set<string>>(new Set());
  const [isCheckingInvoices, setIsCheckingInvoices] = useState(false);

  // ── 운송장 출력 이력 — personal_order_no → 출력된 item_id Set ──
  //    비어있음 = 자유 출력 가능 (첫 출력)
  //    있음 = 선택된 item_ids 가 이 Set 의 부분집합일 때만 재출력 가능
  const [printedItemIdsMap, setPrintedItemIdsMap] = useState<Map<string, Set<string>>>(new Map());

  // ============================================================
  // PDF 존재 조회 — 데이터 로드 시점 (배지 렌더에도 사용)
  //   sort 만 바뀌는 경우엔 key 가 동일 → 재호출되지 않음
  // ============================================================
  useEffect(() => {
    if (!selectedUserId || !activePersonalOrderNosKey) {
      setInvoicePdfSet(new Set());
      return;
    }

    const orderNos = activePersonalOrderNosKey.split('|');
    let cancelled = false;
    (async () => {
      setIsCheckingInvoices(true);
      try {
        const res = await fetch('/api/ft/personal-invoices/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_user_id: selectedUserId,
            order_nos: orderNos,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          console.error('personal-invoices check 실패:', json.error);
          setInvoicePdfSet(new Set());
          return;
        }
        const existing = new Set<string>();
        for (const [no, exists] of Object.entries(json.exists as Record<string, boolean>)) {
          if (exists) existing.add(no);
        }
        setInvoicePdfSet(existing);
      } catch (err) {
        if (!cancelled) {
          console.error('personal-invoices check 오류:', err);
          setInvoicePdfSet(new Set());
        }
      } finally {
        if (!cancelled) setIsCheckingInvoices(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedUserId, activePersonalOrderNosKey]);

  // ============================================================
  // 출력 이력 조회 — PDF 존재 조회와 동일 트리거 (데이터 일관성)
  // ============================================================
  useEffect(() => {
    if (!selectedUserId || !activePersonalOrderNosKey) {
      setPrintedItemIdsMap(new Map());
      return;
    }

    const orderNos = activePersonalOrderNosKey.split('|');
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ft/personal-invoice-prints/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: selectedUserId,
            personal_order_nos: orderNos,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          console.error('personal-invoice-prints check 실패:', json.error);
          setPrintedItemIdsMap(new Map());
          return;
        }
        const map = new Map<string, Set<string>>();
        const raw = json.printedItemIdsByOrderNo as Record<string, string[]>;
        for (const [no, ids] of Object.entries(raw)) {
          map.set(no, new Set(ids));
        }
        setPrintedItemIdsMap(map);
      } catch (err) {
        if (!cancelled) {
          console.error('personal-invoice-prints check 오류:', err);
          setPrintedItemIdsMap(new Map());
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedUserId, activePersonalOrderNosKey]);

  // ── 출력 가능 헬퍼 — 단일 item 의 송장 출력 가능 여부 ──
  //    Storage PDF 존재 + (prints 비어있음 || item.id ∈ prints) 일 때 true.
  const isItemInvoicePrintable = useCallback(
    (item: FtOrderItem): boolean => {
      if (!isPersonal(item)) return false;
      const no = item.personal_order_no?.trim();
      if (!no || !invoicePdfSet.has(no)) return false;
      const printedSet = printedItemIdsMap.get(no);
      if (!printedSet || printedSet.size === 0) return true; // 첫 출력
      return printedSet.has(item.id);                         // 재출력 (조합 안)
    },
    [invoicePdfSet, printedItemIdsMap]
  );

  // ============================================================
  // 송장 출력 — 핵심 로직 (signed URL → 다운로드 → crop + merge + print)
  //   itemIdsByNo: 출력 성공 후 ft_personal_invoice_prints 에 기록할 item_id 매핑.
  // ============================================================
  const printInvoicesByOrderNos = useCallback(
    async (targetNos: string[], itemIdsByNo: Map<string, string[]>) => {
      if (!selectedUserId) return;
      if (targetNos.length === 0) {
        alert(t('importProductV2.alerts.noInvoiceToPrint'));
        return;
      }

      try {
        // 1) signed URL 발급
        const res = await fetch('/api/ft/personal-invoices/signed-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_user_id: selectedUserId,
            order_nos: targetNos,
          }),
        });
        const json = await res.json();
        if (!json.success) {
          alert(json.error || t('importProductV2.alerts.invoiceUrlFailed'));
          return;
        }

        // 2) URL → ArrayBuffer 병렬 다운로드 (Promise.all)
        const urlsMap = json.urls as Record<string, string | null>;
        const downloadTasks = targetNos
          .map((no) => ({ no, url: urlsMap[no] }))
          .filter((task): task is { no: string; url: string } => !!task.url);

        const results = await Promise.all(
          downloadTasks.map(async ({ no, url }) => {
            try {
              const pdfRes = await fetch(url);
              if (!pdfRes.ok) {
                console.error(`PDF 다운로드 실패 (${no}): status=${pdfRes.status}`);
                return null;
              }
              return { no, buffer: await pdfRes.arrayBuffer() };
            } catch (err) {
              console.error(`PDF 다운로드 오류 (${no}):`, err);
              return null;
            }
          })
        );

        const successResults = results.filter(
          (r): r is { no: string; buffer: ArrayBuffer } => r !== null
        );
        const buffers = successResults.map((r) => r.buffer);

        if (buffers.length === 0) {
          alert(t('importProductV2.alerts.invoiceDownloadFailed'));
          return;
        }

        // 3) 크롭 + 병합 + 인쇄
        const result = await mergeAndPrint(buffers);
        if (result.success === 0) {
          alert(t('importProductV2.alerts.invoicePrintFailed'));
          return;
        }

        // 4) 출력 성공한 personal_order_no 들에 대해 prints 기록 UPSERT.
        //    인쇄 실패한 송장은 mergeAndPrint 의 success 카운트로만 알 수 있어
        //    개별 매핑이 어려움 → 다운로드 성공한 송장 모두 기록 (보수적 접근).
        //    재출력 시에도 ON CONFLICT 로 printed_at 만 갱신.
        await Promise.all(
          successResults.map(async ({ no }) => {
            const itemIds = itemIdsByNo.get(no);
            if (!itemIds || itemIds.length === 0) return;
            try {
              const insertRes = await fetch('/api/ft/personal-invoice-prints', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  personal_order_no: no,
                  item_ids: itemIds,
                  user_id: selectedUserId,
                  printed_by: selectedWorker || null,
                }),
              });
              const insertJson = await insertRes.json();
              if (!insertJson.success) {
                console.error(`prints 기록 실패 (${no}):`, insertJson.error);
              }
            } catch (err) {
              console.error(`prints 기록 오류 (${no}):`, err);
            }
          })
        );

        // 5) 로컬 printedItemIdsMap 즉시 갱신 (재호출 없이 UI 반영)
        setPrintedItemIdsMap((prev) => {
          const next = new Map(prev);
          for (const { no } of successResults) {
            const itemIds = itemIdsByNo.get(no);
            if (!itemIds || itemIds.length === 0) continue;
            const existing = new Set(next.get(no) ?? []);
            // 첫 출력만 조합 영구 등록 — 기존 prints 가 비어있을 때만 새 ids 추가.
            // 재출력은 같은 ids 라 차이 없음.
            if (existing.size === 0) {
              for (const id of itemIds) existing.add(id);
            }
            next.set(no, existing);
          }
          return next;
        });
      } catch (err) {
        console.error('송장 출력 오류:', err);
        alert(err instanceof Error ? err.message : t('importProductV2.alerts.invoicePrintError'));
      }
    },
    [selectedUserId, selectedWorker, t]
  );

  // ============================================================
  // 대상 item 목록 → 출력 (진입점 공용)
  //   1) personal_order_no 별 item id 매핑 (P + PDF 매칭만)
  //   2) 출력 가능 룰 검증 — 다른 조합으로 이미 출력된 송장은 차단 안내
  // ============================================================
  const printInvoicesForItems = useCallback(
    (targetItems: FtOrderItem[]) => {
      const itemIdsByNo = new Map<string, string[]>();
      for (const item of targetItems) {
        if (!isPersonal(item)) continue;
        const no = item.personal_order_no?.trim();
        if (!no || !invoicePdfSet.has(no)) continue;
        const arr = itemIdsByNo.get(no) ?? [];
        arr.push(item.id);
        itemIdsByNo.set(no, arr);
      }

      const targetNos: string[] = [];
      const blockedNos: string[] = [];
      for (const [no, ids] of itemIdsByNo.entries()) {
        const printedSet = printedItemIdsMap.get(no);
        if (!printedSet || printedSet.size === 0) {
          targetNos.push(no);
          continue;
        }
        const isSubset = ids.every((id) => printedSet.has(id));
        if (isSubset) targetNos.push(no);
        else blockedNos.push(no);
      }

      if (blockedNos.length > 0) {
        alert(`이미 다른 조합으로 출력된 송장이 있어 차단됩니다:\n${blockedNos.join(', ')}`);
      }
      return printInvoicesByOrderNos(targetNos, itemIdsByNo);
    },
    [invoicePdfSet, printedItemIdsMap, printInvoicesByOrderNos]
  );

  return {
    invoicePdfSet,
    isCheckingInvoices,
    printedItemIdsMap,
    isItemInvoicePrintable,
    printInvoicesForItems,
  };
}
