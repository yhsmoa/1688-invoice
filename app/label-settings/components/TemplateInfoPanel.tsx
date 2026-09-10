'use client';

import React from 'react';
import {
  LABEL_MEDIA,
  LABEL_CUTTER,
  LABEL_AUDIENCES,
  isSharedTemplate,
  templateAudiences,
  type LabelAudience,
  type LabelCutter,
  type LabelMedia,
  type LabelTemplate,
  type LabelType,
} from '../../../lib/labelTypes';
import { userLabel, type FtUser } from '../hooks/useLabelSettingsData';
import { LABEL_TYPES } from './TemplateListPanel';

// ============================================================
// 기본 정보 — 템플릿 보드(TemplateBoard)의 "기본정보" 탭 내용.
//
// DPI 는 "프린터가 실제로 찍는 해상도" 라서 바꾸면 모든 요소의 실제 크기가 달라진다.
// 어떤 프린터를 쓸지는 여기가 아니라 "프린터" 탭(템플릿별 · 이 PC 로컬)에서 정한다.
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
}

const TemplateInfoPanel: React.FC<Props> = ({ draft, users, onPatch }) => {
  const shared = isSharedTemplate(draft);

  const toggleUser = (uid: string) => {
    const cur = draft.user_ids ?? [];
    const next = cur.includes(uid) ? cur.filter((id) => id !== uid) : [...cur, uid];
    onPatch({ user_ids: next.length > 0 ? next : null });
  };

  // 대상은 최소 1개 — 마지막 하나는 해제되지 않는다 (인쇄 시 어디에도 안 잡히는 템플릿 방지)
  const audiences = templateAudiences(draft);
  const toggleAudience = (key: LabelAudience) => {
    const has = audiences.includes(key);
    if (has && audiences.length === 1) return;
    const next = has ? audiences.filter((a) => a !== key) : [...audiences, key];
    onPatch({ audiences: next });
  };

  return (
    <>
      <div className="ls-grid-2">
        <label className="ls-field ls-col-2">
          <span>템플릿 이름</span>
          <input
            value={draft.name}
            onChange={(e) => onPatch({ name: e.target.value }, 'tpl:name')}
            placeholder="예) 여성 상의 케어라벨"
          />
        </label>

        <label className="ls-field ls-col-2">
          <span>템플릿 설명 (작업자용 · 중국어 권장)</span>
          <textarea
            rows={2}
            value={draft.description ?? ''}
            onChange={(e) => onPatch({ description: e.target.value }, 'tpl:desc')}
            placeholder="예) 女装上衣 洗唛 (成人)"
          />
        </label>
        <div className="ls-hint ls-col-2">
          입고·라벨 화면의 템플릿 드롭다운에 이름 아래 두 번째 줄로 보입니다. 작업자가 한글 이름을
          못 읽어도 이 설명으로 고를 수 있게 중국어로 적어 두세요.
        </div>

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
      </div>

      {/* ── 사용할 수 있는 사업자 — 여러 명 지정 가능 ── */}
      <div className="ls-sub-title">사용할 수 있는 사업자</div>
      <div className="ls-hint ls-mb8">
        아무도 안 고르면 공용(모든 사업자)입니다. 여러 명을 고르면 그 사업자들이 같은 양식을
        같이 씁니다.
      </div>
      <label className="ls-check ls-user-shared">
        <input type="checkbox" checked={shared} onChange={() => onPatch({ user_ids: null })} />
        <span>공용 (모든 사업자)</span>
      </label>
      <div className="ls-user-checklist">
        {users.map((u) => (
          <label className="ls-check" key={u.id}>
            <input
              type="checkbox"
              checked={!shared && !!draft.user_ids?.includes(u.id)}
              onChange={() => toggleUser(u.id)}
            />
            <span>{userLabel(u)}</span>
          </label>
        ))}
      </div>

      {/* ── 대상 — 권장연령 유무로 자동 선택된다 ── */}
      <div className="ls-sub-title">대상 (성인 / 키즈)</div>
      <div className="ls-hint ls-mb8">
        입고·라벨 화면에서 권장연령이 <b>없는</b> 상품은 성인, <b>있는</b> 상품은 키즈 템플릿이
        자동으로 선택됩니다. 둘 다 체크하면 두 경우 모두에 쓰입니다.
      </div>
      <div className="ls-audience-checks">
        {LABEL_AUDIENCES.map((a) => (
          <label className="ls-check" key={a.key}>
            <input
              type="checkbox"
              checked={audiences.includes(a.key)}
              onChange={() => toggleAudience(a.key)}
            />
            <span>
              {a.label} <em>({a.hint})</em>
            </span>
          </label>
        ))}
      </div>

      {/* ── 용지 · 절단 ── */}
      <div className="ls-sub-title">용지</div>
      <div className="ls-grid-2">
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

        <label className="ls-field ls-check ls-col-2">
          <input
            type="checkbox"
            checked={draft.is_default}
            onChange={(e) => onPatch({ is_default: e.target.checked })}
          />
          <span>이 사업자·종류·대상의 기본 템플릿으로 사용</span>
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
    </>
  );
};

export default TemplateInfoPanel;
