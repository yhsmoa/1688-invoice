'use client';

import React, { useState, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import './BoxLabelModal.css';

// ============================================================
// Props
// ============================================================
interface BoxLabelModalProps {
  onClose: () => void;
}

// ============================================================
// BoxLabelModal — 박스 라벨 PDF 생성 + 인쇄
// ============================================================
const BoxLabelModal: React.FC<BoxLabelModalProps> = ({ onClose }) => {
  // ============================================================
  // 입력 상태
  // ============================================================
  const [userCode, setUserCode] = useState('');
  const [shipmentCode, setShipmentCode] = useState('');
  const [startNum, setStartNum] = useState('');
  const [endNum, setEndNum] = useState('');

  // ============================================================
  // [생성] → PDF 생성 후 새 탭에서 열기
  // ============================================================
  const handleGenerate = useCallback(() => {
    const code = userCode.trim().toUpperCase();
    const ship = shipmentCode.trim().toUpperCase();
    const start = parseInt(startNum);
    const end = parseInt(endNum);

    if (!code || !ship || isNaN(start) || isNaN(end) || start > end) {
      alert('모든 항목을 올바르게 입력해주세요.');
      return;
    }

    // 라벨 목록 생성
    const labels: string[] = [];
    for (let i = start; i <= end; i++) {
      labels.push(`${code}-${ship}-${String(i).padStart(2, '0')}`);
    }

    // ── PDF 생성 (portrait 세로: 50mm x 70mm) ──
    // 회전 없이 세로 방향 그대로, 정중앙 배치
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [50, 70],
    });

    const pageW = 50;  // mm
    const pageH = 70;  // mm
    const cx = pageW / 2; // 25mm (가로 중앙)
    const cy = pageH / 2; // 35mm (세로 중앙)

    labels.forEach((label, idx) => {
      if (idx > 0) doc.addPage([50, 70], 'portrait');

      // ── 텍스트: 중앙 상단 ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(28);
      doc.text(label, cx, cy - 8, { align: 'center' });

      // ── 바코드: 텍스트 아래 중앙 ──
      const bcCanvas = document.createElement('canvas');
      JsBarcode(bcCanvas, label, {
        format: 'CODE128',
        width: 2,
        height: 50,
        displayValue: false,
        margin: 0,
      });

      const bcImg = bcCanvas.toDataURL('image/png');
      const bcW = 40; // mm
      const bcH = 15; // mm
      doc.addImage(bcImg, 'PNG', cx - bcW / 2, cy - 2, bcW, bcH);
    });

    // PDF를 숨김 iframe에 넣고 바로 인쇄
    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
    };
  }, [userCode, shipmentCode, startNum, endNum]);

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="boxlabel-overlay" onClick={onClose}>
      <div className="boxlabel-modal" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="boxlabel-header">
          <h2>BOX LABEL</h2>
          <button className="boxlabel-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* 입력 폼 */}
        <div className="boxlabel-body">
          <input
            type="text"
            placeholder="USER CODE (BZ, BO...)"
            className="boxlabel-input"
            value={userCode}
            onChange={e => setUserCode(e.target.value.toUpperCase())}
            autoFocus
          />
          <input
            type="text"
            placeholder="SHIPMENT CODE (A, B, C, P, X)"
            className="boxlabel-input"
            value={shipmentCode}
            onChange={e => setShipmentCode(e.target.value.toUpperCase())}
          />
          <div className="boxlabel-range-row">
            <input
              type="number"
              placeholder="시작"
              className="boxlabel-input boxlabel-range"
              value={startNum}
              onChange={e => setStartNum(e.target.value)}
              min={1}
            />
            <span className="boxlabel-range-sep">~</span>
            <input
              type="number"
              placeholder="끝"
              className="boxlabel-input boxlabel-range"
              value={endNum}
              onChange={e => setEndNum(e.target.value)}
              min={1}
            />
          </div>

          {/* 미리보기 */}
          {userCode && shipmentCode && startNum && endNum && (
            <div className="boxlabel-preview">
              {`${userCode.toUpperCase()}-${shipmentCode.toUpperCase()}-${String(parseInt(startNum) || 0).padStart(2, '0')}`}
              {' ~ '}
              {`${userCode.toUpperCase()}-${shipmentCode.toUpperCase()}-${String(parseInt(endNum) || 0).padStart(2, '0')}`}
              {' '}({(parseInt(endNum) || 0) - (parseInt(startNum) || 0) + 1}장)
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="boxlabel-footer">
          <button className="boxlabel-cancel-btn" onClick={onClose}>취소</button>
          <button className="boxlabel-generate-btn" onClick={handleGenerate}>생성</button>
        </div>
      </div>
    </div>
  );
};

export default BoxLabelModal;
