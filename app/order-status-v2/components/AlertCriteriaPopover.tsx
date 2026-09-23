'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { ALERT_RULES } from '../utils/deliveryAlerts';

// ============================================================
// AlertCriteriaPopover — [⚠️ 확인필요] 버튼 hover 시 "판정 기준" 팝업
//
//   · 커서 오른쪽 아래에 fixed 로 띄우고 커서를 따라다닌다
//   · 화면 밖으로 넘치면 커서 반대편으로 뒤집고, 그래도 넘치면 가장자리에 붙인다
//   · 기준 일수는 ALERT_RULES 에서 그대로 가져온다 (판정 규칙과 문구가 어긋나지 않게)
//   · purchase-agent 주문 진행 화면의 같은 팝업과 문구 동일 — 바꿀 때 양쪽 같이 수정
// ============================================================

// ── 기준 목록 (판정 순서와 동일: 입고 이후 → 배송 상태) ──
const ALERT_CRITERIA: { name: string; rule: string }[] = [
  { name: '포장 지연', rule: `입고가 다 된 뒤 ${ALERT_RULES.PACKING_DAYS}일이 지나도 포장이 다 안 됨` },
  { name: '출고 지연', rule: `포장이 다 된 뒤 ${ALERT_RULES.OUTBOUND_DAYS}일이 지나도 출고가 다 안 됨` },
  { name: '배송전', rule: `주문 후 ${ALERT_RULES.PENDING_DAYS}일이 지나도 판매자가 발송하지 않음` },
  { name: '집하대기', rule: `송장 등록 후 ${ALERT_RULES.PICKUP_DAYS}일이 지나도 택배사가 가져가지 않음` },
  { name: '운송 정체', rule: `배송 위치가 ${ALERT_RULES.TRANSIT_STALL_DAYS}일 넘게 바뀌지 않음` },
  { name: '배송 이상', rule: '처리지연 · 집하지연 · 물류이상 · 물류정체 (기간 상관없이)' },
  { name: '입고 지연', rule: `배송완료 후 ${ALERT_RULES.ARRIVAL_DAYS}일이 지나도 입고가 다 안 됨` },
];

const ALERT_CRITERIA_NOTES = [
  '수량은 주문수량에서 취소·반품(접수 포함)을 뺀 기준입니다.',
  '완료된 주문과 전량 취소된 주문은 제외됩니다.',
];

// ── 위치 보정 값 (px) ──
const CURSOR_OFFSET = 12;   // 커서와 팝업 사이 — 커서 아이콘에 가리지 않게
const VIEWPORT_EDGE = 8;    // 화면 가장자리 최소 여백

interface Props {
  /** 커서 위치 (clientX / clientY) */
  x: number;
  y: number;
}

export default function AlertCriteriaPopover({ x, y }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // ── 실제 크기를 잰 뒤 위치 확정 (측정 전에는 숨김 → 잘린 위치가 한 프레임 보이지 않게) ──
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + CURSOR_OFFSET;
    if (left + width > vw - VIEWPORT_EDGE) left = x - CURSOR_OFFSET - width;
    left = Math.max(VIEWPORT_EDGE, Math.min(left, vw - VIEWPORT_EDGE - width));

    let top = y + CURSOR_OFFSET;
    if (top + height > vh - VIEWPORT_EDGE) top = y - CURSOR_OFFSET - height;
    top = Math.max(VIEWPORT_EDGE, Math.min(top, vh - VIEWPORT_EDGE - height));

    setPos({ left, top });
  }, [x, y]);

  const style: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : { left: x + CURSOR_OFFSET, top: y + CURSOR_OFFSET, visibility: 'hidden' };

  return (
    <div ref={ref} className="os-v2-alert-criteria" style={style} role="tooltip">
      <p className="os-v2-alert-criteria-title">확인필요 기준</p>
      <ul className="os-v2-alert-criteria-list">
        {ALERT_CRITERIA.map((c) => (
          <li key={c.name}>
            <span className="os-v2-alert-criteria-name">{c.name}</span>
            <span className="os-v2-alert-criteria-rule">{c.rule}</span>
          </li>
        ))}
      </ul>
      <div className="os-v2-alert-criteria-notes">
        {ALERT_CRITERIA_NOTES.map((n) => <p key={n}>{n}</p>)}
      </div>
    </div>
  );
}
