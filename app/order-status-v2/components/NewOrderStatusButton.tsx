'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NewOrderUserSummary } from '../../api/ft/new-orders/route';
import CartRejectModal, { type RejectTarget } from './CartRejectModal';

// ============================================================
// NewOrderStatusButton — [신규주문 상황]
//
//   auto-1688-order 프로그램 [V2 주문] 탭 상단 "신규주문건" 보드와 같은 내용을
//   주문상태 V2 에서 바로 확인한다.
//     · 대상: ft_carts.status = 'ORDER' (프로그램에서 아직 불러오지 않은 카트)
//     · 사용자별 카트 수 · 품목 수 · 총 개수 + 카트 목록
//     · 카트별 [반려] — 패스워드(기업·매니저 접근 코드) 확인 후 'NEW' 로 되돌림 (CartRejectModal)
//   열 때마다 새로 조회한다 (/api/ft/new-orders). 바깥 클릭 / Esc 로 닫힘.
//   반려 모달은 패널 바깥(같은 wrapRef 안)에 띄워 패널의 stacking context 에 갇히지 않게 한다.
// ============================================================

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; rows: NewOrderUserSummary[] };

// ── 표시 형식 ──
const fmtCount = (n: number) => n.toLocaleString('ko-KR');
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const NewOrderStatusButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const wrapRef = useRef<HTMLDivElement>(null);

  // ── 반려 대상 카트 (null = 모달 닫힘) · 직전 반려 안내 ──
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ============================================================
  // 조회
  // ============================================================
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch('/api/ft/new-orders', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setState({ status: 'done', rows: json.data as NewOrderUserSummary[] });
    } catch (err) {
      console.error('신규주문 상황 조회 오류:', err);
      setState({ status: 'error', message: err instanceof Error ? err.message : '조회 실패' });
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (!open) {
      setNotice(null);
      load();
    }
    setOpen(!open);
  }, [open, load]);

  // ── 반려 성공 → 안내 + 목록 재조회 (반려된 카트는 ORDER 가 아니므로 사라진다) ──
  const handleRejected = useCallback((target: RejectTarget) => {
    setRejectTarget(null);
    setNotice(`'${target.cart_name || '(이름 없음)'}' 반려됨 — 고객 장바구니(NEW)로 되돌렸습니다.`);
    load();
  }, [load]);

  // ── 바깥 클릭 / Esc 로 닫기 (반려 모달이 열려 있으면 Esc 는 모달만 닫는다) ──
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (rejectTarget) setRejectTarget(null);
      else setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, rejectTarget]);

  // ============================================================
  // 렌더
  // ============================================================
  const rows = state.status === 'done' ? state.rows : [];
  const total = rows.reduce(
    (acc, r) => ({ carts: acc.carts + r.carts, items: acc.items + r.items, qty: acc.qty + r.qty }),
    { carts: 0, items: 0, qty: 0 }
  );

  return (
    <div className="os-v2-new-orders" ref={wrapRef}>
      <button
        type="button"
        className={`os-v2-delivery-tool-btn ${open ? 'is-active' : ''}`}
        onClick={handleToggle}
        title="고객이 주문으로 넘긴 뒤 아직 1688 주문 프로그램에서 불러오지 않은 장바구니"
      >
        신규주문 상황
      </button>

      {open && (
        <div className="os-v2-new-orders-panel" role="dialog" aria-label="신규주문 상황">
          {/* ── 헤더 ── */}
          <div className="os-v2-new-orders-head">
            <strong>신규주문 상황</strong>
            {state.status === 'done' && rows.length > 0 && (
              <span className="os-v2-new-orders-total">
                {fmtCount(total.carts)}건 · {fmtCount(total.items)}품목 · {fmtCount(total.qty)}개
              </span>
            )}
            <button
              type="button"
              className="os-v2-new-orders-refresh"
              onClick={load}
              disabled={state.status === 'loading'}
            >
              새로고침
            </button>
          </div>

          {/* ── 본문 ── */}
          {notice && <div className="os-v2-new-orders-msg is-notice">{notice}</div>}
          {state.status === 'loading' && <div className="os-v2-new-orders-msg">조회 중...</div>}
          {state.status === 'error' && (
            <div className="os-v2-new-orders-msg is-error">조회 실패 — {state.message}</div>
          )}
          {state.status === 'done' && rows.length === 0 && (
            <div className="os-v2-new-orders-msg">없음</div>
          )}
          {state.status === 'done' && rows.length > 0 && (
            <ul className="os-v2-new-orders-list">
              {rows.map((r) => (
                <li key={r.user_id} className="os-v2-new-orders-user">
                  <div className="os-v2-new-orders-user-line">
                    <span className="os-v2-new-orders-name">{r.name}</span>
                    <span className="os-v2-new-orders-chip">
                      {fmtCount(r.carts)}건 · {fmtCount(r.items)}품목 · {fmtCount(r.qty)}개
                    </span>
                  </div>
                  <ul className="os-v2-new-orders-carts">
                    {r.cartList.map((c) => (
                      <li key={c.id}>
                        <span className="os-v2-new-orders-cart-name">{c.cart_name || '(이름 없음)'}</span>
                        <span className="os-v2-new-orders-cart-date">{fmtDateTime(c.created_at)}</span>
                        <span>{fmtCount(c.items)}품목 · {fmtCount(c.qty)}개</span>
                        <button
                          type="button"
                          className="os-v2-new-orders-reject"
                          onClick={() => {
                            setNotice(null);
                            setRejectTarget({ id: c.id, cart_name: c.cart_name, userName: r.name, items: c.items, qty: c.qty });
                          }}
                        >
                          반려
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── 반려 확인 모달 ── */}
      {open && rejectTarget && (
        <CartRejectModal
          target={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={handleRejected}
        />
      )}
    </div>
  );
};

export default NewOrderStatusButton;
