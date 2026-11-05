'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ItemTable, { type ItemTableProps } from './ItemTable';
import TypeBadge from '../../../component/TypeBadge';
import type { FtOrderItem } from '../hooks/useFtData';
import {
  findSetMismatches,
  remainingQtyOf,
  type GroupBoard,
  type GroupComponent,
} from '../utils/groupBoards';

// ============================================================
// GroupedItemTables — [그룹별로 보기] 체크 시 보드(그룹) 단위로 테이블을 나눠 그린다
//
//   · 보드마다 ItemTable 하나 — 위에 보드 헤더(타입 배지 · 중국옵션 1/2 · 상품명 · 건수)
//   · 헤더에 그룹 수량 입력 [입력] / 작업 가능 합계
//       단품 보드: 헤더 오른쪽에 입력 하나 → 그룹의 주문들에 글번호 순으로 배분
//       세트 보드: [이미지 | 옵션] 칩마다 입력 하나(구성품별) → 그 구성품 행들에 배분
//       배분·한도(잔여 = order − 입고 − 취소)는 utils/groupBoards.distributeQty (ItemCheck 가 적용)
//       세트 구성품의 (입고 + 작업) 이 서로 다른 주문이 있으면 헤더에 경고 배지
//   · 열 헤더(체크박스 전체선택 포함)는 첫 보드에만 그리고, 나머지는 높이 0 thead 로
//     열 너비만 맞춘다 (table-layout: fixed 가 th 너비를 기준으로 삼기 때문)
//   · 로딩·결과 없음은 빈 ItemTable 하나로 기존 안내 행을 그대로 보여 준다
//
//   페이지는 그룹 경계에서만 끊기므로(useFtPagination breakKeyOf) 화면의 보드 = 그룹 전체.
// ============================================================

interface GroupedItemTablesProps {
  boards: GroupBoard[];
  tableProps: Omit<ItemTableProps, 'paginatedData' | 'header' | 'headerMode'>;
  /** 그룹 수량 확정 — rows 의 작업 수량을 지우고 qty 를 글번호 순으로 다시 배분 */
  onApplyGroupQty: (rows: FtOrderItem[], qty: number) => void;
}

const sumBy = (rows: FtOrderItem[], pick: (row: FtOrderItem) => number) =>
  rows.reduce((acc, row) => acc + pick(row), 0);

// ============================================================
// 그룹 수량 입력 — [입력] / 합계
//   · 표시값은 그 행들의 작업 수량 합 (테이블 셀에서 직접 고친 값도 반영)
//   · blur / Enter 로 확정, Escape 로 되돌림, Enter 는 다음 보드 입력으로 이동
//   · 합계(작업 가능) 를 넘으면 알림 후 되돌림. 합계 0 이면 "입고 완료" 로 잠금
// ============================================================
interface GroupQtyInputProps {
  value: number;
  total: number;
  onCommit: (qty: number) => void;
}

const GroupQtyInput: React.FC<GroupQtyInputProps> = ({ value, total, onCommit }) => {
  const { t } = useTranslation();
  const display = value > 0 ? String(value) : '';
  const [text, setText] = useState(display);
  const [focused, setFocused] = useState(false);

  // 밖(테이블 셀 편집·다른 보드 배분)에서 값이 바뀌면 입력 중이 아닐 때 따라간다
  useEffect(() => {
    if (!focused) setText(display);
  }, [display, focused]);

  const done = total <= 0;

  const commit = () => {
    const qty = parseInt(text || '0', 10) || 0;
    if (qty > total) {
      alert(t('importProductV2.board.overLimit', { total }));
      setText(display);
      return;
    }
    if (qty !== value) onCommit(qty);
    else setText(display);
  };

  const focusNext = (current: HTMLInputElement) => {
    const all = Array.from(document.querySelectorAll<HTMLInputElement>('input.v2-board-qty-input:not(:disabled)'));
    const idx = all.indexOf(current);
    if (idx >= 0 && idx < all.length - 1) all[idx + 1].focus();
  };

  return (
    <span className={`v2-board-qty ${done ? 'is-done' : ''} ${value > 0 ? 'has-value' : ''}`}>
      <input
        type="text"
        inputMode="numeric"
        className="v2-board-qty-input"
        value={text}
        placeholder="0"
        disabled={done}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const el = e.currentTarget;
            el.blur();                 // blur → commit
            focusNext(el);
          } else if (e.key === 'Escape') {
            setText(display);
            e.currentTarget.blur();
          }
        }}
      />
      <span className="v2-board-qty-sep">/</span>
      <span className="v2-board-qty-total" title={t('importProductV2.board.available')}>
        {done ? t('importProductV2.board.done') : total}
      </span>
    </span>
  );
};

// ============================================================
// 보드 헤더 — 테이블 왼쪽 위: [P/A 배지] [세트 배지] 옵션1 · 옵션2 | 상품명 | n건 | [입력]/합계
//   세트는 구성품을 [이미지 | 옵션1 / 옵션2 | [입력]/합계] + … 로 가로 나열
// ============================================================
interface BoardHeaderProps {
  board: GroupBoard;
  modifiedImportQty: Map<string, number>;
  arrivalMap: Map<string, number>;
  cancelMap: Map<string, number>;
  onApplyGroupQty: (rows: FtOrderItem[], qty: number) => void;
}

const BoardHeader: React.FC<BoardHeaderProps> = ({
  board,
  modifiedImportQty,
  arrivalMap,
  cancelMap,
  onApplyGroupQty,
}) => {
  const { t } = useTranslation();

  const workOf = (rows: FtOrderItem[]) => sumBy(rows, (r) => modifiedImportQty.get(r.id) ?? 0);
  const totalOf = (rows: FtOrderItem[]) => sumBy(rows, (r) => remainingQtyOf(r, arrivalMap, cancelMap));

  // 세트 불일치 — 이 보드의 세트 인스턴스 중 (입고 + 작업) 이 구성품끼리 다른 것
  const mismatches = board.isSet ? findSetMismatches([board], modifiedImportQty, arrivalMap) : [];
  const mismatchTitle = mismatches
    .map((m) =>
      `${m.productNo ?? m.productId}: ` +
      m.parts.map((p) => `${p.seq}=${p.arrival}+${p.work}`).join(' / ')
    )
    .join('\n');

  const renderComponent = (c: GroupComponent) => (
    <span className="v2-board-comp">
      <span className="v2-board-comp-image">
        {c.imgUrl ? (
          <img
            src={`/api/image-proxy?url=${encodeURIComponent(c.imgUrl)}`}
            alt=""
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
          />
        ) : '-'}
      </span>
      <span className="v2-board-comp-text">
        <span className="v2-board-option1">{c.option1 || '-'}</span>
        {c.option2 && <span className="v2-board-option2">{c.option2}</span>}
      </span>
      <GroupQtyInput
        value={workOf(c.rows)}
        total={totalOf(c.rows)}
        onCommit={(qty) => onApplyGroupQty(c.rows, qty)}
      />
    </span>
  );

  return (
    <div className="v2-board-head">
      <div className="v2-board-head-left">
        {board.badge && <TypeBadge info={board.badge} />}
        {board.isSet && (
          <span className="v2-set-badge v2-board-set-badge">
            {t('importProductV2.set.label')} {board.setTotal}中
          </span>
        )}
        {board.isSet ? (
          <div className="v2-board-options v2-board-options-set">
            {board.components.map((c, idx) => (
              <React.Fragment key={c.seq}>
                {idx > 0 && <span className="v2-board-comp-plus" aria-hidden="true">+</span>}
                {renderComponent(c)}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div className="v2-board-options">
            <span className="v2-board-option1">{board.option1 || '-'}</span>
            {board.option2 && <span className="v2-board-option2">{board.option2}</span>}
          </div>
        )}
      </div>
      <div className="v2-board-head-right">
        <span className="v2-board-name" title={board.itemName}>{board.itemName}</span>
        {mismatches.length > 0 && (
          <span className="v2-board-mismatch" title={mismatchTitle}>
            {t('importProductV2.board.mismatch', { count: mismatches.length })}
          </span>
        )}
        <span className="v2-board-count">{t('importProductV2.board.rows', { count: board.rows.length })}</span>
        {!board.isSet && (
          <GroupQtyInput
            value={workOf(board.rows)}
            total={totalOf(board.rows)}
            onCommit={(qty) => onApplyGroupQty(board.rows, qty)}
          />
        )}
      </div>
    </div>
  );
};

const GroupedItemTables: React.FC<GroupedItemTablesProps> = ({ boards, tableProps, onApplyGroupQty }) => {
  if (tableProps.loading || boards.length === 0) {
    return <ItemTable {...tableProps} paginatedData={[]} />;
  }

  return (
    <div className="v2-board-list">
      {boards.map((board, idx) => (
        <ItemTable
          key={board.key}
          {...tableProps}
          paginatedData={board.rows}
          header={
            <BoardHeader
              board={board}
              modifiedImportQty={tableProps.modifiedImportQty}
              arrivalMap={tableProps.arrivalMap}
              cancelMap={tableProps.cancelMap}
              onApplyGroupQty={onApplyGroupQty}
            />
          }
          headerMode={idx === 0 ? 'full' : 'collapsed'}
        />
      ))}
    </div>
  );
};

export default GroupedItemTables;
