'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PRODUCT_FIELDS,
  ACCOUNT_FIELDS,
  SAMPLE_LABEL_DATA,
  type LabelData,
} from '../../../lib/labelTypes';
import type { FtOrderItem, FtUser } from '../../import-product-v2/hooks/useFtData';
import { toLabelData } from '../../import-product-v2/utils/printLabels';

// ============================================================
// 미리보기 데이터 — 템플릿 보드(TemplateBoard)의 "미리보기 데이터" 탭 내용.
//
//   ① 주문 검색 → 대입 (기본 사용 방법)
//      아이템번호 · 상품번호(QR) · 바코드로 찾아 고르면 그 주문 행이 미리보기 값이 된다.
//      값은 실제 인쇄와 같은 함수(printLabels.toLabelData)로 만든다 → 상품명+옵션 합침,
//      사이즈코드, 그 주문 사업자의 계정 정보(acc_*)까지 인쇄 결과와 같다.
//      조회는 탑메뉴 [BARCODE] 와 같은 API (/api/ft/order-items/lookup — 정확 일치).
//   ② 직접 수정 (접힘) — 긴 상품명으로 영역을 잡아 볼 때 등 값을 손으로 고친다.
//
//   여기 값으로 캔버스·경고·테스트 출력이 전부 그려진다.
//   필드 이름은 labelSettings.fields.* 로 번역한다.
// ============================================================

interface Props {
  data: LabelData;
  onChange: (next: LabelData) => void;
}

/** /api/ft/order-items/lookup 응답 */
interface LookupResponse {
  success: boolean;
  error?: string;
  rows: FtOrderItem[];
  users: Record<string, FtUser>;
  truncated: boolean;
}

/** 지금 미리보기에 대입된 주문 (화면 표시용) */
interface AppliedOrder {
  itemNo: string;
  team: string;
}

const CODE_RE = /^[A-Za-z0-9_.\-]{1,64}$/;

const SampleDataPanel: React.FC<Props> = ({ data, onChange }) => {
  const { t } = useTranslation();

  // ============================================================
  // ① 주문 검색 → 대입
  // ============================================================
  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<AppliedOrder | null>(null);
  const seqRef = useRef(0);

  const search = useCallback(async () => {
    const q = code.trim();
    if (!q) return;
    if (!CODE_RE.test(q)) {
      setError(t('labelSettings.sample.searchInvalid'));
      setResult(null);
      return;
    }
    const seq = ++seqRef.current;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/ft/order-items/lookup?code=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const json = (await res.json()) as LookupResponse;
      if (seq !== seqRef.current) return;
      if (!res.ok || !json.success) throw new Error(json.error || t('labelSettings.sample.searchError'));
      setResult(json);
      if (json.rows.length === 0) setError(t('labelSettings.sample.searchNotFound', { code: q }));
    } catch (e) {
      if (seq !== seqRef.current) return;
      console.error('미리보기 주문 검색 오류:', e);
      setResult(null);
      setError(e instanceof Error ? e.message : t('labelSettings.sample.searchError'));
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }, [code, t]);

  const apply = useCallback(
    (row: FtOrderItem) => {
      const user = (row.user_id && result?.users[row.user_id]) || null;
      // 수량은 그 주문의 주문수량 (없으면 1) — 수량 요소가 있는 템플릿에서 실제처럼 보이게
      const qty = row.order_qty && row.order_qty > 0 ? row.order_qty : 1;
      onChange(toLabelData(row, qty, user?.brand ?? null, user));
      setApplied({ itemNo: row.item_no || row.product_no || row.barcode || '', team: user?.user_code || '' });
    },
    [onChange, result]
  );

  const resetToDefault = useCallback(() => {
    onChange(SAMPLE_LABEL_DATA);
    setApplied(null);
  }, [onChange]);

  // ============================================================
  // ② 직접 수정
  // ============================================================
  const set = (key: string, raw: string) => {
    const isNumber = key === 'qty';
    onChange({ ...data, [key]: isNumber ? (raw === '' ? null : Number(raw)) : raw });
  };

  const renderField = (f: { key: string; label: string }, long: boolean) => {
    const v = data[f.key];
    return (
      <label className="ls-field" key={f.key}>
        <span>{t(`labelSettings.fields.${f.key}`, { defaultValue: f.label })}</span>
        {long ? (
          <textarea
            rows={2}
            value={v == null ? '' : String(v)}
            onChange={(e) => set(f.key, e.target.value)}
          />
        ) : (
          <input
            type={f.key === 'qty' ? 'number' : 'text'}
            value={v == null ? '' : String(v)}
            onChange={(e) => set(f.key, e.target.value)}
          />
        )}
      </label>
    );
  };

  return (
    <>
      <div className="ls-panel-inline-title">
        {t('labelSettings.sample.title')}
        <button className="ls-btn-ghost ls-btn-xs" onClick={resetToDefault}>
          {t('labelSettings.sample.reset')}
        </button>
      </div>

      {/* ── ① 주문 검색 ── */}
      <div className="ls-hint ls-mb8">{t('labelSettings.sample.searchHint')}</div>
      <div className="ls-sample-search">
        <input
          type="text"
          value={code}
          placeholder={t('labelSettings.sample.searchPlaceholder')}
          aria-label={t('labelSettings.sample.searchPlaceholder')}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
        />
        <button className="ls-btn-primary ls-btn-xs" onClick={search} disabled={searching || !code.trim()}>
          {searching ? t('labelSettings.sample.searching') : t('labelSettings.sample.search')}
        </button>
      </div>

      {applied && (
        <div className="ls-sample-applied">
          {t('labelSettings.sample.applied', { itemNo: applied.itemNo, team: applied.team || '-' })}
        </div>
      )}
      {error && <div className="ls-sample-error">{error}</div>}

      {result && result.rows.length > 0 && (
        <ul className="ls-sample-results">
          {result.rows.map((row) => {
            const user = (row.user_id && result.users[row.user_id]) || null;
            const chinaOpt = [row.china_option1, row.china_option2].filter(Boolean).join(', ');
            return (
              <li key={row.id}>
                <button type="button" className="ls-sample-result" onClick={() => apply(row)}>
                  <span className="ls-sample-thumb">
                    {row.img_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/image-proxy?url=${encodeURIComponent(row.img_url)}`} alt="" loading="lazy" />
                    ) : null}
                  </span>
                  <span className="ls-sample-result-body">
                    <span className="ls-sample-result-top">
                      {user?.user_code && <b className="ls-sample-team">{user.user_code}</b>}
                      <span className="ls-sample-itemno">{row.item_no || row.product_no || '-'}</span>
                    </span>
                    <span className="ls-sample-name">{[row.item_name, row.option_name].filter(Boolean).join(', ')}</span>
                    {chinaOpt && <span className="ls-sample-sub">{chinaOpt}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {result?.truncated && <div className="ls-hint">{t('labelSettings.sample.searchTruncated', { count: result.rows.length })}</div>}

      {/* ── ② 직접 수정 (접힘) ── */}
      <details className="ls-sample-manual">
        <summary>{t('labelSettings.sample.manualTitle')}</summary>
        <div className="ls-hint ls-mb8">{t('labelSettings.sample.hint')}</div>
        <div className="ls-sample-grid">
          {PRODUCT_FIELDS.map((f) =>
            renderField(f, f.key === 'item_name' || f.key === 'composition')
          )}
        </div>

        <div className="ls-sub-title">{t('labelSettings.sample.accountTitle')}</div>
        <div className="ls-hint ls-mb8">{t('labelSettings.sample.accountHint')}</div>
        <div className="ls-sample-grid">
          {ACCOUNT_FIELDS.map((f) => renderField(f, f.key === 'acc_address'))}
        </div>
      </details>
    </>
  );
};

export default SampleDataPanel;
