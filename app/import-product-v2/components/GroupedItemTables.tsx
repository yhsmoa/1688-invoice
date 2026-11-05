'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ItemTable, { type ItemTableProps } from './ItemTable';
import TypeBadge from '../../../component/TypeBadge';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';
import type { FtOrderItem } from '../hooks/useFtData';
import {
  findSetMismatches,
  findSetShortages,
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

  // 작업 가능 수량을 전부 채웠으면(정상 입고) 초록
  const isFull = !done && value > 0 && value >= total;

  return (
    <span className={`v2-board-qty ${done ? 'is-done' : ''} ${value > 0 ? 'has-value' : ''} ${isFull ? 'is-full' : ''}`}>
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
  // 세트 부족 — 구성품끼리는 맞는데 주문 수량보다 덜 들어온 것 (주황)
  const shortages = board.isSet ? findSetShortages([board], modifiedImportQty, arrivalMap, cancelMap) : [];
  const shortageTitle = shortages
    .map((m) => `${m.productNo ?? m.productId}: ` + m.parts.map((p) => `${p.seq}=${p.arrival}+${p.work}`).join(' / '))
    .join('\n');

  // 요청사항(note_notice) · 비고(note_cn) 가 있는 주문 — 그룹으로 묶여 가려지지 않게 헤더 아래 줄에
  //   같은 문구는 하나로 묶어 "첫 글번호 + 문구 외 N건" 으로 보여 준다 (P 주문 14건이 같은 비고를 달고 오는 일이 흔하다)
  const noteGroups = (() => {
    const map = new Map<string, { itemNo: string | null; count: number }>();
    for (const r of board.rows) {
      const text = [r.note_notice, r.note_cn].map((v) => (v ?? '').trim()).filter(Boolean).join(' · ');
      if (!text) continue;
      const cur = map.get(text);
      if (cur) cur.count += 1;
      else map.set(text, { itemNo: r.item_no, count: 1 });
    }
    return Array.from(map.entries()).map(([text, v]) => ({ text, ...v }));
  })();

  // 전부 입력됨 — 보드의 모든 입력 단위가 작업 가능 수량을 다 채움 (잠긴 단위는 제외, 채울 게 하나는 있어야)
  const units = board.isSet ? board.components.map((c) => c.rows) : [board.rows];
  const openUnits = units.filter((rows) => totalOf(rows) > 0);
  const isAllFull = openUnits.length > 0 && openUnits.every((rows) => workOf(rows) >= totalOf(rows));
  const mismatchTitle = mismatches
    .map((m) =>
      `${m.productNo ?? m.productId}: ` +
      m.parts.map((p) => `${p.seq}=${p.arrival}+${p.work}`).join(' / ')
    )
    .join('\n');

  // 썸네일은 리사이즈 변형, 마우스를 올리면 원본 확대 (테이블 행과 같은 .v2-image-preview)
  const renderImage = (url: string | null) => (
    <span className="v2-board-comp-image v2-image-preview-container">
      {url ? (
        <>
          <img src={proxyImageUrl(url, THUMB_WIDTH)} alt="" loading="lazy" onError={onImgError} />
          <div className="v2-image-preview">
            <img src={proxyImageUrl(url)} alt="" loading="lazy" onError={onImgError} />
          </div>
        </>
      ) : '-'}
    </span>
  );

  const renderComponent = (c: GroupComponent) => (
    <span className="v2-board-comp">
      {renderImage(c.imgUrl)}
      <span className="v2-board-comp-text">
        <span className="v2-board-option1" title={c.option1 || undefined}>{c.option1 || '-'}</span>
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
    <div className={`v2-board-head ${isV3 ? 'is-v3' : ''} ${expanded ? 'is-expanded' : ''}`}>
    <div className="v2-board-head-main">
      <div className="v2-board-head-left">
        {/* 타입 배지 + 세트 배지 — V2 가로, V3 세로 열 (한국어 상품명·옵션명은 펼친 행의 상품명 칸에) */}
        <div className="v2-board-badges">
          {board.badge && <TypeBadge info={board.badge} />}
          {board.isSet && (
            <span className="v2-set-badge v2-board-set-badge">
              {t('importProductV2.set.label')} {board.setTotal}中
            </span>
          )}
        </div>
        {board.isSet ? (
          // 구성품이 2개 이하면 가로에 여유가 있으니 옵션 칩을 넓게 (is-roomy) — 줄바꿈을 줄인다
          <div className={`v2-board-options v2-board-options-set ${board.components.length <= 2 ? 'is-roomy' : ''}`}>
            {board.components.map((c, idx) => (
              <React.Fragment key={c.seq}>
                {idx > 0 && <span className="v2-board-comp-plus" aria-hidden="true" />}
                {renderComponent(c)}
              </React.Fragment>
            ))}
          </div>
        ) : isV3 ? (
          // V3 단품 — 세트 구성품과 같은 칩 (큰 이미지 + 옵션 + 입력), 하나뿐이니 넓게
          <div className="v2-board-options v2-board-options-set is-roomy">
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
        {/* 한국어 상품명 — V3 는 요약이 메인이라 숨긴다 (펼친 테이블·kr 칩에서 확인) */}
        {!isV3 && <span className="v2-board-name" title={board.itemName}>{board.itemName}</span>}
        {mismatches.length > 0 && (
          <span className="v2-board-mismatch" title={mismatchTitle}>
            {t('importProductV2.board.setMismatch')} ({mismatches.length})
          </span>
        )}
        {mismatches.length === 0 && shortages.length > 0 && (
          <span className="v2-board-short" title={shortageTitle}>
            {t('importProductV2.board.setShort')} ({shortages.length})
          </span>
        )}
        {mismatches.length === 0 && isAllFull && (
          <span className="v2-board-full">{t('importProductV2.board.allFilled')}</span>
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
      {/* 요청사항·비고 — 같은 문구는 "첫 글번호 + 문구 외 N건" 하나로 (노란 배지, 광택 + 흔들림) */}
      {noteGroups.length > 0 && (
        <div className="v2-board-notes">
          {noteGroups.map((n) => (
            <span key={n.text} className="v2-note-chip" title={n.text}>
              <b>{n.itemNo}</b>
              <span className="v2-note-chip-text">{n.text}</span>
              {n.count > 1 && <em>{t('importProductV2.board.andMore', { count: n.count - 1 })}</em>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// 결과 요약 줄 (V3) — "8 그룹 · 28건 · P 4 · A 4" + 색 범례
// ============================================================
const TYPE_ORDER = ['P', 'A', 'B', 'C', 'X', 'S'];

const BoardSummary: React.FC<{ boards: GroupBoard[] }> = ({ boards }) => {
  const { t } = useTranslation();
  const rows = boards.reduce((n, b) => n + b.rows.length, 0);
  const byType = new Map<string, number>();
  for (const b of boards) {
    const code = b.badge?.code ?? '-';
    byType.set(code, (byType.get(code) ?? 0) + 1);
  }
  const typeParts = Array.from(byType.entries())
    .sort((a, b) => (TYPE_ORDER.indexOf(a[0]) + 100) % 100 - (TYPE_ORDER.indexOf(b[0]) + 100) % 100)
    .map(([code, n]) => `${code} ${n}`)
    .join(' · ');
  return (
    <div className="v2-board-summary">
      <span className="v2-board-summary-main">
        {t('importProductV2.board.summary', { groups: boards.length, rows })}
      </span>
      <span className="v2-board-summary-types">{typeParts}</span>
      <span className="v2-board-legend"><i className="is-full" />{t('importProductV2.board.allFilled')}</span>
      <span className="v2-board-legend"><i className="is-mismatch" />{t('importProductV2.board.legendMismatch')}</span>
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
      {isV3 && <BoardSummary boards={boards} />}
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
