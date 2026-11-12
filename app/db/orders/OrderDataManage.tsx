'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import { dbAccessHeaders } from '../../../component/DbAccessGate';
import {
  addFlow,
  emptyFlow,
  sumAmountCny,
  type OrderPending,
  type OrderPeriod,
  type OrderPeriodRow,
  type OrderWeeklyMeta,
} from '../../../lib/orderFlow';
import OrderPeriodTable from './components/OrderPeriodTable';
import OrderSummaryCards, { type OrderTotals } from './components/OrderSummaryCards';
import { PERIODS, PERIOD_LABEL, PERIOD_SUBTITLE, nf } from './utils/orderDisplay';
import './OrderDataManage.css';

// ============================================================
// 주문 데이터 관리 — 일간 / 주간(월~일) / 월간 주문량 + 진행 현황
//   데이터: GET /api/db/order-weekly?period=day|week|month
//     · 구간 기준 ft_orders.created_at (KST)
//     · 주문수량 ft_order_items.order_qty 합
//     · 배송유형 ft_order_items.shipment_type
//     · 주문수량 막대의 색 = 진행 단계 (주문 → 배송완료 → 입고): 입고완료 / 입고대기 / 미도착
//       — 정의는 lib/orderFlow.ts, supabase/db/003_order_flow.sql
//     · 잠재 주문량 ft_carts ORDER(주문요청) / NEW(카트) — 오늘이 속한 구간 막대에 이어 표시
// ============================================================

const OrderDataManage: React.FC = () => {
  const [period, setPeriod] = useState<OrderPeriod>('week');
  const [weeks, setWeeks] = useState<OrderPeriodRow[]>([]);
  const [meta, setMeta] = useState<OrderWeeklyMeta | null>(null);
  const [pending, setPending] = useState<OrderPending | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 데이터 조회 ──
  const load = useCallback(async (p: OrderPeriod, isCurrent: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/db/order-weekly?period=${p}`, {
        headers: dbAccessHeaders(),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '조회 실패');
      if (!isCurrent()) return;
      setWeeks(json.weeks || []);
      setMeta(json.meta || null);
      setPending(json.pending || null);
    } catch (e) {
      if (!isCurrent()) return;
      setError(e instanceof Error ? e.message : '조회 중 오류가 발생했습니다.');
      setWeeks([]);
      setMeta(null);
      setPending(null);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  // 단위를 빠르게 바꾸면 응답이 뒤바뀌어 도착할 수 있다 → 마지막으로 고른 단위의 응답만 반영
  useEffect(() => {
    let current = true;
    load(period, () => current);
    return () => {
      current = false;
    };
  }, [period, load]);

  // 주문이 있는 구간 수 — 평균의 분모.
  // 잠재 주문량만 얹힌 구간(아직 주문 0건)은 행은 있어도 평균에서 뺀다.
  const orderedPeriodCount = useMemo(() => weeks.filter((w) => w.orderCount > 0).length, [weeks]);

  // ── 합계 (잠재 주문량은 넣지 않는다) ──
  const totals = useMemo<OrderTotals>(() => {
    const sum = { ...emptyFlow(), qty: 0, orderCount: 0, itemRows: 0, coupangQty: 0 };
    for (const w of weeks) {
      sum.qty += w.qty;
      sum.orderCount += w.orderCount;
      sum.itemRows += w.itemRows;
      sum.coupangQty += w.coupangQty;
      addFlow(sum, w);
    }
    return {
      ...sum,
      amountCny: sumAmountCny(weeks),
      avgQtyPerPeriod: orderedPeriodCount > 0 ? Math.round(sum.qty / orderedPeriodCount) : 0,
    };
  }, [weeks, orderedPeriodCount]);

  const hasData = !loading && !error && weeks.length > 0;

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="odm-main">
          {/* ── 페이지 헤더 ── */}
          <div className="odm-page-header">
            <div className="odm-page-title-wrap">
              <h1 className="odm-page-title">주문 데이터 관리</h1>
              <span className="odm-page-sub">{PERIOD_SUBTITLE[period]}</span>
            </div>
            <div className="odm-period">
              <span className="odm-period-label">단위</span>
              {PERIODS.map((p) => (
                <button
                  key={p}
                  className={`odm-period-btn ${period === p ? 'active' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          {/* ── 요약 카드 ── */}
          {hasData && (
            <OrderSummaryCards
              totals={totals}
              period={period}
              periodCount={orderedPeriodCount}
              pending={pending}
            />
          )}

          {/* ── 본문 ── */}
          <div className="odm-content">
            {loading && <div className="odm-state">불러오는 중...</div>}
            {error && !loading && <div className="odm-state odm-state-error">{error}</div>}
            {!loading && !error && weeks.length === 0 && (
              <div className="odm-state">데이터가 없습니다.</div>
            )}

            {hasData && (
              <OrderPeriodTable
                rows={weeks}
                period={period}
                pending={pending}
                lastDeliveryUploadAt={meta?.lastDeliveryUploadAt ?? null}
              />
            )}
          </div>

          {/* ── 안내 ── */}
          <p className="odm-footer-note">
            구간은 <code>ft_orders.created_at</code>(KST) 기준이며, 일간은 주문이 있는 날만 표시합니다.
            주간은 월요일 시작(월~일), 월간은 달력 월 기준으로 원본 날짜에서 직접 집계합니다(주간
            합산이 아니므로 월 경계를 걸친 주가 중복되지 않습니다). 주문수량은{' '}
            <code>ft_order_items.order_qty</code> 합계, 완료율은 품목 상태가 <code>DONE</code>인 수량의
            비율입니다.
            <br />
            주문수량 막대는 길이가 주문수량, 색이 그 수량이 지금 어디까지 왔는지를 나타내며, 색 칸의
            합은 주문수량과 같습니다. <b>입고완료</b>는 입고(<code>ARRIVAL</code>) 처리된 수량, <b>입고대기</b>는
            1688 배송완료 기록이 있고 아직 입고 전인 수량, <b>미도착</b>은 배송완료 기록이 없는
            수량(배송 전·배송 중)입니다. 취소(접수 포함)와 입고 기록 없이 완료 처리된 수량은{' '}
            <b>취소·종결</b>로 묶어 미입고에서 제외합니다. 배송완료 여부는 배송상황 CSV를 올린 시점까지만
            반영됩니다.
            <br />
            잠재 주문량은 <code>ft_carts</code> 상태가 <code>ORDER</code>(주문요청)·<code>NEW</code>(카트)인
            카트의 품목 수량 합계이며, 주문으로 불러오는 시점이 주문일이 되므로 오늘이 속한 구간에 표시하고
            합계·평균·비중에는 넣지 않습니다.
            {meta && meta.headerQtyMismatch > 0 && (
              <span className="odm-warn">
                {' '}
                · <b>주의</b>: <code>ft_orders.total_qty</code>(헤더 수량)가 품목 합계와 다른 주문이{' '}
                {nf(meta.headerQtyMismatch)}건 있어, 집계는 품목 기준으로 계산했습니다.
              </span>
            )}
            {meta && meta.orphanItems > 0 && (
              <span className="odm-warn"> · 주문 정보가 없어 제외된 품목 {nf(meta.orphanItems)}건</span>
            )}
          </p>
        </main>
      </div>
    </div>
  );
};

export default OrderDataManage;
