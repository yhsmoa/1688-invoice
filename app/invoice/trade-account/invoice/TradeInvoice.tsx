'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import TopsideMenu from '../../../../component/TopsideMenu';
import LeftsideMenu from '../../../../component/LeftsideMenu';
import { INVOICE_AMOUNT_MAX, fmtInvoiceDate, isValidInvoiceAmount, makeInvoiceNo, type InvoiceInput } from '../../../../lib/tradeInvoice';
import InvoicePreview from './components/InvoicePreview';
import {
  downloadInvoiceExcel, downloadInvoiceJpg, downloadInvoicePdf, fetchStampObjectUrl, type InvoiceExportKind,
} from './utils/exportInvoice';
import './TradeInvoice.css';

// ============================================================
// 무역계좌 > invoice — PROFORMA INVOICE 생성
//   상단: 금액 입력 + [excel] [jpg] [pdf] [EXCEL2] (금액이 있어야 활성)
//   가운데: 엑셀 인쇄 영역(A1:N48) 미리보기 — JPG/PDF 는 이 화면을 그대로 저장
//   번호 NO : JYT+YYYYMMDD 와 작성일은 저장 시점의 로컬 날짜
//   excel  = 원본 템플릿에 값만 넣은 파일, EXCEL2 = 병합·글꼴을 정리한 개정본
// ============================================================

const EXPORT_LABEL: Record<InvoiceExportKind, string> = { excel: 'excel', jpg: 'jpg', pdf: 'pdf', excel2: 'EXCEL2' };
const EXPORT_ORDER: InvoiceExportKind[] = ['excel', 'jpg', 'pdf', 'excel2'];

/** 브라우저 로컬 날짜 YYYY-MM-DD (서버 UTC 와 무관) */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TradeInvoice: React.FC = () => {
  const [amountText, setAmountText] = useState('');
  // 날짜는 마운트 후 설정 (SSR 과 클라이언트 날짜가 달라 hydration 이 어긋나는 것을 피함)
  const [date, setDate] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<InvoiceExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDate(localToday()); }, []);

  // ── 도장 이미지 (접근 코드 헤더 필요 → object URL) ──
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    fetchStampObjectUrl()
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        url = u;
        setStampUrl(u);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '도장 이미지를 불러오지 못했습니다.'); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const amount = amountText ? Number(amountText) : 0;
  const canExport = isValidInvoiceAmount(amount) && !!date && !!stampUrl && !busy;

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
    if (digits && Number(digits) > INVOICE_AMOUNT_MAX) return;
    setAmountText(digits);
    setError(null);
  };

  // ── 저장 — 날짜는 클릭 시점으로 확정 (자정을 넘긴 탭도 그날 번호로) ──
  const handleExport = useCallback(async (kind: InvoiceExportKind) => {
    if (!isValidInvoiceAmount(amount) || busy) return;
    const today = localToday();
    if (today !== date) flushSync(() => setDate(today)); // 미리보기 DOM 을 먼저 갱신한 뒤 캡처
    const input: InvoiceInput = { amount, date: today };

    setBusy(kind);
    setError(null);
    try {
      const sheet = sheetRef.current;
      switch (kind) {
        case 'excel': await downloadInvoiceExcel(input, 'template'); break;
        case 'excel2': await downloadInvoiceExcel(input, 'v2'); break;
        case 'jpg':
          if (!sheet) throw new Error('미리보기가 준비되지 않았습니다.');
          await downloadInvoiceJpg(sheet, input);
          break;
        case 'pdf':
          if (!sheet) throw new Error('미리보기가 준비되지 않았습니다.');
          await downloadInvoicePdf(sheet, input);
          break;
      }
    } catch (e) {
      console.error('인보이스 저장 오류:', e);
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setBusy(null);
    }
  }, [amount, busy, date]);

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="ti-main">
          {/* ── 헤더 ── */}
          <div className="ti-page-header">
            <div className="ti-title-group">
              <h1 className="ti-page-title">Invoice</h1>
              <span className="ti-page-sub">PROFORMA INVOICE — LINYI JIEYUN TONG</span>
            </div>
          </div>

          {/* ── 입력 폼 + 저장 버튼 ── */}
          <div className="ti-toolbar">
            <div className="ti-form">
              <label className="ti-field">
                <span className="ti-field-label">금액 (US$)</span>
                <input
                  className="ti-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="30000"
                  value={amountText ? Number(amountText).toLocaleString('en-US') : ''}
                  onChange={handleAmountChange}
                  autoFocus
                />
              </label>
              <div className="ti-meta">
                <span>{date ? makeInvoiceNo(date) : '—'}</span>
                <span className="ti-meta-sep">·</span>
                <span>{date ? fmtInvoiceDate(date) : '—'}</span>
              </div>
            </div>
            <div className="ti-actions">
              {EXPORT_ORDER.map((kind) => (
                <button
                  key={kind}
                  className={`ti-btn ${kind === 'excel2' ? 'ti-btn--alt' : ''}`}
                  disabled={!canExport}
                  onClick={() => handleExport(kind)}
                >
                  {busy === kind ? '저장 중...' : `[${EXPORT_LABEL[kind]}]`}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="ti-alert ti-alert--error">{error}</div>}

          {/* ── 미리보기 (A1:N48) ── */}
          <div className="ti-preview-wrap">
            {date ? (
              <InvoicePreview ref={sheetRef} input={{ amount, date }} stampUrl={stampUrl} />
            ) : (
              <div className="ti-preview-loading">미리보기 준비 중...</div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default TradeInvoice;
