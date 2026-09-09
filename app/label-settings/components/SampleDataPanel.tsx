'use client';

import React from 'react';
import {
  PRODUCT_FIELDS,
  ACCOUNT_FIELDS,
  SAMPLE_LABEL_DATA,
  type LabelData,
} from '../../../lib/labelTypes';

// ============================================================
// 미리보기 데이터 — 템플릿 보드(TemplateBoard)의 "미리보기 데이터" 탭 내용.
//
// 상품명·소재처럼 길이가 매번 다른 데이터는 "가장 긴 경우" 로 영역을
// 잡아야 한다. 여기서 샘플 값을 바꾸면 캔버스·경고·테스트 출력이
// 전부 이 값으로 그려진다. 계정 정보(acc_*)도 같은 방식으로 미리 볼 수 있다.
// ============================================================

interface Props {
  data: LabelData;
  onChange: (next: LabelData) => void;
}

const SampleDataPanel: React.FC<Props> = ({ data, onChange }) => {
  const set = (key: string, raw: string) => {
    const isNumber = key === 'qty';
    onChange({ ...data, [key]: isNumber ? (raw === '' ? null : Number(raw)) : raw });
  };

  const renderField = (f: { key: string; label: string }, long: boolean) => {
    const v = data[f.key];
    return (
      <label className="ls-field" key={f.key}>
        <span>{f.label}</span>
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
        미리보기 데이터
        <button className="ls-btn-ghost ls-btn-xs" onClick={() => onChange(SAMPLE_LABEL_DATA)}>
          기본값
        </button>
      </div>
      <div className="ls-hint ls-mb8">
        긴 상품명을 넣어 보고 영역 크기를 잡으세요. 테스트 출력도 이 값으로 나갑니다.
      </div>

      <div className="ls-sample-grid">
        {PRODUCT_FIELDS.map((f) =>
          renderField(f, f.key === 'item_name' || f.key === 'composition')
        )}
      </div>

      <div className="ls-sub-title">계정 정보 (미리보기용)</div>
      <div className="ls-hint ls-mb8">
        이 템플릿에 특정 사업자가 지정돼 있으면 그 사업자의 실제 값으로 자동 채워집니다.
        공용 템플릿이거나 다른 값으로 테스트하고 싶으면 여기서 직접 고치세요. 실제 인쇄는
        항상 그 자리에서 선택된 사업자의 진짜 값을 씁니다.
      </div>
      <div className="ls-sample-grid">
        {ACCOUNT_FIELDS.map((f) => renderField(f, f.key === 'acc_address'))}
      </div>
    </>
  );
};

export default SampleDataPanel;
