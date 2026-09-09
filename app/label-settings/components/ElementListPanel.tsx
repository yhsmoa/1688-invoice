'use client';

import React from 'react';
import {
  elementCaption,
  ELEMENT_TYPE_LABEL,
  type LabelElement,
} from '../../../lib/labelTypes';
import type { ElementPatch } from '../hooks/useTemplateDraft';

// ============================================================
// 요소 목록 (왼쪽 컬럼, 템플릿 보드 아래)
//
// 목록 순서 = 인쇄 순서 = 겹칠 때 위아래 순서.
// 마지막 항목이 가장 위에 그려지므로 ▲/▼ 로 순서를 바꾼다.
//
// Shift/Ctrl(Cmd)+클릭으로 여러 행을 함께 선택할 수 있다 (캔버스 다중 선택과 연동).
// ============================================================

interface Props {
  layout: LabelElement[];
  selectedIds: string[];
  warnings: Map<string, string | null>;
  /** 캔버스와 동일하게 "새 선택 전체 목록"을 그대로 받는다 */
  onSelect: (ids: string[]) => void;
  onPatch: (id: string, patch: ElementPatch) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (id: string, dir: -1 | 1) => void;
}

const ElementListPanel: React.FC<Props> = ({
  layout,
  selectedIds,
  warnings,
  onSelect,
  onPatch,
  onRemove,
  onDuplicate,
  onReorder,
}) => {
  const selectedSet = new Set(selectedIds);

  const handleRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      onSelect(selectedSet.has(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id]);
    } else {
      onSelect([id]);
    }
  };

  return (
  <section className="ls-panel ls-el-panel">
    <div className="ls-panel-title">
      요소
      <span className="ls-count">
        {selectedIds.length > 1 ? `${selectedIds.length}/${layout.length} 선택` : layout.length}
      </span>
    </div>

    {layout.length === 0 ? (
      <div className="ls-empty">
        요소가 없습니다. 캔버스 위의 [+ 텍스트] 등으로 추가하세요.
      </div>
    ) : (
      <div className="ls-el-list">
        {layout.map((el, i) => {
          const warn = warnings.get(el.id);
          return (
            <div
              key={el.id}
              className={`ls-el-row ${selectedSet.has(el.id) ? 'active' : ''} ${el.hidden ? 'is-hidden' : ''}`}
              onClick={(e) => handleRowClick(e, el.id)}
            >
              <span className="ls-el-type">{ELEMENT_TYPE_LABEL[el.type]}</span>
              <span className="ls-el-desc" title={elementCaption(el)}>
                {warn && <span className="ls-el-warn" title={warn}>⚠</span>}
                {elementCaption(el)}
              </span>

              <div className="ls-el-tools">
                <button
                  className="ls-el-tool"
                  title={el.hidden ? '보이기' : '숨기기'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPatch(el.id, { hidden: !el.hidden });
                  }}
                >
                  {el.hidden ? '◌' : '◉'}
                </button>
                <button
                  className="ls-el-tool"
                  title={el.locked ? '잠금 해제' : '잠그기'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPatch(el.id, { locked: !el.locked });
                  }}
                >
                  {el.locked ? '🔒' : '🔓'}
                </button>
                <button
                  className="ls-el-tool"
                  title="뒤로 (아래층)"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(el.id, -1);
                  }}
                >
                  ▲
                </button>
                <button
                  className="ls-el-tool"
                  title="앞으로 (위층)"
                  disabled={i === layout.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReorder(el.id, 1);
                  }}
                >
                  ▼
                </button>
                <button
                  className="ls-el-tool"
                  title="복제 (Ctrl+D)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(el.id);
                  }}
                >
                  ⧉
                </button>
                <button
                  className="ls-el-tool ls-el-del"
                  title="삭제 (Delete)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(el.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </section>
  );
};

export default ElementListPanel;
