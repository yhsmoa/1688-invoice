'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ACCOUNT_FIELDS, BOX_FIELDS, SAMPLE_BOX_LABEL_DATA, type LabelData } from '../../../lib/labelTypes';

// ============================================================
// 미리보기 데이터 (박스 라벨) — 템플릿 보드(TemplateBoard)의 "미리보기 데이터" 탭 내용.
//
//   박스 라벨(label_type = 'box')은 주문 행이 아니라 박스 하나의 값을 찍는다
//   (와우출고 [라벨출력] — app/storage/utils/printWowBoxLabels.ts 가 같은 필드를 채운다).
//   그래서 주문 검색 없이 값만 직접 고친다. 여기 값으로 캔버스 · 경고 · 테스트 출력이 그려진다.
//   상품 라벨(바코드 · 케어)은 SampleDataPanel 이 맡는다.
// ============================================================

interface Props {
  data: LabelData;
  onChange: (next: LabelData) => void;
}

/** 숫자로 다루는 필드 */
const NUMBER_FIELDS = new Set(['po_box_count', 'bx_no', 'bx_qty', 'bx_item_count']);

const BoxSampleDataPanel: React.FC<Props> = ({ data, onChange }) => {
  const { t } = useTranslation();

  const set = (key: string, raw: string) => {
    onChange({ ...data, [key]: NUMBER_FIELDS.has(key) ? (raw === '' ? null : Number(raw)) : raw });
  };

  // 계정 정보는 그대로 두고 박스 값만 기본값으로 되돌린다
  const resetToDefault = () => {
    const box = Object.fromEntries(BOX_FIELDS.map((f) => [f.key, SAMPLE_BOX_LABEL_DATA[f.key]]));
    onChange({ ...data, ...box });
  };

  const renderField = (f: { key: string; label: string }) => {
    const v = data[f.key];
    return (
      <label className="ls-field" key={f.key}>
        <span>{t(`labelSettings.fields.${f.key}`, { defaultValue: f.label })}</span>
        <input
          type={NUMBER_FIELDS.has(f.key) ? 'number' : 'text'}
          value={v == null ? '' : String(v)}
          onChange={(e) => set(f.key, e.target.value)}
        />
      </label>
    );
  };

  return (
    <>
      <div className="ls-hint ls-mb8">{t('labelSettings.sample.boxHint')}</div>
      <button type="button" className="ls-btn-sm ls-mb8" onClick={resetToDefault}>
        {t('labelSettings.sample.reset')}
      </button>

      {/* ── 박스 값 ── */}
      <div className="ls-sample-grid">{BOX_FIELDS.map(renderField)}</div>

      {/* ── 계정 정보 ── */}
      <div className="ls-sub-title">{t('labelSettings.sample.accountTitle')}</div>
      <div className="ls-hint ls-mb8">{t('labelSettings.sample.accountHint')}</div>
      <div className="ls-sample-grid">{ACCOUNT_FIELDS.map(renderField)}</div>
    </>
  );
};

export default BoxSampleDataPanel;
