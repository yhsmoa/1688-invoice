'use client';

import { useEffect, useState } from 'react';

// ============================================================
// useDeliveryCodeCandidates — 1688 주문ID 들로 배송번호(운송장) 후보 찾기
//
//   상품입고 [미입고] · [1688 판매자 확인] 모달 공용.
//   · deliveryCode 가 있으면 (배송번호 검색) 그 번호를 그대로 code 로 쓰고 조회하지 않는다
//   · 없으면 주문ID 마다 GET /api/ft/delivery-codes?order_id= 로 1688_invoice_deliveryInfo_check 를
//     역조회해 배송번호 → 주문ID 목록으로 묶는다 (많은 주문을 덮는 번호 먼저, 같으면 번호순)
//   · 후보가 정확히 1개면 자동 선택
//   · 동시 요청은 DELIVERY_CODE_CONCURRENCY 개씩 (배치끼리는 순서대로) — 서버·DB 부하 제한
//   · enabled 가 false 면 (모달 닫힘) 아무것도 하지 않고 상태를 그대로 둔다
// ============================================================

/** 동시에 보내는 /api/ft/delivery-codes 요청 수 (커밋 4994c28 의 배치 동시 호출 상한과 같은 값) */
const DELIVERY_CODE_CONCURRENCY = 8;

export interface DeliveryCandidate {
  code: string;
  /** 이 배송번호로 온 1688 주문ID 들 */
  orderIds: string[];
}

interface UseDeliveryCodeCandidatesInput {
  /** 배송번호 검색이면 그 번호, 아니면 null (후보를 찾는다) */
  deliveryCode: string | null;
  /** 대상 주문행들의 1688 주문ID (빈 값·중복 허용 — 안에서 정리) */
  orderIds: readonly (string | null | undefined)[];
  enabled: boolean;
}

// ── 주문ID 1개 → 배송번호 목록 ──
async function fetchCodes(orderId: string): Promise<{ id: string; codes: string[] }> {
  const res = await fetch(`/api/ft/delivery-codes?order_id=${encodeURIComponent(orderId)}`);
  const json = await res.json();
  return { id: orderId, codes: json.success ? (json.data as string[]) : [] };
}

export function useDeliveryCodeCandidates({ deliveryCode, orderIds, enabled }: UseDeliveryCodeCandidatesInput) {
  const [code, setCode] = useState('');
  const [candidates, setCandidates] = useState<DeliveryCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  // 안정된 키 — 배열 참조가 바뀌어도 같은 주문이면 다시 찾지 않는다
  const orderIdsKey = Array.from(new Set(orderIds.filter((v): v is string => !!v))).sort().join('|');

  useEffect(() => {
    if (!enabled) return;
    setCode(deliveryCode ?? '');
    setCandidates([]);
    setLoading(false);
    if (deliveryCode) return;

    const ids = orderIdsKey ? orderIdsKey.split('|') : [];
    if (ids.length === 0) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // ── DELIVERY_CODE_CONCURRENCY 개씩 동시에, 배치는 순서대로 ──
        const found: { id: string; codes: string[] }[] = [];
        for (let i = 0; i < ids.length; i += DELIVERY_CODE_CONCURRENCY) {
          const batch = ids.slice(i, i + DELIVERY_CODE_CONCURRENCY);
          found.push(...(await Promise.all(batch.map(fetchCodes))));
          if (cancelled) return;
        }

        // ── 배송번호 → 주문ID 묶기 ──
        const byCode = new Map<string, string[]>();
        for (const f of found) {
          for (const c of f.codes) byCode.set(c, [...(byCode.get(c) ?? []), f.id]);
        }
        const list = Array.from(byCode.entries())
          .map(([c, idsOfCode]) => ({ code: c, orderIds: idsOfCode }))
          .sort((a, b) => b.orderIds.length - a.orderIds.length || a.code.localeCompare(b.code));
        setCandidates(list);
        if (list.length === 1) setCode(list[0].code);
      } catch (e) {
        console.error('배송번호 후보 조회 오류:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, deliveryCode, orderIdsKey]);

  return { code, setCode, candidates, loading };
}
