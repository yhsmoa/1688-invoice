'use client';

import React, { useState } from 'react';

// ============================================================
// CartRejectModal — [신규주문 상황] 카트 [반려] 확인
//
//   auto-1688-order 프로그램 [반려] 와 같은 흐름: 패스워드 입력 → status 'ORDER' → 'NEW'
//   패스워드 = 직원 접근 코드 8자리 (직책 '기업' · '매니저', lib/dbAccess.ts scope 'cartReject')
//     · 반려할 때마다 입력 — sessionStorage 에 저장하지 않는다
//     · 검증은 서버(/api/ft/new-orders/reject)가 한다
// ============================================================

// lib/dbAccess.ts DB_ACCESS_HEADER 와 같은 값 (서버 모듈이라 클라이언트에서 import 하지 않음)
const ACCESS_HEADER = 'x-db-access-code';
const CODE_LENGTH = 8;

export interface RejectTarget {
  id: string;
  cart_name: string | null;
  userName: string;
  items: number;
  qty: number;
}

interface CartRejectModalProps {
  target: RejectTarget;
  onClose: () => void;
  /** 반려 성공 — 호출 측이 목록을 다시 조회한다 */
  onRejected: (target: RejectTarget) => void;
}

const CartRejectModal: React.FC<CartRejectModalProps> = ({ target, onClose, onRejected }) => {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ============================================================
  // 반려 요청
  // ============================================================
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LENGTH || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/ft/new-orders/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ACCESS_HEADER]: code },
        body: JSON.stringify({ cart_id: target.id }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || '반려에 실패했습니다.');
        setCode('');
        return;
      }
      onRejected(target);
    } catch (err) {
      console.error('신규주문 반려 오류:', err);
      setError('반려 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="os-v2-reject-overlay" onMouseDown={onClose}>
      <form
        className="os-v2-reject-modal"
        role="dialog"
        aria-label="장바구니 반려 확인"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h3 className="os-v2-reject-title">장바구니 반려 확인</h3>

        <div className="os-v2-reject-target">
          <div className="os-v2-reject-target-user">{target.userName}</div>
          <div>
            {target.cart_name || '(이름 없음)'} · {target.items.toLocaleString('ko-KR')}품목 ·{' '}
            {target.qty.toLocaleString('ko-KR')}개
          </div>
        </div>

        <p className="os-v2-reject-desc">
          선택한 카트를 고객 장바구니(NEW) 상태로 되돌립니다.
          <br />
          진행하려면 패스워드(기업·매니저 접근 코드)를 입력하세요.
        </p>

        <input
          className="os-v2-reject-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={CODE_LENGTH}
          value={code}
          autoFocus
          onChange={(e) => {
            setCode(e.target.value.slice(0, CODE_LENGTH));
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />

        {error && <div className="os-v2-reject-error">{error}</div>}

        <div className="os-v2-reject-actions">
          <button type="button" className="os-v2-reject-btn" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button
            type="submit"
            className="os-v2-reject-btn os-v2-reject-btn--danger"
            disabled={code.length !== CODE_LENGTH || submitting}
          >
            {submitting ? '반려 중...' : '반려'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CartRejectModal;
