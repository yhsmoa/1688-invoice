'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './BoxCreateModal.css';

// ============================================================
// BoxCreateModal — ft_box_info 새 박스 생성 (공용)
//
//   /export-product-v2 의 박스 생성 모달과 같은 UI·규칙:
//     · 박스코드 = {user_code}-{타입}-{번호 2자리}
//     · 타입(A/B/C/P/X) 선택 시 그 타입의 다음 번호를 자동 제안 (수정 가능)
//     · 크기 = 가로x세로x높이 (선택 입력, 프리셋 3종)
//   저장: POST /api/ft/box-info → status 'PACKING' 으로 INSERT
//     · 같은 user_id + 미출고(shipment_id IS NULL) 에 같은 box_code 가 있으면 409
//
//   i18n 은 기존 exportProduct.box.* 키를 그대로 사용한다 (ko/zh 모두 존재).
//   사용처: app/shipment-v2/components/MoveModal.tsx
// ============================================================

// ── 박스 타입 배지 — globals.css .size-badge--* 와 같은 팔레트 ──
export const BOX_TYPES = ['A', 'B', 'C', 'P', 'X'] as const;
export type BoxType = (typeof BOX_TYPES)[number];

const BOX_TYPE_META: Record<BoxType, { labelKey: string; colorClass: string }> = {
  A: { labelKey: 'exportProduct.box.typeA', colorClass: 'box-create-color--blue' },
  B: { labelKey: 'exportProduct.box.typeB', colorClass: 'box-create-color--blue' },
  C: { labelKey: 'exportProduct.box.typeC', colorClass: 'box-create-color--blue' },
  P: { labelKey: 'exportProduct.box.typeP', colorClass: 'box-create-color--orange' },
  X: { labelKey: 'exportProduct.box.typeX', colorClass: 'box-create-color--black' },
};

const isBoxType = (v: string): v is BoxType => (BOX_TYPES as readonly string[]).includes(v);

/** 박스 번호 2자리 표기 (BZ-A-1 → 01). 숫자 외 문자는 제거 */
export const padBoxNo = (no: string): string => {
  const digits = no.replace(/\D/g, '');
  return digits.length === 1 ? `0${digits}` : digits;
};

// ── 크기 프리셋 (export-product-v2 와 동일) ──
const SIZE_PRESETS = [
  { label: '150', value: '60x50x40' },
  { label: '145', value: '50x50x45' },
  { label: '120', value: '50x40x30' },
];

// ============================================================
// Props / 응답 타입
// ============================================================

/** 다음 번호 제안에 필요한 최소 필드 (GET /api/ft/box-info 행) */
export interface ExistingBox {
  type?: string | null;
  no?: string | null;
}

/** POST /api/ft/box-info 가 돌려주는 생성 행 */
export interface CreatedBox {
  id: string;
  box_code: string;
  type: string | null;
  no: string | null;
  size: string | null;
  status: string;
  user_code: string | null;
}

export interface BoxCreateModalProps {
  /** ft_users.id — 박스 소유자 */
  userId: string;
  /** ft_users.user_code — 박스코드 접두어. 비어 있으면 생성 불가 */
  userCode: string;
  /** 현재 열린 박스 목록 — 타입별 다음 번호 제안용 */
  existingBoxes: ExistingBox[];
  /** 열 때 미리 선택할 타입 */
  initialType?: BoxType;
  onClose: () => void;
  /** 생성 성공 — 부모가 목록 반영·선택 처리 */
  onCreated: (box: CreatedBox) => void;
}

// ============================================================
// 박스코드 표시 — 타입 글자만 배지색 ("BO-A-02" → BO- [A] -02)
// ============================================================
const BoxCodeLabel: React.FC<{ code: string; className?: string }> = ({ code, className }) => {
  const parts = code.split('-');
  if (parts.length !== 3) return <span className={className}>{code}</span>;
  const [prefix, type, no] = parts;
  const colorClass = isBoxType(type) ? BOX_TYPE_META[type].colorClass : 'box-create-color--gray';
  return (
    <span className={`box-create-code ${className ?? ''}`}>
      <span>{prefix}</span>
      <span className="box-create-code-dash">-</span>
      <span className={`box-create-code-type ${colorClass}`}>{type}</span>
      <span className="box-create-code-dash">-</span>
      <span>{no}</span>
    </span>
  );
};

// ============================================================
// 컴포넌트
// ============================================================
const BoxCreateModal: React.FC<BoxCreateModalProps> = ({
  userId,
  userCode,
  existingBoxes,
  initialType,
  onClose,
  onCreated,
}) => {
  const { t } = useTranslation();

  // ── 타입별 다음 번호 (열린 박스 중 최대 번호 + 1, 없으면 01) ──
  const nextBoxNo = useCallback((type: BoxType): string => {
    const nums = existingBoxes
      .filter((b) => b.type === type)
      .map((b) => parseInt(b.no ?? '', 10))
      .filter((n) => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return padBoxNo(String(next));
  }, [existingBoxes]);

  // ── 상태 ──
  const [boxType, setBoxType] = useState<BoxType | ''>(initialType ?? '');
  const [boxNo, setBoxNo] = useState(() => (initialType ? nextBoxNo(initialType) : ''));
  const [boxSize, setBoxSize] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /** 타입 바꾸면 번호도 그 타입의 다음 번호로 다시 제안 */
  const handleTypeChange = (type: BoxType) => {
    setBoxType(type);
    setBoxNo(nextBoxNo(type));
  };

  // ── 크기: "가로x세로x높이" 문자열의 한 칸만 교체 ──
  const sizeParts = boxSize.split('x');
  const setSizePart = (idx: number, v: string) => {
    const parts = boxSize.split('x');
    while (parts.length < 3) parts.push('');
    parts[idx] = v.replace(/\D/g, '');
    setBoxSize(parts.join('x'));
  };

  // ── 미리보기 / 생성 가능 여부 ──
  const paddedNo = padBoxNo(boxNo);
  const previewCode = boxType ? `${userCode}-${boxType}-${paddedNo || '__'}` : '';
  const canCreate = Boolean(userCode && boxType && paddedNo) && !submitting;

  const sizeValue = useMemo(() => {
    // 세 칸 모두 비어 있으면 미입력으로 저장 (null)
    const parts = boxSize.split('x');
    return parts.some((p) => p) ? boxSize : '';
  }, [boxSize]);

  // ── 생성 ──
  const handleCreate = async () => {
    if (!userCode || !boxType || !paddedNo) {
      alert(t('exportProduct.box.createMissingFields'));
      return;
    }
    if (submitting) return;

    const boxCode = `${userCode}-${boxType}-${paddedNo}`;
    setSubmitting(true);
    try {
      const res = await fetch('/api/ft/box-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_code: userCode,
          box_code: boxCode,
          type: boxType,
          no: paddedNo,
          size: sizeValue || null,
          user_id: userId,
        }),
      });
      const json = await res.json();
      if (!json.success || !json.data) throw new Error(json.error || t('exportProduct.box.createError'));
      onCreated(json.data as CreatedBox);
    } catch (err) {
      console.error('박스 생성 오류:', err);
      alert(err instanceof Error ? err.message : t('exportProduct.box.createError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => { if (!submitting) onClose(); };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    // 부모 모달 위에 겹치므로 클릭 이벤트가 부모 오버레이까지 번지지 않게 막는다
    <div
      className="box-create-overlay"
      onClick={(e) => { e.stopPropagation(); handleClose(); }}
    >
      <div className="box-create-modal" onClick={(e) => e.stopPropagation()}>
        <div className="box-create-head">
          <h3>{t('exportProduct.box.newBox')}</h3>
          <button
            type="button"
            className="box-create-close"
            onClick={handleClose}
            aria-label={t('exportProduct.box.close')}
          >
            ✕
          </button>
        </div>

        {/* ── 미리보기: 📦 / 박스명 / 크기 ── */}
        <div className={`box-create-preview ${boxType ? `is-${boxType}` : ''}`}>
          <span className="box-create-preview-emoji" aria-hidden>📦</span>
          <div className="box-create-preview-body">
            {previewCode ? (
              <BoxCodeLabel code={previewCode} className="box-create-preview-code" />
            ) : (
              <span className="box-create-preview-placeholder">{t('exportProduct.box.selectTypePrompt')}</span>
            )}
            <span className={`box-create-preview-size ${sizeValue ? '' : 'is-empty'}`}>
              {sizeValue || t('exportProduct.box.sizeEmpty')}
            </span>
          </div>
        </div>

        <div className="box-create-form">
          {/* ── 타입 — 배지색 버튼 ── */}
          <div className="box-create-row">
            <label>{t('exportProduct.box.type')}</label>
            <div className="box-create-type-btns">
              {BOX_TYPES.map((tp) => (
                <button
                  key={tp}
                  type="button"
                  className={`box-create-type-btn ${boxType === tp ? `active ${BOX_TYPE_META[tp].colorClass}` : ''}`}
                  onClick={() => handleTypeChange(tp)}
                  disabled={submitting}
                >
                  <span className="box-create-type-btn-code">{tp}</span>
                  <span className="box-create-type-btn-label">{t(BOX_TYPE_META[tp].labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── 번호 — 다음 번호 자동 제안, 숫자패드로 수정 ── */}
          <div className="box-create-row">
            <label>{t('exportProduct.box.no')}</label>
            <div className="box-create-no-field">
              <input
                type="text"
                inputMode="numeric"
                value={boxNo}
                onChange={(e) => setBoxNo(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder={t('exportProduct.box.no')}
                disabled={submitting}
              />
              <div className="box-create-numpad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setBoxNo((prev) => (prev + n).slice(0, 3))}
                    disabled={submitting}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  className="box-create-numpad-fn"
                  onClick={() => setBoxNo((prev) => prev.slice(0, -1))}
                  disabled={submitting}
                >
                  ⌫
                </button>
                <button
                  type="button"
                  onClick={() => setBoxNo((prev) => (prev + '0').slice(0, 3))}
                  disabled={submitting}
                >
                  0
                </button>
                <button
                  type="button"
                  className="box-create-numpad-fn"
                  onClick={() => setBoxNo('')}
                  disabled={submitting}
                >
                  C
                </button>
              </div>
            </div>
          </div>

          {/* ── 크기 — 가로 × 세로 × 높이 + 프리셋 ── */}
          <div className="box-create-row">
            <label>
              {t('exportProduct.box.size')}
              <span className="box-create-hint">{t('exportProduct.box.sizeHint')}</span>
            </label>
            <div className="box-create-size-inputs">
              {(['width', 'depth', 'height'] as const).map((dim, i) => (
                <React.Fragment key={dim}>
                  {i > 0 && <span className="box-create-size-x">×</span>}
                  <input
                    type="text"
                    inputMode="numeric"
                    value={sizeParts[i] || ''}
                    onChange={(e) => setSizePart(i, e.target.value)}
                    placeholder={t(`exportProduct.box.${dim}`)}
                    disabled={submitting}
                  />
                </React.Fragment>
              ))}
            </div>
            <div className="box-create-size-presets">
              {SIZE_PRESETS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={`box-create-size-btn ${boxSize === s.value ? 'active' : ''}`}
                  onClick={() => setBoxSize(s.value)}
                  disabled={submitting}
                >
                  <span className="box-create-size-btn-label">{s.label}</span>
                  <span className="box-create-size-btn-dim">{s.value.replace(/x/g, '×')}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 하단 버튼 ── */}
        <div className="box-create-foot">
          <button type="button" className="box-create-btn-ghost" onClick={handleClose} disabled={submitting}>
            {t('exportProduct.box.cancel')}
          </button>
          <button type="button" className="box-create-btn-primary" onClick={handleCreate} disabled={!canCreate}>
            {canCreate ? t('exportProduct.box.createWithCode', { code: previewCode }) : t('exportProduct.box.create')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BoxCreateModal;
