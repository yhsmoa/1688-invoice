'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  flowRemainingQty,
  flowTotal,
  type OrderPending,
  type OrderPeriodRow,
} from '../../../../lib/orderFlow';
import { FLOW_SEGMENTS, segmentQty } from '../utils/flowSegments';
import { nf, pctOf } from '../utils/orderDisplay';

// ============================================================
// OrderFlowTooltip — 주문수량 칸에 마우스를 올리면 뜨는 설명 카드
//   막대의 각 색이 무엇인지(개념)와 수량·비율을 보여준다.
//   잠재 주문량(주문요청·카트)이 얹힌 구간이면 그 내역도 함께 보여준다.
//   · 표가 가로 스크롤 영역(overflow) 안에 있어 카드가 잘리므로
//     document.body 에 portal 로 띄우고 화면 좌표(fixed)로 놓는다.
//   · 기본은 칸 아래 → 아래가 모자라면 칸 위 → 위도 모자라면 칸 옆.
//     어느 경우에도 올린 행(칸)을 가리지 않는다.
// ============================================================

/** 기준이 되는 주문수량 칸의 화면 좌표 */
export interface TooltipAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface OrderFlowTooltipProps {
  row: OrderPeriodRow;
  /** 구간 라벨 (예: '11월 1주차') */
  title: string;
  anchor: TooltipAnchor;
  /** 이 구간에 얹힌 잠재 주문량 (오늘이 속한 구간만, 그 외 null) */
  pending: OrderPending | null;
}

/** 칸과 카드 사이 간격 / 화면 가장자리 여백 (px) */
const ANCHOR_GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

/** 잠재 주문량 줄 — 색은 OrderDataManage.css 의 .odm-seg-{key} */
const PENDING_ROWS = [
  { key: 'request', label: '주문요청', hint: '고객이 주문 요청 · 아직 불러오기 전' },
  { key: 'cart', label: '카트', hint: '고객 장바구니 · 편집 중' },
] as const;

const OrderFlowTooltip: React.FC<OrderFlowTooltipProps> = ({ row, title, anchor, pending }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // ── 위치: 카드 크기를 잰 뒤 화면 안에 들어오게 놓는다 (재기 전에는 숨김) ──
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN_PX;
    const clampLeft = (x: number) => Math.max(VIEWPORT_MARGIN_PX, Math.min(x, maxLeft));
    const clampTop = (y: number) => Math.max(VIEWPORT_MARGIN_PX, Math.min(y, maxTop));

    const below = anchor.bottom + ANCHOR_GAP_PX;
    const above = anchor.top - ANCHOR_GAP_PX - height;
    if (below <= maxTop) {
      setPos({ left: clampLeft(anchor.left), top: below });
    } else if (above >= VIEWPORT_MARGIN_PX) {
      setPos({ left: clampLeft(anchor.left), top: above });
    } else {
      // 위·아래 모두 모자람 → 칸 오른쪽(자리가 없으면 왼쪽)에, 세로는 화면 안으로
      const right = anchor.right + ANCHOR_GAP_PX;
      const left = right <= maxLeft ? right : anchor.left - ANCHOR_GAP_PX - width;
      setPos({ left: clampLeft(left), top: clampTop(anchor.top) });
    }
  }, [anchor.left, anchor.right, anchor.top, anchor.bottom, row, pending]);

  const total = flowTotal(row);
  const qty = segmentQty(row);

  return createPortal(
    <div
      ref={ref}
      className="odm-tip"
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {/* ── 머리: 구간 · 주문수량 ── */}
      <div className="odm-tip-head">
        <span className="odm-tip-title">{title}</span>
        <span className="odm-tip-total">
          주문수량 <b>{nf(row.qty)}</b>개
        </span>
      </div>

      {/* ── 칸별: 색 · 이름(개념) · 수량 · 비율 ── */}
      <ul className="odm-tip-list">
        {FLOW_SEGMENTS.map((s) => {
          const pct = pctOf(qty[s.key], total);
          return (
            <li key={s.key} className={`odm-tip-row${qty[s.key] > 0 ? '' : ' odm-tip-row-zero'}`}>
              <span className={`odm-tip-key odm-flow-${s.key}`} />
              <span className="odm-tip-name">
                {s.label}
                <span className="odm-tip-hint">{s.hint}</span>
              </span>
              <span className="odm-tip-qty">{nf(qty[s.key])}개</span>
              <span className="odm-tip-pct">{pct !== null ? `${pct}%` : '—'}</span>
            </li>
          );
        })}
      </ul>

      {/* ── 취소·종결 내역 (있을 때만) ── */}
      {qty.closed > 0 && (
        <div className="odm-tip-sub">
          취소 완료 {nf(row.cancelDoneQty)} · 취소 접수중 {nf(row.cancelPendingQty)} · 입고 기록 없이 완료{' '}
          {nf(row.closedQty)}
        </div>
      )}

      {/* ── 꼬리: 앞으로 들어올 수량 ── */}
      <div className="odm-tip-foot">
        <span>
          미입고 계<span className="odm-tip-hint-inline">입고대기 + 미도착</span>
        </span>
        <b>{nf(flowRemainingQty(row))}개</b>
      </div>

      {/* ── 잠재 주문량 (이 구간에 얹혔을 때만) — 주문수량·비율에는 들어가지 않는다 ── */}
      {pending && (
        <div className="odm-tip-pending">
          <div className="odm-tip-pending-title">
            잠재 주문량<span className="odm-tip-hint-inline">아직 주문 전 · 주문수량에 미포함</span>
          </div>
          <ul className="odm-tip-list">
            {PENDING_ROWS.map((r) => {
              const stat = pending[r.key];
              return (
                <li key={r.key} className={`odm-tip-row${stat.qty > 0 ? '' : ' odm-tip-row-zero'}`}>
                  <span className={`odm-tip-key odm-seg-${r.key}`} />
                  <span className="odm-tip-name">
                    {r.label}
                    <span className="odm-tip-hint">{r.hint}</span>
                  </span>
                  <span className="odm-tip-qty">{nf(stat.qty)}개</span>
                  <span className="odm-tip-pct">{nf(stat.carts)}건</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>,
    document.body,
  );
};

export default OrderFlowTooltip;
