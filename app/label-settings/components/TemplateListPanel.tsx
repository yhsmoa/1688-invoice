'use client';

import React from 'react';
import { isSharedTemplate, type LabelTemplate, type LabelType } from '../../../lib/labelTypes';
import { userLabel, type FtUser } from '../hooks/useLabelSettingsData';

// ============================================================
// 템플릿 목록 — 템플릿 보드(TemplateBoard)의 "템플릿" 탭 내용.
//   종류/사용자로 걸러서 고르고, 여기서 새 템플릿을 만든다.
//   카드 테두리·탭 전환은 TemplateBoard 가 담당하므로 여기는 내용만 그린다.
// ============================================================

export const LABEL_TYPES: { key: LabelType; label: string }[] = [
  { key: 'barcode', label: '바코드 감열지' },
  { key: 'care', label: '케어라벨' },
];

interface Props {
  templates: LabelTemplate[];
  users: FtUser[];
  loading: boolean;
  filterType: LabelType | '';
  filterUserId: string;
  activeId: string | null;
  onFilterType: (v: LabelType | '') => void;
  onFilterUser: (v: string) => void;
  onPick: (tpl: LabelTemplate) => void;
  onCreate: (type: LabelType) => void;
}

const TemplateListPanel: React.FC<Props> = ({
  templates,
  users,
  loading,
  filterType,
  filterUserId,
  activeId,
  onFilterType,
  onFilterUser,
  onPick,
  onCreate,
}) => {
  const visible = templates.filter((t) => {
    if (filterType && t.label_type !== filterType) return false;
    if (filterUserId === '__common__') return isSharedTemplate(t);
    if (filterUserId) return !!t.user_ids?.includes(filterUserId);
    return true;
  });

  return (
    <>
      <div className="ls-row-2">
        <select value={filterType} onChange={(e) => onFilterType(e.target.value as LabelType | '')}>
          <option value="">전체 종류</option>
          {LABEL_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={filterUserId} onChange={(e) => onFilterUser(e.target.value)}>
          <option value="">전체 사용자</option>
          <option value="__common__">공용</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {userLabel(u)}
            </option>
          ))}
        </select>
      </div>

      <div className="ls-row-2 ls-mt8">
        <button className="ls-btn-sm" onClick={() => onCreate('barcode')}>
          + 바코드
        </button>
        <button className="ls-btn-sm" onClick={() => onCreate('care')}>
          + 케어라벨
        </button>
      </div>

      <div className="ls-list-items">
        {loading ? (
          <div className="ls-empty">불러오는 중…</div>
        ) : visible.length === 0 ? (
          <div className="ls-empty">템플릿이 없습니다. 위 버튼으로 새로 만드세요.</div>
        ) : (
          visible.map((t) => (
            <button
              key={t.id}
              className={`ls-list-item ${activeId === t.id ? 'active' : ''}`}
              onClick={() => onPick(t)}
            >
              <span className="ls-item-name">
                {t.name}
                {t.is_default && <span className="ls-default-badge">기본</span>}
              </span>
              <span className="ls-item-meta">
                {t.label_type === 'care' ? '케어' : '바코드'} · {t.width_mm}×{t.height_mm}mm ·{' '}
                {t.dpi}dpi ·{' '}
                {isSharedTemplate(t)
                  ? '공용'
                  : t.user_ids!.length === 1
                    ? userLabel(users.find((u) => u.id === t.user_ids![0]) ?? ({} as FtUser)) || '지정 사용자'
                    : `${t.user_ids!.length}명 전용`}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
};

export default TemplateListPanel;
