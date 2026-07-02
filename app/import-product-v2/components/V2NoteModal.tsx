'use client';

import React, { useState, useEffect } from 'react';

// ============================================================
// V2NoteModal — 비고 입력 모달
// 체크된 아이템들에 대해 ft_order_items.note_cn 일괄 저장/수정
// (note_cn = 상품명 셀 하단 빨간색으로 표시되는 비고)
// ============================================================

interface V2NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: string[];
  /** 선택 항목들의 기존 note_cn — 모두 동일할 때 수정용으로 미리 채움 (다르면 '') */
  initialNote?: string;
  onSaveComplete: () => void;
}

const V2NoteModal: React.FC<V2NoteModalProps> = ({
  isOpen,
  onClose,
  selectedIds,
  initialNote = '',
  onSaveComplete,
}) => {
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  // ── 모달이 열릴 때 기존 note_cn 값으로 초기화 (수정 지원) ──
  useEffect(() => {
    if (isOpen) setNoteText(initialNote);
  }, [isOpen, initialNote]);

  // ── 저장: 기존 PATCH /api/ft/order-items 다건 업데이트 활용 ──
  const handleSave = async () => {
    if (!noteText.trim()) {
      alert('비고 내용을 입력해주세요.');
      return;
    }
    if (selectedIds.length === 0) return;

    setSaving(true);
    try {
      const updates = selectedIds.map((id) => ({
        id,
        fields: { note_cn: noteText.trim() },
      }));

      const res = await fetch('/api/ft/order-items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      const result = await res.json();
      if (!result.success) {
        alert(result.error || '저장 실패');
        return;
      }

      setNoteText('');
      onSaveComplete();
    } catch (err) {
      console.error('비고 저장 오류:', err);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setNoteText('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="v2-cancel-overlay" onClick={handleClose}>
      <div
        className="v2-cancel-dialog"
        style={{ maxWidth: 480, maxHeight: '50vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ── */}
        <div className="v2-cancel-header">
          <h2 style={{ fontSize: 16, margin: 0 }}>비고 ({selectedIds.length}건)</h2>
          <button className="v2-close-btn" onClick={handleClose}>×</button>
        </div>

        {/* ── 본문 ── */}
        <div style={{ padding: '16px 20px', flex: 1 }}>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="비고를 입력하세요..."
            rows={5}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #ddd',
              borderRadius: 6,
              fontSize: 14,
              resize: 'vertical',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* ── 푸터 ── */}
        <div className="v2-cancel-footer">
          <button
            onClick={handleClose}
            style={{
              padding: '8px 20px',
              border: '1px solid #ddd',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: 6,
              background: '#18181b',
              color: '#fff',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2NoteModal;
