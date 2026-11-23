'use client';

import React, { useRef, useState } from 'react';

// ============================================================
// 택배사 정리 모달 — 통관서류 작성 [택배사 정리]
//   통관 엑셀(`품목별` 시트)을 올리면 POST /api/process-delivery-excel 이
//   출고정리 · 사이즈 두 시트로 정리한 엑셀을 돌려준다 → `택배사정리_YYYYMMDD.xlsx` 로 내려받는다.
//   화면 목록은 쓰지 않는다 (올린 엑셀만 읽는다).
//
//   열릴 때만 마운트되므로(부모가 조건부 렌더) 열 때마다 파일 선택이 초기화된다.
//   스타일: 쉽먼트 V2 공용 모달(shipment-v2-modal-*) + cd-dropzone (customs-document.css)
// ============================================================
const VALID_EXTENSIONS = ['.xlsx', '.xls'];

interface Props {
  onClose: () => void;
}

const DeliveryModal: React.FC<Props> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 파일 고르기 (클릭 · 드래그앤드롭 공통 검사) ──
  const validateAndSetFile = (picked: File) => {
    const extension = picked.name.toLowerCase().slice(picked.name.lastIndexOf('.'));
    if (!VALID_EXTENSIONS.includes(extension)) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }
    setFile(picked);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) {
      validateAndSetFile(picked);
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const picked = e.dataTransfer.files?.[0];
    if (picked) validateAndSetFile(picked);
  };

  // ── 정리 엑셀 내려받기 ──
  const handleDownload = async () => {
    if (!file) {
      alert('엑셀 파일을 먼저 업로드해주세요.');
      return;
    }

    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/process-delivery-excel', { method: 'POST', body: formData });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '처리 중 오류가 발생했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `택배사정리_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // 성공 후 모달 닫기
      onClose();
    } catch (error) {
      console.error('택배사 정리 처리 오류:', error);
      alert(error instanceof Error ? error.message : '택배사 정리 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="shipment-v2-modal-overlay" onClick={onClose}>
      <div
        className="shipment-v2-modal sv2-modal--label"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deliveryModalTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="deliveryModalTitle" className="shipment-v2-modal-title">택배사 정리</h3>
        <p className="shipment-v2-modal-desc">
          [↓ 엑셀 다운] 으로 받은 통관 엑셀(품목별 시트)을 올리면 출고정리 · 사이즈 시트로 정리해 드려요.
        </p>

        {/* ── 올릴 파일 ── */}
        <div
          className={`cd-dropzone ${isDragging ? 'is-over' : ''} ${file ? 'has-file' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={VALID_EXTENSIONS.join(',')}
            onChange={handleFileSelect}
            hidden
          />
          <svg className="cd-dropzone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {file
              ? <path d="M20 6 9 17l-5-5" />
              : <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />}
          </svg>
          <div className="cd-dropzone-text">{file ? file.name : '클릭하여 엑셀 파일을 선택하세요'}</div>
          <div className="cd-dropzone-hint">
            {file ? '다른 파일을 선택하려면 클릭하세요' : '클릭 또는 드래그앤드롭으로 파일을 업로드하세요'}
          </div>
        </div>

        <div className="shipment-v2-modal-actions">
          <button type="button" className="shipment-v2-modal-cancel" onClick={onClose}>닫기</button>
          <button
            type="button"
            className="shipment-v2-modal-confirm"
            onClick={handleDownload}
            disabled={!file || isProcessing}
          >
            {isProcessing ? (<>처리 중... <span className="cd-spinner" /></>) : '택배사 정리 엑셀 다운로드'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryModal;
