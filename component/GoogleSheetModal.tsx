'use client';

import React from 'react';
import './GoogleSheetModal.css';

interface GoogleSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  pasteData: string;
  setPasteData: (data: string) => void;
}

const GoogleSheetModal: React.FC<GoogleSheetModalProps> = ({
  isOpen,
  onClose,
  onSave,
  pasteData,
  setPasteData,
}) => {
  if (!isOpen) return null;

  return (
    <div className="google-sheet-modal-overlay" onClick={onClose}>
      <div className="google-sheet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="google-sheet-modal-header">
          <div className="google-sheet-modal-buttons">
            <button className="google-sheet-modal-cancel-btn" onClick={onClose}>
              취소
            </button>
            <button className="google-sheet-modal-save-btn" onClick={onSave}>
              저장
            </button>
          </div>
        </div>
        <div className="google-sheet-modal-content">
          <textarea
            className="google-sheet-paste-area"
            placeholder="구글 시트 데이터를 여기에 붙여넣기 하세요..."
            value={pasteData}
            onChange={(e) => setPasteData(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};

export default GoogleSheetModal;
