'use client';

import React from 'react';
import { LABEL_FIELDS, SAMPLE_LABEL_DATA, type LabelData } from '../../../lib/labelTypes';

// ============================================================
// 미리보기 데이터 (좌측 컬럼)
//
// 상품명·소재처럼 길이가 매번 다른 데이터는 "가장 긴 경우" 로 영역을
// 잡아야 한다. 여기서 샘플 값을 바꾸면 캔버스·경고·테스트 출력이
// 전부 이 값으로 그려진다.
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

  return (
    <section className="ls-panel">
      <div className="ls-panel-title">
        미리보기 데이터
        <button className="ls-btn-ghost ls-btn-xs" onClick={() => onChange(SAMPLE_LABEL_DATA)}>
          기본값
        </button>
      </div>
      <div className="ls-hint ls-mb8">
        긴 상품명을 넣어 보고 영역 크기를 잡으세요. 테스트 출력도 이 값으로 나갑니다.
      </div>

      <div className="ls-sample-grid">
        {LABEL_FIELDS.map((f) => {
          const v = data[f.key];
          const long = f.key === 'item_name' || f.key === 'composition';
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
        })}
      </div>
    </section>
  );
};

export default SampleDataPanel;
