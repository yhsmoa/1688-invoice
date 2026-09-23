'use client';

import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageKind } from '../utils/employeeFields';
import type { ImageChange } from '../utils/employeeImageApi';
import './EmployeeImageSlot.css';

// ============================================================
// 이미지 한 칸 (얼굴 사진 / 신분증 앞면 / 신분증 뒷면)
//   표시 우선순위: 대기 중인 새 이미지 → (삭제 대기면 빈 칸) → 저장된 이미지
//   editable=false 면 보기 전용 (클릭 시 원본을 새 탭으로)
// ============================================================
interface EmployeeImageSlotProps {
  kind: ImageKind;
  /** 저장된 이미지 signed URL (없으면 null) */
  savedUrl: string | null;
  /** 저장 전 변경 (새 이미지 / 삭제) */
  change?: ImageChange;
  editable: boolean;
  /** 압축 중 */
  processing?: boolean;
  /** 저장된 이미지 URL 을 불러오는 중 */
  loading?: boolean;
  onSelect?: (kind: ImageKind, file: File) => void;
  onRemove?: (kind: ImageKind) => void;
}

const EmployeeImageSlot: React.FC<EmployeeImageSlotProps> = ({
  kind,
  savedUrl,
  change,
  editable,
  processing = false,
  loading = false,
  onSelect,
  onRemove,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const shownUrl =
    change === 'remove' ? null : change ? change.previewUrl : savedUrl;
  const isPending = !!change && change !== 'remove';

  // ── 파일 선택 — 같은 파일을 다시 골라도 onChange 가 오도록 value 초기화
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onSelect?.(kind, file);
  };

  return (
    <div className={`em-img-slot em-img-slot-${kind}`}>
      <span className="em-img-label">{t(`hr.employees.images.${kind}`)}</span>

      {/* ── 미리보기 영역 ── */}
      <div
        className={`em-img-frame ${shownUrl ? 'has-image' : ''} ${isPending ? 'pending' : ''}`}
        onClick={() => {
          if (processing) return;
          if (editable) inputRef.current?.click();
          else if (shownUrl) window.open(shownUrl, '_blank', 'noopener,noreferrer');
        }}
        title={!editable && shownUrl ? t('hr.employees.images.openOriginal') : undefined}
      >
        {processing || loading ? (
          <span className="em-img-placeholder">{t('hr.employees.images.processing')}</span>
        ) : shownUrl ? (
          // signed URL·object URL 이라 next/image 최적화 대상이 아님
          // eslint-disable-next-line @next/next/no-img-element
          <img className="em-img-preview" src={shownUrl} alt={t(`hr.employees.images.${kind}`)} />
        ) : (
          <span className="em-img-placeholder">
            {editable ? `+ ${t('hr.employees.images.choose')}` : t('hr.employees.images.empty')}
          </span>
        )}
      </div>

      {/* ── 편집 버튼 ── */}
      {editable && (
        <div className="em-img-actions">
          <button
            type="button"
            className="em-img-btn"
            onClick={() => inputRef.current?.click()}
            disabled={processing}
          >
            {shownUrl ? t('hr.employees.images.replace') : t('hr.employees.images.choose')}
          </button>
          {shownUrl && (
            <button
              type="button"
              className="em-img-btn em-img-btn-remove"
              onClick={() => onRemove?.(kind)}
              disabled={processing}
            >
              {t('hr.employees.images.remove')}
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="em-img-input"
            onChange={handleFileChange}
          />
        </div>
      )}
    </div>
  );
};

export default EmployeeImageSlot;
