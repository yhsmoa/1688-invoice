'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
//
//   variant
//     'v2' : 헤더(요약) 작게 + 주문 행 테이블 항상 펼침. 열 헤더는 첫 보드에만, 나머지는 높이 0
//     'v3' : 헤더(요약)가 메인 — 큰 이미지·옵션·입력. 주문 행 테이블은 헤더 오른쪽 [펼치기] 로
//            보드 아래에 펼쳐지고(compact: 작은 이미지, 상품명·비용 없음), 펼친 테이블마다 열 헤더
//
//   · 로딩·결과 없음은 빈 ItemTable 하나로 기존 안내 행을 그대로 보여 준다
//   페이지는 그룹 경계에서만 끊기므로(useFtPagination breakKeyOf) 화면의 보드 = 그룹 전체.
// ============================================================

export type GroupedVariant = 'v2' | 'v3';

interface GroupedItemTablesProps {
  boards: GroupBoard[];
  tableProps: Omit<ItemTableProps, 'paginatedData' | 'header' | 'headerMode' | 'compact'>;
  /** 그룹 수량 확정 — rows 의 작업 수량을 지우고 qty 를 글번호 순으로 다시 배분 */
  onApplyGroupQty: (rows: FtOrderItem[], qty: number) => void;
  variant?: GroupedVariant;
}

const sumBy = (rows: FtOrderItem[], pick: (row: FtOrderItem) => number) =>
  rows.reduce((acc, row) => acc + pick(row), 0);

const proxied = (url: string) => `/api/image-proxy?url=${encodeURIComponent(url)}`;
const onImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  (e.target as HTMLImageElement).src = '/placeholder.svg';
};

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
// 보드 헤더 — [P/A 배지] [세트 배지] (이미지) 옵션1 · 옵션2 | 상품명 | 불일치 | n건 | [입력]/합계 | (펼치기)
//   세트는 구성품을 [이미지 | 옵션1 / 옵션2 | [입력]/합계] + … 로 가로 나열
//   V3 는 단품도 이미지를 크게 보여 주고(요약이 메인), 오른쪽 끝에 [펼치기/접기] 버튼
// ============================================================
interface BoardHeaderProps {
  board: GroupBoard;
  variant: GroupedVariant;
  modifiedImportQty: Map<string, number>;
  arrivalMap: Map<string, number>;
  cancelMap: Map<string, number>;
  onApplyGroupQty: (rows: FtOrderItem[], qty: number) => void;
  /** V3 — 주문 행 펼침 여부·토글 (V2 는 undefined) */
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const BoardHeader: React.FC<BoardHeaderProps> = ({
  board,
  variant,
  modifiedImportQty,
  arrivalMap,
  cancelMap,
  onApplyGroupQty,
  expanded,
  onToggleExpand,
}) => {
  const { t } = useTranslation();
  const isV3 = variant === 'v3';

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

  const renderImage = (url: string | null) => (
    <span className="v2-board-comp-image">
      {url ? <img src={proxied(url)} alt="" loading="lazy" onError={onImgError} /> : '-'}
    </span>
  );

  const renderComponent = (c: GroupComponent) => (
    <span className="v2-board-comp">
      {renderImage(c.imgUrl)}
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
    <div className={`v2-board-head ${isV3 ? 'is-v3' : ''}`}>
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
        ) : isV3 ? (
          // V3 단품 — 세트 구성품과 같은 칩 (큰 이미지 + 옵션 + 입력)
          <div className="v2-board-options v2-board-options-set">
            <span className="v2-board-comp">
              {renderImage(board.imgUrl)}
              <span className="v2-board-comp-text">
                <span className="v2-board-option1">{board.option1 || '-'}</span>
                {board.option2 && <span className="v2-board-option2">{board.option2}</span>}
              </span>
              <GroupQtyInput
                value={workOf(board.rows)}
                total={totalOf(board.rows)}
                onCommit={(qty) => onApplyGroupQty(board.rows, qty)}
              />
            </span>
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
        {!board.isSet && !isV3 && (
          <GroupQtyInput
            value={workOf(board.rows)}
            total={totalOf(board.rows)}
            onCommit={(qty) => onApplyGroupQty(board.rows, qty)}
          />
        )}
        {onToggleExpand && (
          <button
            type="button"
            className={`v2-board-expand ${expanded ? 'is-open' : ''}`}
            onClick={onToggleExpand}
            aria-expanded={expanded}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
            {t(expanded ? 'importProductV3.collapse' : 'importProductV3.expand')}
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================
// 보드 목록
// ============================================================
const GroupedItemTables: React.FC<GroupedItemTablesProps> = ({
  boards,
  tableProps,
  onApplyGroupQty,
  variant = 'v2',
}) => {
  const isV3 = variant === 'v3';

  // V3 — 보드별 펼침 상태 (보드 키 기준, 페이지를 넘겨도 같은 보드면 유지)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (tableProps.loading || boards.length === 0) {
    return <ItemTable {...tableProps} paginatedData={[]} compact={isV3} />;
  }

  return (
    <div className={`v2-board-list ${isV3 ? 'is-v3' : ''}`}>
      {boards.map((board, idx) => {
        const expanded = isV3 ? expandedKeys.has(board.key) : true;
        const header = (
          <BoardHeader
            board={board}
            variant={variant}
            modifiedImportQty={tableProps.modifiedImportQty}
            arrivalMap={tableProps.arrivalMap}
            cancelMap={tableProps.cancelMap}
            onApplyGroupQty={onApplyGroupQty}
            expanded={isV3 ? expanded : undefined}
            onToggleExpand={isV3 ? () => toggleExpand(board.key) : undefined}
          />
        );

        // V3 접힘 — 헤더만 (테이블은 그리지 않는다)
        if (!expanded) {
          return (
            <div key={board.key} className="v2-table-board is-collapsed">
              {header}
            </div>
          );
        }

        return (
          <ItemTable
            key={board.key}
            {...tableProps}
            paginatedData={board.rows}
            header={header}
            headerMode={isV3 || idx === 0 ? 'full' : 'collapsed'}
            compact={isV3}
          />
        );
      })}
    </div>
  );
};

export default GroupedItemTables;
