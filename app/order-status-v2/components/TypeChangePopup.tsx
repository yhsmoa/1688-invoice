'use client';

import React from 'react';
import type { FtOrderItem } from '../hooks/useOrderStatusData';
import { resolveSizeBadge, isStockRoute } from '../../../lib/sizeCode';

// ============================================================
// TypeChangePopup — 타입 배지 변경 팝업
//
// 타입 셀(A/B/C/X) 클릭 시 마우스 위치에 표시되는 선택 메뉴.
//   · 위: 포장 타입 A/B/C/X
//   · 구분선 아래: 보관(입고 후 경로) 토글 — 포장 타입과 독립된 축 (lib/sizeCode isStockRoute)
// 프레젠테이션 전담 — API 호출은 부모 onSelect / onToggleStock 콜백으로 위임.
// 스타일: 기존 os-v2-popup-* 클래스 재사용 (주문번호 팝업과 동일 패턴).
// ============================================================

type TypeCode = 'A' | 'B' | 'C' | 'X';

interface TypeChangePopupProps {
  item: FtOrderItem;
  x: number;
  y: number;
  onClose: () => void;
  onSelect: (code: TypeCode) => void;
  /** 보관 ON/OFF 전환 (상품 단위 — 세트 구성품 전체) */
  onToggleStock: () => void;
}

// ── 메뉴 옵션 정의 ──────────────────────────────────────────
const TYPE_OPTIONS: { code: TypeCode; label: string; badgeClass: string }[] = [
  { code: 'A', label: 'Small',  badgeClass: 'size-badge--blue' },
  { code: 'B', label: 'Medium', badgeClass: 'size-badge--blue' },
  { code: 'C', label: 'Large',  badgeClass: 'size-badge--blue' },
  { code: 'X', label: 'Direct', badgeClass: 'size-badge--black' },
];

const TypeChangePopup: React.FC<TypeChangePopupProps> = ({
  item,
  x,
  y,
  onClose,
  onSelect,
  onToggleStock,
}) => {
  // ── 현재 아이템의 타입 코드 판별 (동일 타입 disabled 처리용) ──
  const currentCode = resolveSizeBadge(item.shipment_type, item.coupang_shipment_size)?.code ?? null;

  return (
    <>
      {/* 뒷배경(투명) 클릭 시 팝업 닫힘 */}
      <div className="os-v2-popup-overlay" onClick={onClose} />
      <div
        className="os-v2-popup-menu"
        style={{ left: x + 4, top: y + 4 }}
      >
        {TYPE_OPTIONS.map((opt) => {
          const isCurrent = currentCode === opt.code;
          return (
            <button
              key={opt.code}
              className="os-v2-popup-item"
              disabled={isCurrent}
              onClick={() => {
                onClose();
                onSelect(opt.code);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span className={`size-badge ${opt.badgeClass}`}>{opt.code}</span>
              <span>{opt.label}</span>
              {isCurrent && <span style={{ marginLeft: 'auto', color: '#2563eb' }}>✓</span>}
            </button>
          );
        })}

        {/* ── 보관 토글 ── */}
        <div className="os-v2-popup-divider" aria-hidden="true" />
        <button
          className="os-v2-popup-item os-v2-popup-item--stock"
          onClick={() => {
            onClose();
            onToggleStock();
          }}
        >
          <span className="route-chip--stock">S</span>
          <span>보관</span>
          <span className={`os-v2-popup-toggle ${isStockRoute(item) ? 'is-on' : ''}`}>
            {isStockRoute(item) ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>
    </>
  );
};

export default TypeChangePopup;
