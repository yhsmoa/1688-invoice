'use client';

import React, { useEffect, useState } from 'react';
import { useFtUsers } from '../../../import-product-v2/hooks/useFtData';
import type { VenderPick } from '../utils/loadShipmentRows';
import './ShipmentLoadModal.css';

// ============================================================
// 불러오기 모달 — 통관서류 작성 [불러오기]
//   쉽먼트 V2(/shipment-v2) 의 지금 출고준비 목록을 사업자별로 골라 불러온다.
//   여러 사업자를 함께 고를 수 있다 (한 컨테이너로 같이 나갈 때).
// ============================================================

interface Props {
  isOpen: boolean;
  loading: boolean;
  onClose: () => void;
  onLoad: (picks: VenderPick[]) => void;
}

const ShipmentLoadModal: React.FC<Props> = ({ isOpen, loading, onClose, onLoad }) => {
  const { users, loading: usersLoading } = useFtUsers();
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // 열 때마다 선택 초기화
  useEffect(() => { if (isOpen) setChecked(new Set()); }, [isOpen]);

  const toggle = (id: string, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleLoad = () => {
    const picks = users
      .filter((u) => checked.has(u.id))
      .map((u) => ({ userId: u.id, userCode: u.user_code, venderName: u.vender_name || u.user_code }));
    if (picks.length === 0) { alert('불러올 사업자를 선택해주세요.'); return; }
    onLoad(picks);
  };

  if (!isOpen) return null;
  const allOn = users.length > 0 && users.every((u) => checked.has(u.id));

  return (
    <div className="shipment-load-overlay" onClick={() => !loading && onClose()}>
      <div className="shipment-load-modal" role="dialog" aria-modal="true" aria-labelledby="shipmentLoadTitle" onClick={(e) => e.stopPropagation()}>
        {/* ── 머리 ── */}
        <div className="shipment-load-header">
          <h2 id="shipmentLoadTitle" className="shipment-load-title">쉽먼트 V2 불러오기</h2>
          <button className="shipment-load-close" onClick={onClose} disabled={loading} aria-label="닫기">×</button>
        </div>
        <p className="shipment-load-hint">
          쉽먼트 V2 화면의 지금 출고준비 목록을 사업자별로 불러와요. 여러 사업자를 함께 고를 수 있어요.
          <br />불러오면 지금 목록을 바꿉니다 (상자 = 마킹 1개, 합배송은 마스터 상자로 묶어요).
        </p>

        {/* ── 사업자 ── */}
        <div className="shipment-load-body">
          {usersLoading ? (
            <div className="shipment-load-empty">사업자 목록을 불러오는 중…</div>
          ) : users.length === 0 ? (
            <div className="shipment-load-empty shipment-load-error">사업자 목록을 불러오지 못했습니다. 창을 닫고 다시 열어 주세요.</div>
          ) : (
            <>
              <label className="shipment-load-date">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => setChecked(e.target.checked ? new Set(users.map((u) => u.id)) : new Set())}
                  disabled={loading}
                />
                전체
              </label>
              <div className="shipment-load-items">
                {users.map((u) => (
                  <label key={u.id} className={`shipment-load-item${checked.has(u.id) ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked.has(u.id)}
                      onChange={(e) => toggle(u.id, e.target.checked)}
                      disabled={loading}
                    />
                    <span className="shipment-load-brand">{u.vender_name || u.user_code}</span>
                    <span className="shipment-load-code">{u.user_code}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── 바닥 ── */}
        <div className="shipment-load-footer">
          <span className="shipment-load-selected">선택 {checked.size}개</span>
          <button className="shipment-load-cancel" onClick={onClose} disabled={loading}>취소</button>
          <button className="shipment-load-submit" onClick={handleLoad} disabled={loading || checked.size === 0}>
            {loading ? (<><span style={{ marginRight: 8 }}>불러오는 중...</span><span className="spinner" /></>) : '불러오기'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShipmentLoadModal;
