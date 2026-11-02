'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import { dbAccessHeaders } from '../../../component/DbAccessGate';
import ExpenseModal from '../../invoice/trade-account/components/ExpenseModal';
import TranslationTooltip, { TooltipState } from './components/TranslationTooltip';
import CostTargetModal, { CostOrderSummary } from './components/CostTargetModal';
import CustomerDeductModal from './components/CustomerDeductModal';
import { COST_TARGET_LABEL, type CostTarget, type InspectOrder, type Summary } from './types';
import {
  amountInputOf,
  appliedDateOf,
  customerReferenceId,
  descriptionOf,
  itemLinesOf,
  tradeReferenceId,
} from './utils/costPrefill';
// 비용처리 모달이 재사용하는 스타일 — ExpenseModal(ta-*) / 차감 폼(phv2-*)
import '../../invoice/trade-account/TradeAccount.css';
import '../../invoice/payment-history-v2/PaymentHistoryV2.css';
import './OrderInspect.css';

// ============================================================
// 주문 검사 — 1688 주문 엑셀 ↔ 상품입고 V2 매칭 검사
//
//   업로드한 엑셀의 A열(1688 주문번호)이 ft_order_items.1688_order_id 에
//   존재하는지 확인하고, 매칭되지 않는 주문만 표로 보여준다.
//
//   표 구조는 원본 엑셀과 동일하게 주문 단위 열
//   (주문번호/판매자/결제금액/주문상태/주문일시/받는 사람/구매자 메모)을
//   rowspan 으로 병합하고, 주문내역(S열)·수량(U열)만 상품 수만큼 행으로 펼친다.
//   주문상태는 거래/환불/취소 구분 색으로 표시 (라벨 사전은 API route 의 ORDER_STATUS).
//   주문내역은 원문(중국어)으로 보여주고, 마우스를 올리면 한국어 번역을 툴팁으로 띄운다.
//
// 비용처리 (주문 단위 버튼)
//   매칭되지 않은 주문 = 고객 상품입고로 잡히지 않은 구매 → 결제금액을 어디선가 차감해야 한다.
//   [비용처리] → 대상 선택(CostTargetModal)
//     · 회사 부담 → ExpenseModal (무역계좌 [회사 거래 추가] 와 같은 모달, 값만 미리 채움)
//     · 고객 부담 → CustomerDeductModal (고객계좌(신) [추가 › 차감] 과 같은 폼 + 사업자 선택)
//   참조키는 1688 주문번호로 고정(utils/costPrefill) → 같은 주문을 두 번 기록하면 서버가 차단.
//   기록된 주문은 버튼 대신 "기록됨" 배지로 표시한다.
//     · 이 화면에서 방금 기록한 건 → processed (페이지 상태)
//     · 이전에 기록한 건 → 서버가 업로드 때 두 원장을 조회해 order.recorded 로 돌려준다
//       (미매칭 주문은 다시 올리면 또 나오므로, 창을 닫았다 다시 올려도 배지가 유지된다)
// ============================================================

/** 비용처리 진행 상태 — 대상 선택 → 기록 모달 */
interface CostFlow {
  order: InspectOrder;
  step: 'choose' | CostTarget;
}

/** 결과 탭 — 거래취소(statusTone=cancel) 와 그 외(정상처리건) 로 나눈다. 두 탭의 합 = 전체 */
type ResultView = 'all' | 'normal' | 'cancel';
const RESULT_VIEW_LABEL: Record<ResultView, string> = { all: '전체', normal: '정상처리건', cancel: '거래취소' };

const OrderInspect: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [orders, setOrders] = useState<InspectOrder[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const closeTip = useCallback(() => setTip(null), []);

  // ── 비용처리 ──
  const [cost, setCost] = useState<CostFlow | null>(null);
  /** 이 화면에서 기록을 마친 주문 (주문번호 → 대상) */
  const [processed, setProcessed] = useState<Record<string, CostTarget>>({});

  const closeCost = useCallback(() => setCost(null), []);
  const markProcessed = useCallback((orderNo: string, target: CostTarget) => {
    setProcessed((prev) => ({ ...prev, [orderNo]: target }));
    setCost(null);
  }, []);

  // ── 결과 탭 — 전체 / 정상처리건 / 거래취소 (주문상태 J열 구분 기준) ──
  const [view, setView] = useState<ResultView>('all');
  const cancelledOrders = useMemo(() => (orders ?? []).filter((o) => o.statusTone === 'cancel'), [orders]);
  const normalOrders = useMemo(() => (orders ?? []).filter((o) => o.statusTone !== 'cancel'), [orders]);
  const viewOrders = view === 'cancel' ? cancelledOrders : view === 'normal' ? normalOrders : (orders ?? []);
  const viewCount: Record<ResultView, number> = {
    all: orders?.length ?? 0,
    normal: normalOrders.length,
    cancel: cancelledOrders.length,
  };

  // ── 업로드 실행 ──
  const uploadFile = useCallback(async (file: File) => {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setErrorMsg('엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.');
      return;
    }

    setFileName(file.name);
    setLoading(true);
    setErrorMsg('');
    setOrders(null);
    setSummary(null);
    setTip(null);
    setCost(null);
    setProcessed({});
    setView('all');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/db/order-inspect', {
        method: 'POST',
        headers: dbAccessHeaders(),
        body: formData,
      });
      const json = await res.json();

      if (!json.success) {
        setErrorMsg(json.error || '검사 중 오류가 발생했습니다.');
        return;
      }

      setOrders(json.orders ?? []);
      setSummary(json.summary ?? null);
    } catch (err) {
      console.error('주문 검사 오류:', err);
      setErrorMsg('업로드 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  return (
    <div className="oi-layout">
      <TopsideMenu />
      <div className="oi-main">
        <LeftsideMenu />
        <main className="oi-content">
          <div className="oi-container">
            <h1 className="oi-title">주문 검사</h1>
            <p className="oi-desc">
              1688 주문 엑셀을 올리면 <strong>상품입고 V2에 없는 주문번호</strong>만 찾아서 보여줍니다.
            </p>

            {/* ============================================================ */}
            {/* 업로드 영역                                                  */}
            {/* ============================================================ */}
            <div
              className={`oi-upload ${isDragging ? 'dragging' : ''} ${loading ? 'disabled' : ''}`}
              onClick={() => !loading && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <div className="oi-upload-icon">{loading ? '⏳' : fileName ? '✅' : '📄'}</div>
              <div className="oi-upload-text">
                {loading ? '검사 중...' : fileName || '클릭하거나 엑셀 파일을 끌어다 놓으세요'}
              </div>
              <div className="oi-upload-hint">.xlsx, .xls — A열 주문번호 기준으로 검사합니다</div>
            </div>

            {errorMsg && <div className="oi-error">{errorMsg}</div>}

            {/* ============================================================ */}
            {/* 요약                                                         */}
            {/* ============================================================ */}
            {summary && (
              <div className="oi-summary">
                <div className="oi-stat">
                  <span className="oi-stat-label">전체 주문</span>
                  <span className="oi-stat-value">{summary.totalOrders.toLocaleString()}</span>
                </div>
                <div className="oi-stat">
                  <span className="oi-stat-label">매칭됨</span>
                  <span className="oi-stat-value ok">{summary.matchedOrders.toLocaleString()}</span>
                </div>
                <div className="oi-stat">
                  <span className="oi-stat-label">매칭 안 됨</span>
                  <span className="oi-stat-value bad">{summary.unmatchedOrders.toLocaleString()}</span>
                </div>
                <div className="oi-stat">
                  <span className="oi-stat-label">미매칭 상품 행</span>
                  <span className="oi-stat-value">{summary.unmatchedItemRows.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* 결과 테이블 — 엑셀과 동일한 병합(rowspan) 구조               */}
            {/* ============================================================ */}
            {orders && orders.length === 0 && (
              <div className="oi-empty">모든 주문번호가 상품입고 V2에 매칭되었습니다. 누락 없음 ✅</div>
            )}

            {orders && orders.length > 0 && (
              <>
                {/* ── 결과 탭: 전체 / 정상처리건 / 거래취소 ── */}
                <div className="oi-tabs" role="tablist">
                  {(Object.keys(RESULT_VIEW_LABEL) as ResultView[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="tab"
                      aria-selected={view === v}
                      className={`oi-tab oi-tab--${v} ${view === v ? 'active' : ''}`}
                      onClick={() => setView(v)}
                    >
                      {RESULT_VIEW_LABEL[v]}
                      <span className="oi-tab-count">{viewCount[v].toLocaleString()}</span>
                    </button>
                  ))}
                </div>

                {viewOrders.length === 0 ? (
                  <div className="oi-empty oi-empty--muted">{RESULT_VIEW_LABEL[view]} 주문이 없습니다.</div>
                ) : (
                  <div className="oi-table-wrap">
                    <table className="oi-table">
                      <thead>
                        <tr>
                          <th className="oi-th">주문번호</th>
                          <th className="oi-th">판매자명</th>
                          <th className="oi-th oi-right">결제금액</th>
                          <th className="oi-th">주문상태</th>
                          <th className="oi-th">주문일시</th>
                          <th className="oi-th">받는 사람</th>
                          <th className="oi-th">주문내역</th>
                          <th className="oi-th oi-right">수량</th>
                          <th className="oi-th oi-center">비용처리</th>
                          <th className="oi-th">구매자 메모</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewOrders.map((o) => {
                          const rows = o.items.length > 0 ? o.items : [{ detail: '-', detailKo: '-', qty: '' }];
                          /** 기록된 부담 주체 — 방금 기록(processed) 우선, 없으면 서버 조회값(recorded). 둘 다면 배지 2개 */
                          const done: CostTarget[] = processed[o.orderNo] ? [processed[o.orderNo]] : o.recorded;
                          return rows.map((it, idx) => (
                            <tr key={`${o.orderNo}-${idx}`} className={idx === 0 ? 'oi-order-start' : ''}>
                              {/* 주문 단위 열 — 첫 행에서만 렌더 + rowspan (엑셀 병합과 동일) */}
                              {idx === 0 && (
                                <>
                                  <td className="oi-td oi-merged" rowSpan={rows.length}>
                                    <span className="oi-order-no">{o.orderNo}</span>
                                  </td>
                                  <td className="oi-td oi-merged" rowSpan={rows.length}>{o.shop || '-'}</td>
                                  <td className="oi-td oi-merged oi-right" rowSpan={rows.length}>{o.amount || '-'}</td>
                                  <td className="oi-td oi-merged" rowSpan={rows.length}>
                                    {o.status ? (
                                      <>
                                        <span className={`oi-status oi-status--${o.statusTone}`}>{o.statusKo}</span>
                                        {o.statusKo !== o.status && <div className="oi-detail-src">{o.status}</div>}
                                      </>
                                    ) : '-'}
                                  </td>
                                  <td className="oi-td oi-merged" rowSpan={rows.length}>{o.orderedAt || '-'}</td>
                                  <td className="oi-td oi-merged" rowSpan={rows.length}>{o.receiver || '-'}</td>
                                </>
                              )}
                              {/* 주문내역 — 상품 단위 (병합 없음). 원문 표시, 번역은 마우스 오버 툴팁 */}
                              {it.detailKo !== it.detail ? (
                                <td
                                  className="oi-td oi-detail oi-detail--translated"
                                  onMouseEnter={(e) => setTip({ text: it.detailKo, rect: e.currentTarget.getBoundingClientRect() })}
                                  onMouseLeave={closeTip}
                                >
                                  {it.detail}
                                </td>
                              ) : (
                                <td className="oi-td oi-detail">{it.detail}</td>
                              )}
                              {/* 수량(U열) — 상품 단위 */}
                              <td className="oi-td oi-qty">{it.qty || '-'}</td>
                              {/* 비용처리 — 주문 단위 (결제금액 기준). 기록된 건은 배지 (방금 기록 + 이전 기록) */}
                              {idx === 0 && (
                                <td className="oi-td oi-merged oi-cost-cell" rowSpan={rows.length}>
                                  {done.length > 0 ? (
                                    <span className="oi-cost-done-list">
                                      {done.map((t) => (
                                        <span key={t} className={`oi-cost-done oi-cost-done--${t}`}>{COST_TARGET_LABEL[t]} 기록됨</span>
                                      ))}
                                    </span>
                                  ) : (
                                    <button type="button" className="oi-cost-btn" onClick={() => setCost({ order: o, step: 'choose' })}>
                                      비용처리
                                    </button>
                                  )}
                                </td>
                              )}
                              {/* 구매자 메모(AD열) — 주문 단위, 마지막 열 */}
                              {idx === 0 && (
                                <td className="oi-td oi-merged oi-memo" rowSpan={rows.length}>{o.memo || '-'}</td>
                              )}
                            </tr>
                          ));
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
      <TranslationTooltip tip={tip} onClose={closeTip} />

      {/* ============================================================ */}
      {/* 비용처리 모달 — 부담 주체 선택 → 회사 부담 / 고객 부담           */}
      {/* ============================================================ */}
      {cost?.step === 'choose' && (
        <CostTargetModal
          order={cost.order}
          onPick={(target) => setCost({ order: cost.order, step: target })}
          onClose={closeCost}
        />
      )}
      {cost?.step === 'trade' && (
        <ExpenseModal
          initial={{
            date: appliedDateOf(cost.order.orderedAt),
            category: '소모품',
            amount: amountInputOf(cost.order.amount),
            description: descriptionOf(cost.order),
            note: `${cost.order.shop ? `${cost.order.shop}\n` : ''}${itemLinesOf(cost.order)}`,
            orderNo1688: cost.order.orderNo,
          }}
          referenceId={tradeReferenceId(cost.order)}
          context={<CostOrderSummary order={cost.order} />}
          closeOnOverlay={false}
          onClose={closeCost}
          onSaved={() => markProcessed(cost.order.orderNo, 'trade')}
        />
      )}
      {cost?.step === 'customer' && (
        <CustomerDeductModal
          initial={{
            date: appliedDateOf(cost.order.orderedAt),
            description: descriptionOf(cost.order),
            amount: amountInputOf(cost.order.amount),
            order1688Id: cost.order.orderNo,
            deliveryFee: '',
            serviceFee: '',
            extraFee: '',
            adminNote: itemLinesOf(cost.order),
          }}
          referenceId={customerReferenceId(cost.order)}
          context={<CostOrderSummary order={cost.order} />}
          onClose={closeCost}
          onSaved={() => markProcessed(cost.order.orderNo, 'customer')}
        />
      )}
    </div>
  );
};

export default OrderInspect;
