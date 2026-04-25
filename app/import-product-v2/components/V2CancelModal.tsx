'use client';

import React, { useState, useCallback, useEffect } from 'react';
import type { FtOrderItem } from '../hooks/useFtData';
import './V2CancelModal.css';

// ============================================================
// 타입 정의
// ============================================================

/** 취소 타입 — Phase 1 마이그레이션으로 분리됨 */
type CancelType = 'CANCEL' | 'RETURN';
type Requester = '유화무역' | '고객';

interface V2CancelModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 체크박스로 선택된 ft_order_items 목록 */
  items: FtOrderItem[];
  /** 현재 선택된 ft_users.id */
  selectedUserId: string;
  /** 현재 선택된 담당자 이름 */
  selectedOperator: string;
  /** 저장 완료 후 콜백 (모달 닫기 + 목록 새로고침) */
  onSaveComplete: () => void;
  /** item_id → ARRIVAL 합계 — 입력 한도 계산용. 미제공 시 한도 검증 skip (구버전 호환) */
  arrivalMap?: Map<string, number>;
  /** item_id → CANCEL 합계 (기존) — CANCEL 한도 계산용 (기존 취소분 중복 방지) */
  cancelMap?: Map<string, number>;
  /** item_id → RETURN 합계 (기존) — RETURN 한도 계산용 */
  returnMap?: Map<string, number>;
}

/** 아이템별 입력 폼 데이터 */
interface ItemFormData {
  qty: string;               // 필수
  total_price_cny: string;
  delivery_price_cny: string;
  service_fee: string;
  cancel_reason: string;
}

const EMPTY_FORM: ItemFormData = {
  qty: '',
  total_price_cny: '',
  delivery_price_cny: '',
  service_fee: '',
  cancel_reason: '',
};

// ============================================================
// V2CancelModal 컴포넌트
//
// Phase 3 변경 사항:
//   - 타입 (주문 취소 / 반품 접수) 라디오 신규 — 미선택 기본
//   - 요청자 라디오 미선택 기본 (이전: 유화무역 자동 선택)
//   - 입력 한도 검증:
//       CANCEL: qty ≤ order_qty - ARRIVAL   (입고 안 된 수량 안에서만 취소)
//       RETURN: qty ≤ ARRIVAL - 기존 RETURN  (입고된 것 중 안 돌려보낸 만큼만)
//   - 두 라디오 모두 선택해야 [반품 접수] 활성
//   - cancel_type 을 API 에 전달
// ============================================================

const V2CancelModal: React.FC<V2CancelModalProps> = ({
  isOpen,
  onClose,
  items,
  selectedUserId,
  selectedOperator,
  onSaveComplete,
  arrivalMap,
  cancelMap,
  returnMap,
}) => {
  // ── 아이템별 입력 상태 (key = item.id)
  const [formData, setFormData] = useState<Map<string, ItemFormData>>(new Map());

  // ── 공통 필드 — 모두 미선택 기본 (사용자가 명시적으로 선택해야 함)
  const [cancelType, setCancelType] = useState<CancelType | null>(null);
  const [requester, setRequester] = useState<Requester | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savingStep, setSavingStep] = useState<'saving' | 'verifying'>('saving');

  // ── 모달 열릴 때마다 폼 초기화 (cancelType, requester 모두 null 로)
  useEffect(() => {
    if (isOpen) {
      const initialMap = new Map<string, ItemFormData>();
      items.forEach((item) => {
        initialMap.set(item.id, { ...EMPTY_FORM });
      });
      setFormData(initialMap);
      setCancelType(null);
      setRequester(null);
    }
  }, [isOpen, items]);

  // ── Esc 키로 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // ============================================================
  // 입력 한도 계산 (cancelType 별)
  //   CANCEL: order_qty - ARRIVAL - 기존CANCEL  (미입고분 안에서, 중복 취소 방지)
  //   RETURN: ARRIVAL - 기존RETURN              (입고분 안에서)
  //   maps 미제공 시 Infinity (검증 skip — 구버전 호환)
  // ============================================================
  const computeInputLimit = useCallback(
    (item: FtOrderItem): number => {
      if (!cancelType) return Infinity;   // 타입 미선택 시 한도 적용 안 함
      if (!arrivalMap) return Infinity;   // map 미제공 (구버전 호환)
      const arrival = arrivalMap.get(item.id) ?? 0;
      if (cancelType === 'CANCEL') {
        const existingCancel = cancelMap?.get(item.id) ?? 0;
        return Math.max(0, (item.order_qty ?? 0) - arrival - existingCancel);
      }
      // RETURN
      const existingReturn = returnMap?.get(item.id) ?? 0;
      return Math.max(0, arrival - existingReturn);
    },
    [cancelType, arrivalMap, cancelMap, returnMap]
  );

  // ============================================================
  // 아이템별 필드 업데이트
  // ============================================================
  const updateField = useCallback(
    (itemId: string, field: keyof ItemFormData, value: string) => {
      setFormData((prev) => {
        const next = new Map(prev);
        const current = next.get(itemId) ?? { ...EMPTY_FORM };
        const updated: ItemFormData = { ...current, [field]: value };

        // total_price_cny 입력 시 service_fee 자동 계산 (6%)
        if (field === 'total_price_cny') {
          const price = parseFloat(value);
          updated.service_fee = !isNaN(price) && price > 0
            ? String(Math.round(price * 0.06 * 100) / 100)
            : '';
        }

        next.set(itemId, updated);
        return next;
      });
    },
    []
  );

  // ============================================================
  // 유효성:
  //   1. cancelType + requester 둘 다 선택됨
  //   2. qty > 0 인 항목이 하나 이상
  //   3. 모든 qty 가 inputLimit 이하 (한도 초과 입력 금지)
  // ============================================================
  const validation = (() => {
    if (!cancelType || !requester) {
      return { valid: false, hasQty: false, errors: [] as string[] };
    }
    let hasAnyQty = false;
    const errors: string[] = [];
    for (const item of items) {
      const data = formData.get(item.id);
      if (!data) continue;
      const q = parseInt(data.qty, 10);
      if (isNaN(q) || q <= 0) continue;
      hasAnyQty = true;
      const limit = computeInputLimit(item);
      if (q > limit) {
        errors.push(`${item.item_no || item.id}: 입력 ${q} > 한도 ${limit}`);
      }
    }
    return { valid: hasAnyQty && errors.length === 0, hasQty: hasAnyQty, errors };
  })();

  // ============================================================
  // [반품 접수] 클릭 — API 호출
  // ============================================================
  const handleSubmit = useCallback(async () => {
    if (!validation.valid || isSaving) return;
    if (!cancelType || !requester) return;

    if (validation.errors.length > 0) {
      alert('한도 초과 항목이 있습니다:\n\n' + validation.errors.join('\n'));
      return;
    }

    // qty가 입력된 항목만 전송
    const submitItems = items
      .map((item) => {
        const data = formData.get(item.id) ?? { ...EMPTY_FORM };
        const qty = parseInt(data.qty, 10);
        if (isNaN(qty) || qty <= 0) return null;

        return {
          order_item_id: item.id,
          item_no: item.item_no,
          item_name: item.item_name,
          option_name: item.option_name,
          order_no: item.order_no,
          product_no: item.product_no,
          product_id: item.product_id,
          order_1688_id: item['1688_order_id'],
          qty,
          total_price_cny: data.total_price_cny ? parseFloat(data.total_price_cny) : null,
          delivery_price_cny: data.delivery_price_cny ? parseFloat(data.delivery_price_cny) : null,
          service_fee: data.service_fee ? parseFloat(data.service_fee) : null,
          cancel_reason: data.cancel_reason || null,
          requester,
          cancel_type: cancelType,
        };
      })
      .filter(Boolean);

    if (submitItems.length === 0) return;

    setIsSaving(true);
    setSavingStep('saving');
    try {
      const res = await fetch('/api/ft/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUserId,
          operator_name: selectedOperator || null,
          items: submitItems,
        }),
      });
      setSavingStep('verifying');
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || '취소 접수 실패');
      }

      alert(json.message);
      onSaveComplete();
    } catch (err) {
      console.error('취소 접수 오류:', err);
      alert(err instanceof Error ? err.message : '취소 접수 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [validation, isSaving, items, formData, requester, cancelType, selectedUserId, selectedOperator, onSaveComplete]);

  if (!isOpen) return null;

  return (
    // ── 배경 오버레이
    <div className="v2-cancel-overlay" onClick={onClose}>
      {/* ── 모달 박스 (클릭 이벤트 전파 차단) */}
      <div
        className="v2-cancel-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ────────────────────────────────────────
            헤더
        ──────────────────────────────────────── */}
        <div className="v2-cancel-header">
          <h2>취소 / 반품 접수</h2>
          <button className="v2-cancel-close-btn" onClick={onClose}>×</button>
        </div>

        {/* ────────────────────────────────────────
            바디
        ──────────────────────────────────────── */}
        <div className="v2-cancel-body">
          {items.length === 0 ? (
            <div className="v2-cancel-empty">선택된 항목이 없습니다.</div>
          ) : (
            <>
              {/* ── 1. 타입 + 요청자 선택 (한 줄) ── */}
              <div className="v2-cancel-global-section">
                <span className="v2-cancel-field-label v2-cancel-field-label-required">
                  타입 <span className="v2-cancel-required">*</span>
                </span>
                <div className="v2-cancel-requester-toggle">
                  {(['CANCEL', 'RETURN'] as CancelType[]).map((c) => (
                    <button
                      key={c}
                      className={`v2-cancel-requester-btn ${cancelType === c ? 'active' : ''}`}
                      onClick={() => setCancelType(c)}
                    >
                      {c === 'CANCEL' ? '주문 취소' : '반품 접수'}
                    </button>
                  ))}
                </div>
                <span className="v2-cancel-field-label v2-cancel-field-label-required" style={{ marginLeft: 16 }}>
                  요청자 <span className="v2-cancel-required">*</span>
                </span>
                <div className="v2-cancel-requester-toggle">
                  {(['유화무역', '고객'] as Requester[]).map((r) => (
                    <button
                      key={r}
                      className={`v2-cancel-requester-btn ${requester === r ? 'active' : ''}`}
                      onClick={() => setRequester(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── 3. 아이템 카드 목록 */}
              {items.map((item) => {
                const data = formData.get(item.id) ?? { ...EMPTY_FORM };
                const limit = computeInputLimit(item);
                const qtyNum = parseInt(data.qty, 10);
                const isOverLimit = !isNaN(qtyNum) && qtyNum > limit && cancelType !== null;

                return (
                  <div key={item.id} className="v2-cancel-item-card">
                    {/* ── 카드 헤더: 배지 + 상품 정보 */}
                    <div className="v2-cancel-item-header">
                      <span className="v2-cancel-status-badge">접수</span>
                      <span className="v2-cancel-item-no">{item.item_no || '-'}</span>
                      <span className="v2-cancel-item-name">
                        {item.item_name || '-'}
                        {item.option_name && (
                          <span className="v2-cancel-option-name"> / {item.option_name}</span>
                        )}
                      </span>
                    </div>

                    {/* ── 입력 필드 그리드: 수량 | 가격 | 배송비 | 서비스료 */}
                    <div className="v2-cancel-item-fields">
                      {/* 수량 (필수) — 한도 표시 + 초과 입력 시 강조 */}
                      <div className="v2-cancel-field-group">
                        <label className="v2-cancel-field-label v2-cancel-field-label-required">
                          수량 <span className="v2-cancel-required">* 필수</span>
                          {cancelType && limit !== Infinity && (
                            <span className="v2-cancel-limit-hint"> (최대 {limit})</span>
                          )}
                        </label>
                        <input
                          type="number"
                          className={`v2-cancel-input ${isOverLimit ? 'v2-cancel-input-error' : ''}`}
                          value={data.qty}
                          min={1}
                          max={limit !== Infinity ? limit : undefined}
                          placeholder="수량 입력"
                          onChange={(e) => updateField(item.id, 'qty', e.target.value)}
                        />
                      </div>

                      {/* 가격 (CNY) */}
                      <div className="v2-cancel-field-group">
                        <label className="v2-cancel-field-label">가격 (CNY)</label>
                        <input
                          type="number"
                          className="v2-cancel-input"
                          value={data.total_price_cny}
                          placeholder="0.00"
                          step="0.01"
                          onChange={(e) => updateField(item.id, 'total_price_cny', e.target.value)}
                        />
                      </div>

                      {/* 배송비 (CNY) */}
                      <div className="v2-cancel-field-group">
                        <label className="v2-cancel-field-label">배송비 (CNY)</label>
                        <input
                          type="number"
                          className="v2-cancel-input"
                          value={data.delivery_price_cny}
                          placeholder="0.00"
                          step="0.01"
                          onChange={(e) => updateField(item.id, 'delivery_price_cny', e.target.value)}
                        />
                      </div>

                      {/* 서비스료 (자동 6%) */}
                      <div className="v2-cancel-field-group">
                        <label className="v2-cancel-field-label">서비스료 (6%)</label>
                        <input
                          type="number"
                          className="v2-cancel-input v2-cancel-input-auto"
                          value={data.service_fee}
                          placeholder="자동"
                          step="0.01"
                          onChange={(e) => updateField(item.id, 'service_fee', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* ── 반품 사유 (textarea) */}
                    <div className="v2-cancel-reason-group">
                      <label className="v2-cancel-field-label">반품 사유</label>
                      <textarea
                        className="v2-cancel-textarea"
                        value={data.cancel_reason}
                        placeholder="반품 사유를 입력하세요"
                        rows={2}
                        onChange={(e) => updateField(item.id, 'cancel_reason', e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* ────────────────────────────────────────
            푸터 — 닫기 / 반품 접수 버튼
        ──────────────────────────────────────── */}
        <div className="v2-cancel-footer">
          <button className="v2-cancel-btn-secondary" onClick={onClose} disabled={isSaving}>
            닫기
          </button>
          <button
            className="v2-cancel-btn-primary"
            onClick={handleSubmit}
            disabled={!validation.valid || isSaving || !selectedUserId}
            title={
              !cancelType ? '타입을 먼저 선택해주세요' :
              !requester ? '요청자를 먼저 선택해주세요' :
              !validation.hasQty ? '수량을 입력하세요' :
              validation.errors.length > 0 ? '한도 초과 항목이 있습니다' :
              undefined
            }
          >
            {isSaving ? (
              <span className="v2-cancel-saving">
                <span className="v2-cancel-spinner" />
                {savingStep === 'saving' ? '저장 중...' : '검증 중...'}
              </span>
            ) : (
              '접수'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2CancelModal;
