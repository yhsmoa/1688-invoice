'use client';

import React from 'react';
import {
  LABEL_MEDIA,
  LABEL_CUTTER,
  type LabelCutter,
  type LabelMedia,
  type LabelTemplate,
  type LabelType,
} from '../../../lib/labelTypes';
import { userLabel, type FtUser } from '../hooks/useLabelSettingsData';
import { LABEL_TYPES } from './TemplateListPanel';

// ============================================================
// 기본 정보 — 이름 · 종류 · 사용자 · 용지 규격 (좌측 컬럼)
//
// DPI 는 "프린터가 실제로 찍는 해상도" 라서 바꾸면 모든 요소의
// 실제 크기가 달라진다. 그래서 목록에도 항상 같이 표기한다.
// ============================================================

const DPI_OPTIONS = [
  { value: 203, label: '203 dpi' },
  { value: 300, label: '300 dpi' },
  { value: 600, label: '600 dpi' },
];

interface Props {
  draft: LabelTemplate;
  users: FtUser[];
  onPatch: (patch: Partial<LabelTemplate>, key?: string) => void;
  /** 테스트 자리에 매핑된 이 종류의 프린터 (없으면 null) */
  mappedPrinter: { station: number; name: string | null; dpi?: number };
}

const TemplateInfoPanel: React.FC<Props> = ({ draft, users, onPatch, mappedPrinter }) => (
  <section className="ls-panel">
    <div className="ls-panel-title">기본 정보</div>

    <div className="ls-grid-2">
      <label className="ls-field ls-col-2">
        <span>이름</span>
        <input
          value={draft.name}
          onChange={(e) => onPatch({ name: e.target.value }, 'tpl:name')}
          placeholder="예) 여성 상의 케어라벨"
        />
      </label>

      <label className="ls-field">
        <span>종류</span>
        <select
          value={draft.label_type}
          onChange={(e) => onPatch({ label_type: e.target.value as LabelType })}
        >
          {LABEL_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ls-field">
        <span>사용자</span>
        <select
          value={draft.user_id ?? ''}
          onChange={(e) => onPatch({ user_id: e.target.value || null })}
        >
          <option value="">공용 (모든 사용자)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {userLabel(u)}
            </option>
          ))}
        </select>
      </label>

      <label className="ls-field">
        <span>가로 (mm)</span>
        <input
          type="number"
          step="0.5"
          min={5}
          value={draft.width_mm}
          onChange={(e) => onPatch({ width_mm: Number(e.target.value) }, 'tpl:w')}
        />
      </label>

      <label className="ls-field">
        <span>세로 (mm)</span>
        <input
          type="number"
          step="0.5"
          min={5}
          value={draft.height_mm}
          onChange={(e) => onPatch({ height_mm: Number(e.target.value) }, 'tpl:h')}
        />
      </label>

      <label className="ls-field ls-col-2">
        <span>용지 종류</span>
        <select
          value={draft.media ?? 'gap'}
          onChange={(e) => onPatch({ media: e.target.value as LabelMedia })}
        >
          {LABEL_MEDIA.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <div className="ls-hint ls-col-2">
        {LABEL_MEDIA.find((m) => m.key === (draft.media ?? 'gap'))?.hint}
      </div>

      {(draft.media ?? 'gap') !== 'continuous' && (
        <label className="ls-field">
          <span>{draft.media === 'blackmark' ? '블랙마크 높이 (mm)' : '라벨 간격 GAP (mm)'}</span>
          <input
            type="number"
            step="0.5"
            min={0}
            value={draft.gap_mm}
            onChange={(e) => onPatch({ gap_mm: Number(e.target.value) }, 'tpl:gap')}
          />
        </label>
      )}

      <label className="ls-field">
        <span>해상도 (프린터 사양)</span>
        <select value={draft.dpi} onChange={(e) => onPatch({ dpi: Number(e.target.value) })}>
          {DPI_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      {/* 해상도는 프린터를 고르는 값이 아니다 — 프린터는 아래 매핑에서, 여기는 그 프린터의 dpi */}
      <div
        className={`ls-hint ls-col-2 ${
          mappedPrinter.dpi && mappedPrinter.dpi !== draft.dpi ? 'ls-hint-warn' : ''
        }`}
      >
        {mappedPrinter.name ? (
          <>
            {mappedPrinter.station}번 자리 {draft.label_type === 'care' ? '케어라벨' : '바코드'}{' '}
            프린터: <b>{mappedPrinter.name}</b>
            {mappedPrinter.dpi ? ` (${mappedPrinter.dpi}dpi)` : ''}
            {mappedPrinter.dpi && mappedPrinter.dpi !== draft.dpi
              ? ` — 템플릿은 ${draft.dpi}dpi 라서 실제 크기가 달라집니다. 해상도를 ${mappedPrinter.dpi}로 맞추세요.`
              : ''}
          </>
        ) : (
          <>
            해상도는 프린터를 고르는 값이 아닙니다. 프린터는 아래 <b>프린터 매핑</b>에서 자리별로
            정하고, 여기에는 그 프린터의 사양 dpi 를 넣습니다.
          </>
        )}
      </div>

      <label className="ls-field ls-check ls-col-2">
        <input
          type="checkbox"
          checked={draft.is_default}
          onChange={(e) => onPatch({ is_default: e.target.checked })}
        />
        <span>이 사용자·종류의 기본 템플릿으로 사용</span>
      </label>
    </div>

    {/* ── 프린터 설정 (농도·속도) ── */}
    <div className="ls-sub-title">프린터 설정</div>
    <div className="ls-hint ls-mb8">
      RAW 인쇄는 Windows의 "인쇄 기본 설정" 창(농도·속도)을 거치지 않습니다. 여기 값이 매 라벨과
      함께 프린터로 전송됩니다. 비우면 프린터 기본값.
    </div>
    <div className="ls-grid-2">
      <label className="ls-field">
        <span>인쇄 농도 (0~15)</span>
        <input
          type="number"
          min={0}
          max={15}
          step={1}
          placeholder="기본값"
          value={draft.density ?? ''}
          onChange={(e) =>
            onPatch({ density: e.target.value === '' ? null : Number(e.target.value) }, 'tpl:density')
          }
        />
      </label>
      <label className="ls-field">
        <span>속도 (inch/s)</span>
        <input
          type="number"
          min={1}
          max={12}
          step={1}
          placeholder="기본값"
          value={draft.speed ?? ''}
          onChange={(e) =>
            onPatch({ speed: e.target.value === '' ? null : Number(e.target.value) }, 'tpl:speed')
          }
        />
      </label>
      <div className="ls-hint ls-col-2">
        글씨가 흐리면 농도를 올리고(보통 8~12), 번지면 내리세요. 속도는 낮을수록 선명합니다.
      </div>
      <label className="ls-field ls-col-2">
        <span>자동 절단 (절단기 달린 프린터)</span>
        <select
          value={draft.cutter ?? 'off'}
          onChange={(e) => onPatch({ cutter: e.target.value as LabelCutter })}
        >
          {LABEL_CUTTER.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  </section>
);

export default TemplateInfoPanel;
