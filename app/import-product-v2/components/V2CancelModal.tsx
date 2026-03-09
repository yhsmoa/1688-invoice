'use client';

import React, { useState, useCallback, useEffect } from 'react';
import type { FtOrderItem } from '../hooks/useFtData';
import './V2CancelModal.css';

// ============================================================
// 타입 정의
// ============================================================

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

type Requester = '유화무역' | '고객';

// ============================================================
// V2CancelModal 컴포넌트
// ============================================================

const V2CancelModal: React.FC<V2CancelModalProps> = ({
  isOpen,
  onClose,
  items,
  selectedUserId,
  selectedOperator,
  onSaveComplete,
}) => {
  // ── 아이템별 입력 상태 (key = item.id)
  const [formData, setFormData] = useState<Map<string, ItemFormData>>(new Map());

  // ── 공통 필드
  const [requester, setRequester] = useState<Requester>('유화무역');
  const [isSaving, setIsSaving] = useState(false);
  const [savingStep, setSavingStep] = useState<'saving' | 'verifying'>('saving');

  // ── 모달 열릴 때마다 폼 초기화
  useEffect(() => {
    if (isOpen) {
      const initialMap = new Map<string, ItemFormData>();
      items.forEach((item) => {
        initialMap.set(item.id, { ...EMPTY_FORM });
      });
      setFormData(initialMap);
      setRequester('유화무역');
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
  // 유효성: qty > 0 인 항목이 하나 이상
  // ============================================================
  const isValid = (() => {
    for (const [, data] of formData) {
      const q = parseInt(data.qty, 10);
      if (!isNaN(q) && q > 0) return true;
    }
    return false;
  })();

  // ============================================================
  // [취소 접수] 클릭 — API 호출
  // ============================================================
  const handleSubmit = useCallback(async () => {
    if (!isValid || isSaving) return;

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
  }, [isValid, isSaving, items, formData, requester, selectedUserId, selectedOperator, onSaveComplete]);

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
          <h2>취소 접수</h2>
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
              {/* ── 1. 요청자 선택 (최상단) */}
              <div className="v2-cancel-global-section">
                <span className="v2-cancel-field-label">요청자</span>
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

              {/* ── 2. 아이템 카드 목록 */}
              {items.map((item) => {
                const data = formData.get(item.id) ?? { ...EMPTY_FORM };
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
                      {/* 수량 (필수) */}
                      <div className="v2-cancel-field-group">
                        <label className="v2-cancel-field-label v2-cancel-field-label-required">
                          수량 <span className="v2-cancel-required">* 필수</span>
                        </label>
                        <input
                          type="number"
                          className="v2-cancel-input"
                          value={data.qty}
                          min={1}
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
            푸터 — 닫기 / 취소 접수 버튼
        ──────────────────────────────────────── */}
        <div className="v2-cancel-footer">
          <button className="v2-cancel-btn-secondary" onClick={onClose} disabled={isSaving}>
            닫기
          </button>
          <button
            className="v2-cancel-btn-primary"
            onClick={handleSubmit}
            disabled={!isValid || isSaving || !selectedUserId}
          >
            {isSaving ? (
              <span className="v2-cancel-saving">
                <span className="v2-cancel-spinner" />
                {savingStep === 'saving' ? '저장 중...' : '검증 중...'}
              </span>
            ) : (
              '반품 접수'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2CancelModal;
