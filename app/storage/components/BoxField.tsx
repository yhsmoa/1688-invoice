'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BoxCreateModal, { type BoxType, type CreatedBox } from '../../../component/BoxCreateModal';
import type { BoxInfoItem } from '../../shipment-v2/types';
import { useStorage } from '../hooks/StorageContext';

// ============================================================
// BoxField — 담을 박스 고르기 ([쉽먼트] 모달 · 와우출고 [담기] 모달 공용)
//   그 사업자의 열린 박스(PACKING & 미출고) 중 하나 / [+ 새 박스] → BoxCreateModal
//   type 을 주면 그 타입 박스만 보여 주고 새 박스도 그 타입으로 시작한다 (와우출고 = X)
//   children: 박스 아래 경고 · 체크 (모달마다 다름)
// ============================================================

interface BoxFieldProps {
  userId: string;
  type?: BoxType;
  value: BoxInfoItem | null;
  onChange: (box: BoxInfoItem | null) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

const BoxField: React.FC<BoxFieldProps> = ({ userId, type, value, onChange, disabled, children }) => {
  const { t } = useTranslation();
  const { userCodeOf } = useStorage();
  const userCode = userCodeOf(userId);
  const [boxes, setBoxes] = useState<BoxInfoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // ── 열린 박스 목록 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/ft/box-info?user_id=${encodeURIComponent(userId)}&status=PACKING&shipment_id=null`);
        const json = await res.json();
        if (cancelled) return;
        const list = ((json.success ? json.data : []) as BoxInfoItem[])
          .filter((b) => !type || b.type === type)
          .sort((a, b) => (a.box_code || '').localeCompare(b.box_code || ''));
        setBoxes(list);
      } catch (err) {
        if (!cancelled) console.error('박스 목록 조회 오류:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, type]);

  const handleCreated = (created: CreatedBox) => {
    const item: BoxInfoItem = { id: created.id, box_code: created.box_code, size: created.size, type: created.type, no: created.no };
    setBoxes((prev) => [...prev.filter((b) => b.id !== item.id), item].sort((a, b) => a.box_code.localeCompare(b.box_code)));
    onChange(item);
    setShowCreate(false);
  };

  return (
    <div className="storage-modal-field">
      <div className="storage-field-head">
        <label>{t('storage.pick.box')}</label>
        <button
          type="button"
          className="storage-link-btn"
          onClick={() => setShowCreate(true)}
          disabled={loading || disabled || !userCode}
        >
          {t('storage.pick.newBox')}
        </button>
      </div>
      {loading ? (
        <span className="storage-hint">{t('storage.loading')}</span>
      ) : boxes.length === 0 ? (
        <span className="storage-hint">{t('storage.pick.noBoxes')}</span>
      ) : (
        <select
          className="storage-select"
          value={value?.id ?? ''}
          onChange={(e) => onChange(boxes.find((b) => b.id === e.target.value) ?? null)}
          disabled={disabled}
        >
          <option value="">{t('storage.pick.selectBox')}</option>
          {boxes.map((b) => (
            <option key={b.id} value={b.id}>{b.box_code}{b.size ? ` (${b.size})` : ''}</option>
          ))}
        </select>
      )}
      {children}

      {showCreate && (
        <BoxCreateModal
          userId={userId}
          userCode={userCode}
          existingBoxes={boxes}
          initialType={type}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
};

export default BoxField;
