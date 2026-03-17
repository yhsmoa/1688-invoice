'use client';

import React, { useState, useCallback } from 'react';
import './BoxLabelModal.css';

// ============================================================
// Props
// ============================================================
interface BoxLabelModalProps {
  onClose: () => void;
}

// ============================================================
// BoxLabelModal — 박스 라벨 생성 + 인쇄
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
  // [생성] → 새 창에서 인쇄
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

    // 새 인쇄 창 열기
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
      alert('팝업이 차단되었습니다. 팝업을 허용해주세요.');
      return;
    }

    // JsBarcode CDN + 인쇄 HTML 생성
    const pagesHtml = labels.map((label, idx) => `
      <div class="label-page">
        <div class="label-content">
          <div class="label-text">${label}</div>
          <svg id="bc-${idx}"></svg>
        </div>
      </div>
    `).join('');

    const barcodeScript = labels.map((label, idx) =>
      `JsBarcode("#bc-${idx}", "${label}", { format: "CODE128", width: 1.5, height: 30, displayValue: false, margin: 0 });`
    ).join('\n');

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>BOX LABEL</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }

    @page {
      margin: 0;
    }

    .label-page {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      page-break-after: always;
    }

    .label-page:last-child {
      page-break-after: auto;
    }

    .label-content {
      transform: rotate(90deg);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }

    .label-text {
      font-size: 14pt;
      font-weight: 700;
      font-family: Arial, sans-serif;
      color: #000;
      text-align: center;
      line-height: 1;
      white-space: nowrap;
    }

    .label-content svg {
      height: 25px;
    }

    @media screen {
      .label-page {
        width: 50mm;
        height: 70mm;
        border: 1px dashed #ccc;
        margin: 10px auto;
      }
    }
  </style>
</head>
<body>
  ${pagesHtml}
  <script>
    ${barcodeScript}
    setTimeout(function() { window.print(); }, 500);
  <\/script>
</body>
</html>`);

    printWindow.document.close();
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
