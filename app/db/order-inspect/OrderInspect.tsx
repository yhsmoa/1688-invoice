'use client';

import React, { useCallback, useRef, useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import { dbAccessHeaders } from '../../../component/DbAccessGate';
import './OrderInspect.css';

// ============================================================
// 주문 검사 — 1688 주문 엑셀 ↔ 상품입고 V2 매칭 검사
//
//   업로드한 엑셀의 A열(1688 주문번호)이 ft_order_items.1688_order_id 에
//   존재하는지 확인하고, 매칭되지 않는 주문만 표로 보여준다.
//
//   표 구조는 원본 엑셀과 동일하게 주문 단위 열(주문번호/판매자/결제금액/주문일시)을
//   rowspan 으로 병합하고, 주문내역(S열)만 상품 수만큼 행으로 펼친다.
// ============================================================

interface InspectItem {
  detail: string;
  detailKo: string;
}

interface InspectOrder {
  orderNo: string;
  shop: string;
  amount: string;
  orderedAt: string;
  items: InspectItem[];
}

interface Summary {
  totalOrders: number;
  matchedOrders: number;
  unmatchedOrders: number;
  totalItemRows: number;
  unmatchedItemRows: number;
}

const OrderInspect: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [orders, setOrders] = useState<InspectOrder[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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
    setTranslateError(null);

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
      setTranslateError(json.translateError ?? null);
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

            {translateError && (
              <div className="oi-warn">
                번역을 사용할 수 없어 <strong>주문내역이 원문(중국어)으로 표시</strong>됩니다. — {translateError}
              </div>
            )}

            {/* ============================================================ */}
            {/* 결과 테이블 — 엑셀과 동일한 병합(rowspan) 구조               */}
            {/* ============================================================ */}
            {orders && orders.length === 0 && (
              <div className="oi-empty">모든 주문번호가 상품입고 V2에 매칭되었습니다. 누락 없음 ✅</div>
            )}

            {orders && orders.length > 0 && (
              <div className="oi-table-wrap">
                <table className="oi-table">
                  <thead>
                    <tr>
                      <th className="oi-th">주문번호</th>
                      <th className="oi-th">판매자명</th>
                      <th className="oi-th oi-right">결제금액</th>
                      <th className="oi-th">주문일시</th>
                      <th className="oi-th">주문내역</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const rows = o.items.length > 0 ? o.items : [{ detail: '-', detailKo: '-' }];
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
                              <td className="oi-td oi-merged" rowSpan={rows.length}>{o.orderedAt || '-'}</td>
                            </>
                          )}
                          {/* 주문내역 — 상품 단위 (병합 없음) */}
                          <td className="oi-td oi-detail">
                            <div className="oi-detail-ko">{it.detailKo}</div>
                            {it.detailKo !== it.detail && (
                              <div className="oi-detail-src">{it.detail}</div>
                            )}
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default OrderInspect;
