'use client';

import React, { useState } from 'react';
import type { ShipmentV2Row } from '../types';

// ============================================================
// ShipModal — 출고 처리 (ShipmentV2.tsx 에서 분리, 동작 동일)
//
//   쉽먼트 번호 = 'SH' + user_code + 6자리 숫자
//   저장: POST /api/ft/shipments { user_id, shipment_no, date, fulfillment_ids, box_codes }
//     → 출고된 행의 미처리 이동요청은 서버가 CANCELLED(shipped) 로 닫는다
// ============================================================
interface ShipModalProps {
  userId: string;
  userCode: string;
  /** 체크된 행 */
  rows: ShipmentV2Row[];
  onClose: () => void;
  /** 출고 성공 — 부모가 체크 해제 + 재조회 */
  onShipped: () => void;
}

const SHIP_INPUT_LENGTH = 6;
const SHIP_INPUT_PATTERN = /^\d{6}$/;

const ShipModal: React.FC<ShipModalProps> = ({ userId, userCode, rows, onClose, onShipped }) => {
  const [shipInput, setShipInput] = useState('');
  const [isShipping, setIsShipping] = useState(false);

  const handleConfirm = async () => {
    if (!SHIP_INPUT_PATTERN.test(shipInput)) {
      alert('6자리 숫자를 입력해주세요.');
      return;
    }
    if (!userCode) {
      alert('사용자를 먼저 선택해주세요.');
      return;
    }
    if (isShipping) return;

    const shipmentNo = `SH${userCode}${shipInput}`;
    const fulfillmentIds = rows.map((r) => r.id);
    const boxCodes = [...new Set(rows.map((r) => r.box_code).filter(Boolean))];

    setIsShipping(true);
    try {
      const res = await fetch('/api/ft/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          shipment_no: shipmentNo,
          date: new Date().toISOString().slice(0, 10),
          fulfillment_ids: fulfillmentIds,
          box_codes: boxCodes,
        }),
      });
      const json = await res.json();

      if (json.success) {
        alert(`출고 완료: ${shipmentNo}\n(${json.updated_fulfillments}건 처리)`);
        onShipped();
      } else {
        alert('출고 실패: ' + (json.error || ''));
      }
    } catch {
      alert('출고 처리 중 오류가 발생했습니다.');
    } finally {
      setIsShipping(false);
    }
  };

  return (
    <div className="shipment-v2-modal-overlay" onClick={() => !isShipping && onClose()}>
      <div className="shipment-v2-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="shipment-v2-modal-title">출고 처리</h3>
        <p className="shipment-v2-modal-desc">선택된 {rows.length}개 항목을 출고합니다.</p>
        <div className="shipment-v2-modal-field">
          <label>쉽먼트 번호 (6자리 숫자)</label>
          <div className="shipment-v2-ship-preview">
            SH{userCode || '??'}{shipInput || '______'}
          </div>
          <input
            type="text"
            className="shipment-v2-ship-input"
            placeholder="000000"
            value={shipInput}
            onChange={(e) => setShipInput(e.target.value.replace(/\D/g, '').slice(0, SHIP_INPUT_LENGTH))}
            maxLength={SHIP_INPUT_LENGTH}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && shipInput.length === SHIP_INPUT_LENGTH) handleConfirm();
            }}
          />
        </div>
        <div className="shipment-v2-modal-actions">
          <button className="shipment-v2-modal-cancel" onClick={onClose} disabled={isShipping}>취소</button>
          <button
            className="shipment-v2-modal-confirm shipment-v2-modal-confirm--danger"
            onClick={handleConfirm}
            disabled={shipInput.length !== SHIP_INPUT_LENGTH || isShipping}
          >
            {isShipping ? '처리 중...' : '출고'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShipModal;
