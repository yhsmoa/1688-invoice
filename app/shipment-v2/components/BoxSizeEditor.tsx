'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SIZE_PRESETS } from '../../../component/BoxCreateModal';

// ============================================================
// BoxSizeEditor — 박스번호 아래 사이즈 텍스트 + 클릭 시 수정 팝오버
//
//   · 프리셋 3종(BoxCreateModal 과 공유) 또는 가로·세로·높이 직접 입력
//   · 저장: PATCH /api/ft/box-info { id, fields: { size } } — 서버가 형식 재검증
//   · [비우기] 는 size = null
//   · 같은 박스의 모든 행 표시는 부모(onSaved)가 box_info_id 기준으로 갱신
//   · box_info_id 가 없는 행(과거 데이터)은 수정 불가 — 텍스트만
//   · 팝오버는 표의 가로 스크롤 영역에 잘리지 않도록 버튼 위치 기준 fixed 좌표로 띄운다
// ============================================================
interface BoxSizeEditorProps {
  boxInfoId: string | null;
  size: string | null;
  onSaved: (boxInfoId: string, size: string | null) => void;
}

const DIM_KEYS = ['width', 'depth', 'height'] as const;
const POPOVER_WIDTH = 280;
const VIEWPORT_MARGIN = 8;
const DIM_PATTERN = /^\d{1,3}$/;

const splitSize = (size: string | null): string[] => {
  const parts = (size ?? '').split('x');
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
};

const BoxSizeEditor: React.FC<BoxSizeEditorProps> = ({ boxInfoId, size, onSaved }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [dims, setDims] = useState<string[]>(() => splitSize(size));
  const [saving, setSaving] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // ── 열 때마다 현재 값으로 초기화 ──
  useEffect(() => {
    if (!open) return;
    setDims(splitSize(size));
    setTimeout(() => firstInputRef.current?.focus(), 0);
  }, [open, size]);

  const valid = dims.every((d) => DIM_PATTERN.test(d));
  const nextSize = dims.join('x');

  const save = async (value: string | null) => {
    if (!boxInfoId || saving) return;
    if (value !== null && !/^\d{1,3}x\d{1,3}x\d{1,3}$/.test(value)) {
      alert(t('shipmentV2.boxSize.invalid'));
      return;
    }
    if (value === size) { setOpen(false); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/ft/box-info', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: boxInfoId, fields: { size: value } }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || t('shipmentV2.boxSize.error'));
      onSaved(boxInfoId, value);
      setOpen(false);
    } catch (err) {
      console.error('박스 사이즈 저장 오류:', err);
      alert(err instanceof Error ? err.message : t('shipmentV2.boxSize.error'));
    } finally {
      setSaving(false);
    }
  };

  const label = size ? size.replace(/x/g, '×') : t('shipmentV2.boxSize.empty');

  if (!boxInfoId) {
    return <span className={`sv2-box-size ${size ? '' : 'is-empty'}`}>{label}</span>;
  }

  return (
    <span className="sv2-box-size-wrap">
      <button
        type="button"
        className={`sv2-box-size sv2-box-size--button ${size ? '' : 'is-empty'}`}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
          setAnchor({ top: rect.bottom + 6, left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)) });
          setOpen(true);
        }}
        title={t('shipmentV2.boxSize.editHint')}
      >
        {label}
      </button>

      {open && anchor && (
        <>
          <div className="sv2-popover-backdrop" onClick={() => !saving && setOpen(false)} />
          <div
            className="sv2-popover"
            role="dialog"
            aria-label={t('shipmentV2.boxSize.title')}
            style={{ top: anchor.top, left: anchor.left, width: POPOVER_WIDTH }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sv2-popover-title">{t('shipmentV2.boxSize.title')}</div>

            {/* ── 프리셋 ── */}
            <div className="sv2-size-presets">
              {SIZE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`sv2-size-preset ${nextSize === p.value ? 'is-active' : ''}`}
                  onClick={() => setDims(splitSize(p.value))}
                  disabled={saving}
                >
                  <strong>{p.label}</strong>
                  <span>{p.value.replace(/x/g, '×')}</span>
                </button>
              ))}
            </div>

            {/* ── 직접 입력 ── */}
            <div className="sv2-size-inputs">
              {DIM_KEYS.map((dim, i) => (
                <React.Fragment key={dim}>
                  {i > 0 && <span className="sv2-size-x">×</span>}
                  <input
                    ref={i === 0 ? firstInputRef : undefined}
                    type="text"
                    inputMode="numeric"
                    value={dims[i]}
                    placeholder={t(`exportProduct.box.${dim}`)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 3);
                      setDims((prev) => prev.map((d, j) => (j === i ? v : d)));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && valid) save(nextSize);
                      if (e.key === 'Escape') setOpen(false);
                    }}
                    disabled={saving}
                  />
                </React.Fragment>
              ))}
            </div>
            {!valid && <div className="sv2-popover-hint">{t('shipmentV2.boxSize.invalid')}</div>}

            <div className="sv2-popover-actions">
              <button type="button" className="sv2-btn sv2-btn--ghost sv2-btn--sm" onClick={() => save(null)} disabled={saving || !size}>
                {t('shipmentV2.boxSize.clear')}
              </button>
              <span className="sv2-spacer" />
              <button type="button" className="sv2-btn sv2-btn--ghost sv2-btn--sm" onClick={() => setOpen(false)} disabled={saving}>
                {t('shipmentV2.boxSize.cancel')}
              </button>
              <button type="button" className="sv2-btn sv2-btn--primary sv2-btn--sm" onClick={() => save(nextSize)} disabled={!valid || saving}>
                {saving ? t('shipmentV2.boxSize.saving') : t('shipmentV2.boxSize.save')}
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  );
};

export default BoxSizeEditor;
