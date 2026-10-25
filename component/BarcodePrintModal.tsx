'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem, FtUser } from '../app/import-product-v2/hooks/useFtData';
import { useLabelTemplatePlan } from '../app/import-product-v2/hooks/useLabelTemplatePlan';
import LabelTemplatePicker from '../app/import-product-v2/components/LabelTemplatePicker';
import { printLabels } from '../app/import-product-v2/utils/printLabels';
import './BarcodePrintModal.css';

// ============================================================
// [BARCODE] 바코드 자동 출력 모달 — 탑메뉴에서 어느 페이지에서나 연다
//
// 흐름:  스캔(QR/바코드/아이템번호 + Enter) → /api/ft/order-items/lookup 조회
//        → 행별 수량 입력 → [출력] (수량 칸 Enter 도 동일) → printLabels (라벨 스티커)
//        → "N장 전송됨" → 결과 비우고 스캔 입력칸으로 포커스 복귀
//
// 출력 경로는 입고 화면과 같다 (printLabels · useLabelTemplatePlan · LabelTemplatePicker):
//   세트 병합, 성인/키즈 템플릿 자동 선택, 이 PC 의 프린터, label_print_logs 기록.
//   PC-NO 선택이 없으므로 기록의 station_no 는 NULL.
//
// 안전장치:
//   · 수량 칸에 스캐너가 쏜 값(숫자 4자리 이상·문자 포함)이 들어오면 수량이 아니라
//     **새 스캔**으로 처리한다 — 바코드가 수량으로 들어가 수백 장 찍히는 사고 방지
//   · 수량은 1~MAX_QTY 만 허용
//   · 조회·출력 중에는 Enter 를 무시 (스캐너 이중 입력)
//   · 결과에 사업자가 여럿이면(바코드 충돌) 사업자를 골라야 출력된다 — 템플릿·계정 바인딩이
//     사업자 단위이기 때문
// ============================================================

/** 한 번에 찍을 수 있는 최대 장수 — 오입력 대량 출력 방지 */
const MAX_QTY = 999;
/** 수량으로 인정하는 입력 (1~3자리 숫자) */
const QTY_RE = /^\d{1,3}$/;
/**
 * 스캐너가 쏜 값으로 보는 입력 — 문자가 섞였거나 7자리 이상
 *   (바코드 S0033…=14자리, EAN=13자리, 상품번호 BZ-…=문자 포함). 4~6자리 숫자는 사람이
 *   잘못 친 수량으로 보고 범위 오류를 안내한다.
 */
const isScanLike = (raw: string) => /[^0-9]/.test(raw) || raw.length >= 7;
/** 출력 성공 표시 유지 시간 */
const PRINTED_MSG_MS = 4000;
/** 이번 세션 출력 기록 줄 수 */
const HISTORY_MAX = 5;

type MatchedBy = 'product_no' | 'item_no' | 'barcode';

interface LookupResult {
  code: string;
  matchedBy: MatchedBy | null;
  totalMatched: number;
  truncated: boolean;
  rows: FtOrderItem[];
  users: Record<string, FtUser>;
}

interface HistoryEntry {
  time: string;
  label: string;
  sheets: number;
}

interface BarcodePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BarcodePrintModal: React.FC<BarcodePrintModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  // ── 입력·조회 상태 ──
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'idle' | 'lookup' | 'print'>('idle');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [printedMsg, setPrintedMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const firstQtyRef = useRef<HTMLInputElement>(null);

  // ── 결과 중 선택한 사업자의 행만 (사업자가 하나면 전부) ──
  const userIds = useMemo(() => {
    if (!result) return [] as string[];
    return Array.from(new Set(result.rows.map((r) => r.user_id).filter((v): v is string => !!v)));
  }, [result]);

  const visibleRows = useMemo(
    () => (result ? result.rows.filter((r) => r.user_id === selectedUserId) : []),
    [result, selectedUserId]
  );
  const selectedUser: FtUser | null = result && selectedUserId ? result.users[selectedUserId] ?? null : null;

  // ── 템플릿 선택 — 보이는 행의 권장연령으로 성인/키즈 판정 ──
  const plan = useLabelTemplatePlan({
    active: isOpen && visibleRows.length > 0,
    userId: selectedUserId,
    items: visibleRows,
  });
  const templateMissing = plan.missingOf('barcode').length > 0;

  // ── 열릴 때 초기화 + 스캔 입력 포커스 / Esc 닫기 ──
  useEffect(() => {
    if (!isOpen) return;
    setCode('');
    setResult(null);
    setError(null);
    setQty({});
    setSelectedUserId(null);
    setPrintedMsg(null);
    setBusy('idle');
    const timer = setTimeout(() => scanInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && busy === 'idle') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onClose]);

  // ── 조회 결과가 오면 첫 수량 칸으로 포커스 ──
  useEffect(() => {
    if (!result || visibleRows.length === 0) return;
    const timer = setTimeout(() => firstQtyRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [result, visibleRows.length]);

  useEffect(() => {
    if (!printedMsg) return;
    const timer = setTimeout(() => setPrintedMsg(null), PRINTED_MSG_MS);
    return () => clearTimeout(timer);
  }, [printedMsg]);

  // ============================================================
  // 조회
  // ============================================================
  const lookup = useCallback(
    async (raw: string) => {
      const value = raw.replace(/\s/g, '');
      if (!value || busy !== 'idle') return;
      setBusy('lookup');
      setError(null);
      setPrintedMsg(null);
      try {
        const res = await fetch(`/api/ft/order-items/lookup?code=${encodeURIComponent(value)}`);
        const json = await res.json();
        if (!json.success) {
          setError(json.error || t('barcodePrint.lookupError'));
          setResult(null);
          return;
        }
        const data = json as LookupResult;
        if (data.rows.length === 0) {
          setError(t('barcodePrint.notFound', { code: value }));
          setResult(null);
          setCode('');
          return;
        }
        const ids = Array.from(new Set(data.rows.map((r) => r.user_id).filter((v): v is string => !!v)));
        setResult(data);
        setSelectedUserId(ids[0] ?? null);
        // 결과가 1줄이면 수량 1 로 바로 출력할 수 있게, 여럿이면 비워 두고 고르게 한다
        setQty(data.rows.length === 1 ? { [data.rows[0].id]: '1' } : {});
        setCode('');
      } catch (err) {
        console.error('바코드 조회 오류:', err);
        setError(t('barcodePrint.lookupError'));
        setResult(null);
      } finally {
        setBusy('idle');
      }
    },
    [busy, t]
  );

  // ============================================================
  // 출력
  // ============================================================
  const resetAfterPrint = useCallback(() => {
    setResult(null);
    setQty({});
    setSelectedUserId(null);
    setCode('');
    setTimeout(() => scanInputRef.current?.focus(), 50);
  }, []);

  const handlePrint = useCallback(async () => {
    if (!result || !selectedUser || busy !== 'idle') return;

    // 수량 검증 — 1~MAX_QTY 인 행만, 그 외 값은 오류
    const items: { item: FtOrderItem; qty: number }[] = [];
    for (const row of visibleRows) {
      const raw = (qty[row.id] ?? '').trim();
      if (raw === '' || raw === '0') continue;
      if (!QTY_RE.test(raw)) {
        setError(t('barcodePrint.invalidQty', { max: MAX_QTY }));
        return;
      }
      const n = parseInt(raw, 10);
      if (n < 1 || n > MAX_QTY) {
        setError(t('barcodePrint.invalidQty', { max: MAX_QTY }));
        return;
      }
      items.push({ item: row, qty: n });
    }
    if (items.length === 0) {
      setError(t('barcodePrint.noQty'));
      return;
    }

    setBusy('print');
    setError(null);
    try {
      const printed = await printLabels({
        items,
        selectedUser,
        brand: selectedUser.brand ?? null,
        stationNo: null,
        labelType: 'barcode',
        templates: plan.selectedOf('barcode'),
        printedBy: null,
      });
      if (!printed.success) {
        setError(printed.error || t('barcodePrint.printError'));
        return;
      }
      const label = items
        .map(({ item, qty: n }) => `${[item.item_name, item.option_name].filter(Boolean).join(', ') || item.item_no || '-'} ×${n}`)
        .join(' / ');
      setHistory((prev) => [
        { time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), label, sheets: printed.printed },
        ...prev,
      ].slice(0, HISTORY_MAX));
      setPrintedMsg(t('barcodePrint.printed', { count: printed.printed }));
      resetAfterPrint();
    } catch (err) {
      console.error('바코드 출력 오류:', err);
      setError(t('barcodePrint.printError'));
    } finally {
      setBusy('idle');
    }
  }, [result, selectedUser, busy, visibleRows, qty, plan, t, resetAfterPrint]);

  // ── 수량 칸 Enter: 스캐너 값이면 새 조회, 아니면 출력 (수량 검증은 handlePrint) ──
  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowId: string) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = (qty[rowId] ?? '').trim();
    if (raw && isScanLike(raw)) {
      setQty((prev) => ({ ...prev, [rowId]: '' }));
      void lookup(raw);
      return;
    }
    void handlePrint();
  };

  if (!isOpen) return null;

  const matchedByLabel = result?.matchedBy ? t(`barcodePrint.matchedBy.${result.matchedBy}`) : '';

  return (
    <div className="bpm-overlay" onClick={() => busy === 'idle' && onClose()}>
      <div className="bpm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('barcodePrint.title')}>

        {/* ── 헤더 ── */}
        <div className="bpm-header">
          <div>
            <h2 className="bpm-title">{t('barcodePrint.title')}</h2>
            <p className="bpm-hint">{t('barcodePrint.hint')}</p>
          </div>
          <button className="bpm-close" onClick={onClose} disabled={busy !== 'idle'} aria-label={t('barcodePrint.close')}>×</button>
        </div>

        {/* ── 스캔 입력 ── */}
        <div className="bpm-scan-row">
          <span className="bpm-scan-icon" aria-hidden>▣</span>
          <input
            ref={scanInputRef}
            className="bpm-scan-input"
            type="text"
            value={code}
            placeholder={t('barcodePrint.scanPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            disabled={busy === 'print'}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void lookup(code);
              }
            }}
          />
          {busy === 'lookup' && <span className="bpm-scan-status">{t('barcodePrint.lookingUp')}</span>}
        </div>

        {/* ── 메시지 ── */}
        {error && <div className="bpm-msg bpm-msg-error">{error}</div>}
        {printedMsg && <div className="bpm-msg bpm-msg-ok">✓ {printedMsg}</div>}

        {/* ── 결과 ── */}
        {result && (
          <div className="bpm-result">
            <div className="bpm-result-head">
              <span className="bpm-result-code">{result.code}</span>
              <span className="bpm-result-meta">
                {matchedByLabel} · {t('barcodePrint.resultCount', { count: result.rows.length })}
                {result.totalMatched > result.rows.length && ` (${t('barcodePrint.totalMatched', { count: result.totalMatched })})`}
              </span>
            </div>
            {result.truncated && (
              <div className="bpm-msg bpm-msg-warn">{t('barcodePrint.truncated', { count: result.rows.length })}</div>
            )}

            {/* 사업자가 여럿이면 선택 */}
            {userIds.length > 1 && (
              <div className="bpm-users">
                <span className="bpm-users-label">{t('barcodePrint.pickUser')}</span>
                {userIds.map((id) => {
                  const u = result.users[id];
                  const n = result.rows.filter((r) => r.user_id === id).length;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`bpm-user-chip${id === selectedUserId ? ' is-active' : ''}`}
                      onClick={() => { setSelectedUserId(id); setQty({}); }}
                    >
                      {u ? `${u.vender_name || u.full_name || u.username || ''} ${u.user_code || ''}`.trim() : id.slice(0, 8)}
                      <span className="bpm-user-count">{n}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 행 목록 */}
            <div className="bpm-rows">
              {visibleRows.map((row, idx) => {
                const u = row.user_id ? result.users[row.user_id] : null;
                const isSet = (row.set_total ?? 0) > 1;
                return (
                  <div key={row.id} className="bpm-row">
                    <div className="bpm-row-img">
                      {row.img_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/image-proxy?url=${encodeURIComponent(row.img_url)}`} alt="" />
                      ) : (
                        <span className="bpm-row-noimg">—</span>
                      )}
                    </div>
                    <div className="bpm-row-body">
                      <div className="bpm-row-name">
                        {row.item_name || '-'}
                        {row.option_name && <span className="bpm-row-option">{row.option_name}</span>}
                      </div>
                      <div className="bpm-row-tags">
                        {row.item_no && <span className="bpm-tag bpm-tag-item">{row.item_no}</span>}
                        {row.barcode && <span className="bpm-tag bpm-tag-barcode">{row.barcode}</span>}
                        {isSet && <span className="bpm-tag bpm-tag-set">{t('barcodePrint.set', { count: row.set_total ?? 0 })}</span>}
                        {u && <span className="bpm-tag bpm-tag-user">{u.vender_name || u.full_name} {u.user_code}</span>}
                        {row.recommanded_age && <span className="bpm-tag bpm-tag-kids">KIDS</span>}
                      </div>
                    </div>
                    <div className="bpm-row-qty">
                      <label className="bpm-qty-label" htmlFor={`bpm-qty-${row.id}`}>{t('barcodePrint.qty')}</label>
                      <input
                        id={`bpm-qty-${row.id}`}
                        ref={idx === 0 ? firstQtyRef : undefined}
                        className="bpm-qty-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={qty[row.id] ?? ''}
                        placeholder="0"
                        disabled={busy !== 'idle'}
                        onChange={(e) => setQty((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => handleQtyKeyDown(e, row.id)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 템플릿 (라벨 스티커) */}
            <div className="bpm-template">
              <LabelTemplatePicker
                plan={plan}
                labelType="barcode"
                title={t('importProduct.processReady.labelSticker')}
                disabled={busy !== 'idle'}
              />
            </div>

            <div className="bpm-actions">
              <button
                className="bpm-print-btn"
                onClick={() => void handlePrint()}
                disabled={busy !== 'idle' || plan.loading || templateMissing || !selectedUser}
                title={templateMissing ? t('barcodePrint.templateMissing') : ''}
              >
                {busy === 'print' ? t('barcodePrint.printing') : t('barcodePrint.print')}
              </button>
            </div>
          </div>
        )}

        {/* ── 이번 세션 출력 기록 ── */}
        {history.length > 0 && (
          <div className="bpm-history">
            <div className="bpm-history-title">{t('barcodePrint.history')}</div>
            <ul>
              {history.map((h, i) => (
                <li key={`${h.time}-${i}`}>
                  <span className="bpm-history-time">{h.time}</span>
                  <span className="bpm-history-label" title={h.label}>{h.label}</span>
                  <span className="bpm-history-sheets">{t('barcodePrint.printed', { count: h.sheets })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default BarcodePrintModal;
