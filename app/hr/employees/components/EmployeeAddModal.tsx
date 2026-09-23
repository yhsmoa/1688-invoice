'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmployeeFormFields from './EmployeeFormFields';
import EmployeeImageSlot from './EmployeeImageSlot';
import { useImageChanges } from '../hooks/useImageChanges';
import { applyImageChanges } from '../utils/employeeImageApi';
import {
  EMPTY_FORM,
  IMAGE_KINDS,
  type Employee,
  type EditableFields,
} from '../utils/employeeFields';

// ============================================================
// 직원 추가 모달
//   레이아웃: [얼굴 사진 | 신분증 앞면 | 신분증 뒷면] → 입력 필드 2열 그리드
//   저장 순서: ① 직원 추가(POST) → ② 새 id 로 이미지 업로드
//     이미지가 일부 실패해도 직원은 이미 추가된 상태 — 실패 항목을 알리고 상세에서 다시 첨부하게 한다
// ============================================================
interface EmployeeAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 저장 완료 — 이미지 경로가 반영된 목록을 다시 받도록 호출 측이 새로고침 */
  onAdded: (employee: Employee) => void;
}

const EmployeeAddModal: React.FC<EmployeeAddModalProps> = ({ isOpen, onClose, onAdded }) => {
  const { t } = useTranslation();
  const [form, setForm] = useState<EditableFields>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const { changes, processing, isProcessing, selectImage, removeImage, resetImages } = useImageChanges();

  // ── 열릴 때마다 초기화 ──
  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      resetImages();
    }
  }, [isOpen, resetImages]);

  const handleChange = (field: keyof EditableFields, value: string | number | null) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // ============================================================
  // 저장
  // ============================================================
  const handleSave = async () => {
    if (isSaving || isProcessing) return;
    setIsSaving(true);
    try {
      // ── ① 직원 추가 ──
      const res = await fetch('/api/hr/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const result = await res.json();
      if (!result.success) {
        // 서버 문구는 한국어 고정 — 화면에는 번역 문구, 상세는 콘솔로
        console.error('직원 추가 실패:', result.error, result.details);
        alert(t('hr.employees.add.failed'));
        return;
      }
      const created: Employee = result.data;

      // ── ② 이미지 업로드 ──
      const failed = await applyImageChanges(created.id, changes);
      if (failed.length > 0) {
        const kinds = failed.map((k) => t(`hr.employees.images.${k}`)).join(', ');
        alert(t('hr.employees.images.addedButFailed', { kinds }));
      }

      onAdded(created);
      onClose();
    } catch (err) {
      console.error('직원 추가 오류:', err);
      alert(t('hr.employees.serverError'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="em-modal-overlay">
      <div className="em-add-modal">
        {/* ── 헤더 ── */}
        <div className="em-add-modal-header">
          <h2>{t('hr.employees.add.title')}</h2>
          <button className="em-slide-close" onClick={onClose} disabled={isSaving}>✕</button>
        </div>

        {/* ── 본문 ── */}
        <div className="em-add-modal-body">
          {/* 사진 · 신분증 */}
          <section className="em-add-section">
            <h3 className="em-add-section-title">{t('hr.employees.images.section')}</h3>
            <div className="em-img-row">
              {IMAGE_KINDS.map((kind) => (
                <EmployeeImageSlot
                  key={kind}
                  kind={kind}
                  savedUrl={null}
                  change={changes[kind]}
                  editable
                  processing={!!processing[kind]}
                  onSelect={selectImage}
                  onRemove={(k) => removeImage(k, false)}
                />
              ))}
            </div>
          </section>

          {/* 기본 정보 */}
          <section className="em-add-section">
            <h3 className="em-add-section-title">{t('hr.employees.add.infoSection')}</h3>
            <EmployeeFormFields form={form} onChange={handleChange} />
            {/* access_authorization — 항상 false, 표시만 */}
            <div className="em-form-row">
              <label className="em-form-label">{t('hr.employees.fields.access_authorization')}</label>
              <span className="em-form-readonly">{t('hr.employees.access.defaultReadonly')}</span>
            </div>
          </section>
        </div>

        {/* ── 푸터 ── */}
        <div className="em-add-modal-footer">
          <button className="em-btn em-btn-cancel" onClick={onClose} disabled={isSaving}>
            {t('hr.employees.buttons.cancel')}
          </button>
          <button
            className="em-btn em-btn-save"
            onClick={handleSave}
            disabled={isSaving || isProcessing}
          >
            {isSaving ? t('hr.employees.buttons.saving') : t('hr.employees.buttons.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmployeeAddModal;
