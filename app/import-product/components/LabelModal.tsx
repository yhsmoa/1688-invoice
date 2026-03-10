'use client';

import React, { useState, useCallback } from 'react';
import type { ItemData } from '../hooks/useItemData';
import { saveLabelDataV1 } from '../utils/saveLabelDataV1';
import '../../import-product-v2/components/V2LabelModal.css';

// ============================================================
// V1 라벨 모달 — 수량 입력 + Supabase invoiceManager_label 저장
// V2 V2LabelModal.tsx 와 동일한 UI, ItemData 타입 사용
// 저장 로직은 saveLabelDataV1 유틸 사용
// ============================================================

interface LabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 체크박스로 선택된 항목 중 barcode가 있는 것만 전달 */
  items: ItemData[];
  /** 쿠팡 사용자명 (brand) */
  brand: string | null;
  /** 담당자 번호 (소현→1, 장뢰→2, 3→3) */
  operatorId: number | null;
  /** 저장 완료 콜백 */
  onSaveComplete: () => void;
}

const LabelModal: React.FC<LabelModalProps> = ({
  isOpen,
  onClose,
  items,
  brand,
  operatorId,
  onSaveComplete,
}) => {
  // ============================================================
  // 수량 상태 관리 (item.id → qty)
  // ============================================================
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  // ============================================================
  // 수량 값 조회: 사용자 입력 > import_qty > order_qty > 1
  // ============================================================
  const getQty = useCallback(
    (item: ItemData): number => {
      if (productQuantities[item.id] !== undefined) return productQuantities[item.id];
      if (item.import_qty && item.import_qty > 0) return item.import_qty;
      if (item.order_qty && item.order_qty > 0) return item.order_qty;
      return 1;
    },
    [productQuantities]
  );

  // ============================================================
  // 수량 변경 핸들러
  // ============================================================
  const handleQtyChange = useCallback((itemId: string, value: string) => {
    const num = parseInt(value) || 1;
    setProductQuantities((prev) => ({ ...prev, [itemId]: num }));
  }, []);

  // ============================================================
  // 라벨 저장 핸들러 — saveLabelDataV1 사용
  // ============================================================
  const handleSave = useCallback(async () => {
    if (!operatorId) {
      alert('담당자를 선택해주세요.');
      return;
    }

    setIsSaving(true);

    try {
      const labelItems = items.map((item) => ({
        item,
        qty: getQty(item),
      }));

      const result = await saveLabelDataV1({
        items: labelItems,
        brand,
        operatorNo: operatorId,
      });

      if (result.success) {
        alert(`Supabase 저장 완료: ${result.count}개`);
        setProductQuantities({});
        onSaveComplete();
        onClose();
      } else {
        alert(`저장 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('라벨 저장 오류:', error);
      alert('라벨 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [items, brand, operatorId, getQty, onSaveComplete, onClose]);

  // ============================================================
  // 모달이 닫혀있으면 렌더링하지 않음
  // ============================================================
  if (!isOpen) return null;

  // ============================================================
  // 렌더링 — V2LabelModal.css 클래스 재사용
  // ============================================================
  return (
    <div className="v2-label-dialog-overlay" onClick={onClose}>
      <div className="v2-label-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="v2-label-dialog-header">
          <h2>LABEL 수량 입력</h2>
          <button className="v2-label-close-btn" onClick={onClose}>×</button>
        </div>

        {/* 컨텐츠 — 상품 정보 + 수량 테이블 */}
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
                    <td>
                      <div className="v2-label-product-info">
                        <div className="v2-label-product-name">
                          {item.product_name || ''} {item.product_name_sub || ''}
                        </div>
                        {(item.china_option1 || item.china_option2) && (
                          <div className="v2-label-china-options">
                            {item.china_option1 || ''} {item.china_option2 || ''}
                          </div>
                        )}
                        <div>
                          {item.order_number && (
                            <span className="v2-label-info-tag v2-label-tag-item-no">
                              {item.order_number}
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

        {/* 하단 액션 */}
        <div className="v2-label-dialog-actions">
          <button
            className="v2-label-postgre-btn"
            onClick={handleSave}
            disabled={isSaving || items.length === 0}
          >
            {isSaving ? (
              <span className="v2-label-button-loading">
                <span className="v2-spinner"></span>
                저장 중...
              </span>
            ) : (
              'LABEL 저장'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LabelModal;
