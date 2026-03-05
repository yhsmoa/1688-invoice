'use client';

import React, { useState, useCallback } from 'react';
import type { FtOrderItem, FtUser } from '../hooks/useFtData';
import './V2LabelModal.css';

// ============================================================
// V2 라벨 모달 — V1 수량 입력 다이얼로그와 동일한 구조
// "LABEL postgre" 버튼만 유지 (LABEL 시트 저장 / 라디오 제거)
// ============================================================

interface V2LabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 체크박스로 선택된 항목 중 barcode가 있는 것만 전달 */
  items: FtOrderItem[];
  /** 선택된 ft_user (brand 포함) */
  selectedUser: FtUser | null;
  /** 담당자 → user_id 매핑에 사용 */
  operatorId: number | null;
  /** 입고 수량 (기본 qty로 사용) */
  modifiedImportQty: Map<string, number>;
  /** 저장 완료 콜백 */
  onSaveComplete: () => void;
}

const V2LabelModal: React.FC<V2LabelModalProps> = ({
  isOpen,
  onClose,
  items,
  selectedUser,
  operatorId,
  modifiedImportQty,
  onSaveComplete,
}) => {
  // ============================================================
  // 수량 상태 관리 (item.id → qty)
  // ============================================================
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  // ============================================================
  // 수량 값 조회: 사용자 입력 > modifiedImportQty > order_qty > 1
  // ============================================================
  const getQty = useCallback(
    (item: FtOrderItem): number => {
      if (productQuantities[item.id] !== undefined) return productQuantities[item.id];
      const importQty = modifiedImportQty.get(item.id);
      if (importQty && importQty > 0) return importQty;
      if (item.order_qty && item.order_qty > 0) return item.order_qty;
      return 1;
    },
    [productQuantities, modifiedImportQty]
  );

  // ============================================================
  // 수량 변경 핸들러
  // ============================================================
  const handleQtyChange = useCallback((itemId: string, value: string) => {
    const num = parseInt(value) || 1;
    setProductQuantities((prev) => ({ ...prev, [itemId]: num }));
  }, []);

  // ============================================================
  // 헬퍼: 세트상품 병합 — 동일 product_no 그룹 중 max qty로 1건만 유지
  //
  // set_total > 1 인 항목: product_no 기준으로 그룹핑 → qty 최대값 1건
  // set_total <= 1 인 항목(일반 상품): 그대로 유지
  // ============================================================
  const mergeSetItems = useCallback(
    (rawItems: typeof items) => {
      const normal: typeof items = [];
      const setGroups = new Map<string, { item: FtOrderItem; qty: number }>();

      for (const item of rawItems) {
        const isSet = (item.set_total ?? 0) > 1;
        const productNo = item.product_no;

        if (isSet && productNo) {
          const qty = getQty(item);
          const existing = setGroups.get(productNo);
          if (!existing || qty > existing.qty) {
            setGroups.set(productNo, { item, qty });
          }
        } else {
          normal.push(item);
        }
      }

      return { normal, setGroups };
    },
    [getQty]
  );

  // ============================================================
  // LABEL postgre 저장 핸들러
  // → 기존 /api/save-fashion-label API 재사용
  // ============================================================
  const handleSaveToPostgre = useCallback(async () => {
    // 필수 값 검증
    if (!operatorId) {
      alert('담당자를 선택해주세요.');
      return;
    }

    setIsSaving(true);

    try {
      // ── 세트상품 병합 처리 ──
      const { normal, setGroups } = mergeSetItems(items);

      // 일반 상품 → 그대로 매핑
      const labelItems = normal.map((item) => ({
        brand: selectedUser?.brand || null,
        item_name: [item.item_name, item.option_name].filter(Boolean).join(', '),
        barcode: item.barcode || '',
        qty: getQty(item),
        order_no: item.item_no || '',
        composition: item.composition || null,
        recommanded_age: item.recommanded_age || null,
        shipment_size: item.coupang_shipment_size || null,
        user_id: operatorId,
      }));

      // 세트상품 → product_no 그룹당 1건 (max qty)
      for (const [, { item, qty }] of setGroups) {
        labelItems.push({
          brand: selectedUser?.brand || null,
          item_name: [item.item_name, item.option_name].filter(Boolean).join(', '),
          barcode: item.barcode || '',
          qty,
          order_no: item.item_no || '',
          composition: item.composition || null,
          recommanded_age: item.recommanded_age || null,
          shipment_size: item.coupang_shipment_size || null,
          user_id: operatorId,
        });
      }

      if (labelItems.length === 0) {
        alert('저장할 데이터가 없습니다.');
        setIsSaving(false);
        return;
      }

      // API 호출 (수량 확장은 API에서 처리)
      const response = await fetch('/api/save-fashion-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: labelItems, user_id: operatorId }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setProductQuantities({});
        onSaveComplete();
        onClose();
      } else {
        console.error('LABEL postgre 저장 실패:', result);
        alert(`저장 실패: ${result.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('LABEL postgre 저장 오류:', error);
      alert('PostgreSQL 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [items, selectedUser, operatorId, getQty, mergeSetItems, onSaveComplete, onClose]);

  // ============================================================
  // 모달이 닫혀있으면 렌더링하지 않음
  // ============================================================
  if (!isOpen) return null;

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="v2-label-dialog-overlay" onClick={onClose}>
      <div className="v2-label-dialog" onClick={(e) => e.stopPropagation()}>
        {/* ============================================================ */}
        {/* 헤더 */}
        {/* ============================================================ */}
        <div className="v2-label-dialog-header">
          <h2>LABEL 수량 입력</h2>
          <button className="v2-label-close-btn" onClick={onClose}>×</button>
        </div>

        {/* ============================================================ */}
        {/* 컨텐츠 — 상품 정보 + 수량 테이블 */}
        {/* ============================================================ */}
        <div className="v2-label-dialog-content">
          {items.length === 0 ? (
            <div className="v2-label-empty-message">
              바코드가 있는 선택된 항목이 없습니다.
            </div>
          ) : (
            <table className="v2-label-table">
              <thead>
                <tr>
                  <th>상품 정보</th>
                  <th>수량</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    {/* 상품 정보 */}
                    <td>
                      <div className="v2-label-product-info">
                        <div className="v2-label-product-name">
                          {item.item_name || ''}
                        </div>
                        {(item.china_option1 || item.china_option2) && (
                          <div className="v2-label-china-options">
                            {item.china_option1 || ''} {item.china_option2 || ''}
                          </div>
                        )}
                        <div>
                          {item.item_no && (
                            <span className="v2-label-info-tag v2-label-tag-item-no">
                              {item.item_no}
                            </span>
                          )}
                          {item.barcode && (
                            <span className="v2-label-info-tag v2-label-tag-barcode">
                              {item.barcode}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 수량 입력 */}
                    <td>
                      <input
                        type="number"
                        min="1"
                        value={getQty(item)}
                        onChange={(e) => handleQtyChange(item.id, e.target.value)}
                        className="v2-label-qty-input"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ============================================================ */}
        {/* 하단 액션 — LABEL postgre 버튼만 */}
        {/* ============================================================ */}
        <div className="v2-label-dialog-actions">
          <button
            className="v2-label-postgre-btn"
            onClick={handleSaveToPostgre}
            disabled={isSaving || items.length === 0}
          >
            {isSaving ? (
              <span className="v2-label-button-loading">
                <span className="v2-spinner"></span>
                저장 중...
              </span>
            ) : (
              'LABEL postgre'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2LabelModal;
