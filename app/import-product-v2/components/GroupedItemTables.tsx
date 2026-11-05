'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import ItemTable, { type ItemTableProps } from './ItemTable';
import TypeBadge from '../../../component/TypeBadge';
import type { GroupBoard } from '../utils/groupBoards';

// ============================================================
// GroupedItemTables — [그룹별로 보기] 체크 시 보드(그룹) 단위로 테이블을 나눠 그린다
//
//   · 보드마다 ItemTable 하나 — 위에 보드 헤더(타입 배지 · 중국옵션 1/2 · 상품명 · 건수)
//   · 열 헤더(체크박스 전체선택 포함)는 첫 보드에만 그리고, 나머지는 높이 0 thead 로
//     열 너비만 맞춘다 (table-layout: fixed 가 th 너비를 기준으로 삼기 때문)
//   · 로딩·결과 없음은 빈 ItemTable 하나로 기존 안내 행을 그대로 보여 준다
// ============================================================

interface GroupedItemTablesProps {
  boards: GroupBoard[];
  tableProps: Omit<ItemTableProps, 'paginatedData' | 'header' | 'headerMode'>;
}

// ── 보드 헤더 — 테이블 왼쪽 위: [P/A 배지] [세트 배지] 옵션1 · 옵션2 | 상품명 | n건 ──
//    세트는 구성품을 [이미지 | 옵션1 / 옵션2] + [이미지 | 옵션1 / 옵션2] 로 가로 나열
const BoardHeader: React.FC<{ board: GroupBoard }> = ({ board }) => {
  const { t } = useTranslation();
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
                </span>
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
        <span className="v2-board-count">{t('importProductV2.board.rows', { count: board.rows.length })}</span>
      </div>
    </div>
  );
};

const GroupedItemTables: React.FC<GroupedItemTablesProps> = ({ boards, tableProps }) => {
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
          header={<BoardHeader board={board} />}
          headerMode={idx === 0 ? 'full' : 'collapsed'}
        />
      ))}
    </div>
  );
};

export default GroupedItemTables;
