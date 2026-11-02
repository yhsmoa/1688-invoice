'use client';

import React from 'react';
import type { FtOrderItem } from '../hooks/useOrderStatusData';
import { resolveTypeBadge } from '../../../lib/sizeCode';
import TypeBadge from '../../../component/TypeBadge';

// ============================================================
// TypeChangePopup — 타입 배지 변경 팝업
//
// 타입 셀(A/B/C/X) 클릭 시 마우스 위치에 표시되는 선택 메뉴.
//   · A/B/C/X 와 구분선 아래 S(보관) 를 한 목록으로 — 화면에서는 S 도 하나의 타입
//   · S 선택 = 입고 후 경로 STOCK (박스 타입은 재고에서 꺼낼 때 정한다)
//   · A~X 선택 = 포장 타입 기록 + 경로 SHIPMENT (재고가 남아 있으면 서버가 거절)
// 프레젠테이션 전담 — API 호출은 부모 onSelect 콜백으로 위임.
// 스타일: 기존 os-v2-popup-* 클래스 재사용 (주문번호 팝업과 동일 패턴).
// ============================================================

export type TypeCode = 'A' | 'B' | 'C' | 'X' | 'S';

interface TypeChangePopupProps {
  item: FtOrderItem;
  x: number;
  y: number;
  onClose: () => void;
  /** 타입 선택 — 상품(세트 구성품 전체) 단위로 적용 */
  onSelect: (code: TypeCode) => void;
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
}) => {
  // ── 현재 아이템의 타입 코드 판별 (동일 타입 disabled 처리용) — S 면 'S' ──
  const current = resolveTypeBadge(item);
  const currentCode = current?.code ?? null;

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

        {/* ── S(보관) — 꺼낼 때 타입을 정하는 상품 ── */}
        <div className="os-v2-popup-divider" aria-hidden="true" />
        <button
          className="os-v2-popup-item os-v2-popup-item--stock"
          disabled={currentCode === 'S'}
          onClick={() => {
            onClose();
            onSelect('S');
          }}
        >
          <TypeBadge info={{ code: 'S', colorClass: 'size-badge--stock' }} />
          <span>보관 (재고)</span>
          {currentCode === 'S' && (
            <span className="os-v2-popup-toggle is-on">
              {current?.secondary ? `꺼낼 때 ${current.secondary.code}` : '타입 미정'}
            </span>
          )}
        </button>
      </div>
    </>
  );
};

export default TypeChangePopup;
