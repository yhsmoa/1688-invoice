'use client';

import React, { useEffect, useState } from 'react';
import type { BoxInfoItem } from '../types';

// ============================================================
// MergeModal — 합배송 설정 (ShipmentV2.tsx 에서 분리, 동작 동일)
//
//   박스 1(합배송 대상).master_box_id = 박스 2(마스터).id
//   저장: PATCH /api/ft/box-info { id, fields: { master_box_id, master_box_code } }
//   대상 목록: 해당 사용자의 PACKING 박스 (box_code 오름차순)
// ============================================================
interface MergeModalProps {
  userId: string;
  onClose: () => void;
  /** 저장 성공 — 부모가 재조회 */
  onMerged: () => void;
}

const MergeModal: React.FC<MergeModalProps> = ({ userId, onClose, onMerged }) => {
  const [boxes, setBoxes] = useState<BoxInfoItem[]>([]);
  const [mergeFrom, setMergeFrom] = useState(''); // ft_box_info.id (source)
  const [mergeTo, setMergeTo] = useState('');     // ft_box_info.id (target/master)
  const [submitting, setSubmitting] = useState(false);

  // ── PACKING 상태 박스 목록 조회 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ft/box-info?user_id=${encodeURIComponent(userId)}&status=PACKING`);
        const json = await res.json();
        if (!cancelled && json.success) {
          const sorted = ((json.data || []) as BoxInfoItem[])
            .slice()
            .sort((a, b) => (a.box_code || '').localeCompare(b.box_code || ''));
          setBoxes(sorted);
        }
      } catch (err) {
        console.error('box-info fetch error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleConfirm = async () => {
    if (!mergeFrom || !mergeTo || mergeFrom === mergeTo) {
      alert('박스 1과 박스 2를 다르게 선택해주세요.');
      return;
    }
    const targetBox = boxes.find((b) => b.id === mergeTo);
    if (!targetBox || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/ft/box-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mergeFrom,
          fields: { master_box_id: mergeTo, master_box_code: targetBox.box_code },
        }),
      });
      const json = await res.json();
      if (json.success) {
        onMerged();
      } else {
        alert('합배송 실패: ' + (json.error || ''));
      }
    } catch {
      alert('합배송 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shipment-v2-modal-overlay" onClick={() => !submitting && onClose()}>
      <div className="shipment-v2-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="shipment-v2-modal-title">합배송 설정</h3>
        <p className="shipment-v2-modal-desc">박스 1이 박스 2에 합배송됩니다.</p>

        <div className="shipment-v2-modal-field">
          <label>박스 1 (합배송 대상)</label>
          <select className="shipment-v2-modal-select" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
            <option value="">선택</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>{b.box_code}</option>
            ))}
          </select>
        </div>

        <div className="shipment-v2-merge-arrow-label">↓</div>

        <div className="shipment-v2-modal-field">
          <label>박스 2 (마스터 박스)</label>
          <select className="shipment-v2-modal-select" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)}>
            <option value="">선택</option>
            {boxes.filter((b) => b.id !== mergeFrom).map((b) => (
              <option key={b.id} value={b.id}>{b.box_code}</option>
            ))}
          </select>
        </div>

        <div className="shipment-v2-modal-actions">
          <button className="shipment-v2-modal-cancel" onClick={onClose} disabled={submitting}>취소</button>
          <button className="shipment-v2-modal-confirm" onClick={handleConfirm} disabled={!mergeFrom || !mergeTo || submitting}>
            합배송
          </button>
        </div>
      </div>
    </div>
  );
};

export default MergeModal;
