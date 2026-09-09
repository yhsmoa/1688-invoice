'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem, FtUser } from '../hooks/useFtData';
import { saveLabelData } from '../utils/saveLabelData';
import { printLabels } from '../utils/printLabels';
import type { LabelType } from '../../../lib/labelTypes';
import './V2LabelModal.css';

// ============================================================
// V2 라벨 모달 — 수량 입력 + 저장 / 즉시 출력
//
//   [LABEL 저장]        : Supabase invoiceManager_label (기존 BarTender 경로 유지)
//   [라벨 스티커]        : QZ Tray 로 바코드 감열지 즉시 출력
//   [케어 라벨]          : QZ Tray 로 케어라벨 즉시 출력
//     → 종류 선택 드롭다운 없이, 종류별 버튼을 바로 눌러 그 자리에서 인쇄한다.
//       템플릿·프린터는 [라벨 설정]에서 지정한 값을 자동 사용
// ============================================================

/** 즉시 출력 성공 표시 유지 시간 */
const PRINTED_MSG_MS = 3000;

interface V2LabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 체크박스로 선택된 항목 중 barcode가 있는 것만 전달 */
  items: FtOrderItem[];
  /** 선택된 ft_user (brand 포함) */
  selectedUser: FtUser | null;
  /** 담당자 번호 (소현→1, 장뢰→2, 3→3) */
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
  const { t } = useTranslation();
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isPrintingBarcode, setIsPrintingBarcode] = useState(false);
  const [isPrintingCare, setIsPrintingCare] = useState(false);
  /** 즉시 출력 성공 표시 ("N장 전송됨") — 잠깐 보였다 사라진다 */
  const [printedMsg, setPrintedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!printedMsg) return;
    const timer = setTimeout(() => setPrintedMsg(null), PRINTED_MSG_MS);
    return () => clearTimeout(timer);
  }, [printedMsg]);

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
  // 라벨 저장 핸들러 — 공통 saveLabelData 사용
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

      const result = await saveLabelData({
        items: labelItems,
        brand: selectedUser?.brand || null,
        operatorNo: operatorId,
      });

      if (result.success) {
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
  }, [items, selectedUser, operatorId, getQty, onSaveComplete, onClose]);

  // ============================================================
  // 즉시 출력 핸들러 — QZ Tray 로 그 자리에서 인쇄
  //   PC-NO(operatorId) = 작업 자리, 템플릿/프린터는 라벨 설정값 사용
  //   종류(labelType)는 버튼별로 바로 넘어온다 (드롭다운 없음)
  // ============================================================
  const handlePrint = useCallback(
    async (labelType: LabelType) => {
      if (!operatorId) {
        alert('PC-NO를 선택해주세요. (프린터 자리 구분에 필요)');
        return;
      }

      const setBusy = labelType === 'barcode' ? setIsPrintingBarcode : setIsPrintingCare;
      const typeLabel = t(
        labelType === 'barcode'
          ? 'importProduct.processReady.labelSticker'
          : 'importProduct.processReady.careLabel'
      );

      setBusy(true);
      try {
        const result = await printLabels({
          items: items.map((item) => ({ item, qty: getQty(item) })),
          userId: selectedUser?.id ?? null,
          selectedUser,
          brand: selectedUser?.brand || null,
          stationNo: operatorId,
          labelType,
          printedBy: null,
        });

        if (result.success) {
          // 성공은 창을 띄우지 않고 버튼 옆에 잠깐만 표시한다 (작업 흐름을 끊지 않게)
          setPrintedMsg(`${typeLabel} ${t('importProduct.processReady.printedCount', { count: result.printed })}`);
        } else {
          alert(result.error || '출력에 실패했습니다.');
        }
      } catch (error) {
        console.error('라벨 출력 오류:', error);
        alert('라벨 출력 중 오류가 발생했습니다.');
      } finally {
        setBusy(false);
      }
    },
    [items, selectedUser, operatorId, getQty, t]
  );

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
          {printedMsg && <span className="v2-label-print-status">✓ {printedMsg}</span>}

          {/* 즉시 출력 — 종류별 버튼 (드롭다운 없이 바로 그 종류로 인쇄) */}
          <button
            className="v2-label-print-btn"
            onClick={() => handlePrint('barcode')}
            disabled={isPrintingBarcode || isPrintingCare || items.length === 0}
            title="라벨 설정에서 지정한 템플릿·프린터로 그 자리에서 출력합니다"
          >
            {isPrintingBarcode ? (
              <span className="v2-label-button-loading">
                <span className="v2-spinner"></span>
                {t('importProduct.processReady.printing')}
              </span>
            ) : (
              t('importProduct.processReady.labelSticker')
            )}
          </button>

          <button
            className="v2-label-print-btn"
            onClick={() => handlePrint('care')}
            disabled={isPrintingBarcode || isPrintingCare || items.length === 0}
            title="라벨 설정에서 지정한 템플릿·프린터로 그 자리에서 출력합니다"
          >
            {isPrintingCare ? (
              <span className="v2-label-button-loading">
                <span className="v2-spinner"></span>
                {t('importProduct.processReady.printing')}
              </span>
            ) : (
              t('importProduct.processReady.careLabel')
            )}
          </button>

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

export default V2LabelModal;
