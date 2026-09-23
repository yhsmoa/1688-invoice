'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmployeeFormFields from './EmployeeFormFields';
import EmployeeImageSlot from './EmployeeImageSlot';
import { useImageChanges } from '../hooks/useImageChanges';
import {
  applyImageChanges,
  fetchEmployeeImageUrls,
  EMPTY_IMAGE_URLS,
  type ImageUrls,
} from '../utils/employeeImageApi';
import {
  DETAIL_FIELDS,
  IMAGE_KINDS,
  ROLE_OPTIONS,
  LEGACY_ROLE_LABEL_KEYS,
  formatDate,
  toEditableFields,
  type Employee,
  type EditableFields,
} from '../utils/employeeFields';

// ============================================================
// 직원 상세 슬라이드 (오른쪽에서 슬라이드인)
//   보기: 사진·신분증 썸네일(클릭 시 원본 새 탭) + 정보
//   수정: 사진 교체/삭제 + 입력 필드 → [저장] 시 ① 정보 PUT ② 이미지 변경 적용
//   이미지는 열 때마다 signed URL 을 새로 받는다 (만료형)
// ============================================================
interface EmployeeDetailSlideProps {
  employee: Employee | null;
  onClose: () => void;
  onUpdated: (employee: Employee) => void;
}

const EmployeeDetailSlide: React.FC<EmployeeDetailSlideProps> = ({ employee, onClose, onUpdated }) => {
  const { t } = useTranslation();
  const [isEditMode, setIsEditMode] = useState(false);
  const [editForm, setEditForm] = useState<EditableFields | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [imageUrls, setImageUrls] = useState<ImageUrls>(EMPTY_IMAGE_URLS);
  const [imagesLoading, setImagesLoading] = useState(false);
  const { changes, processing, isProcessing, selectImage, removeImage, resetImages } = useImageChanges();

  // ============================================================
  // 이미지 signed URL 조회
  // ============================================================
  const loadImages = useCallback(async (id: string) => {
    setImagesLoading(true);
    try {
      setImageUrls(await fetchEmployeeImageUrls(id));
    } catch (err) {
      console.error('직원 이미지 조회 오류:', err);
      setImageUrls(EMPTY_IMAGE_URLS);
    } finally {
      setImagesLoading(false);
    }
  }, []);

  // ── 다른 직원을 열 때마다 초기화 ──
  const employeeId = employee?.id;
  useEffect(() => {
    setIsEditMode(false);
    setEditForm(null);
    resetImages();
    setImageUrls(EMPTY_IMAGE_URLS);
    if (employeeId) loadImages(employeeId);
  }, [employeeId, loadImages, resetImages]);

  // ============================================================
  // 수정 모드
  // ============================================================
  const handleEditStart = () => {
    if (!employee) return;
    setEditForm(toEditableFields(employee));
    resetImages();
    setIsEditMode(true);
  };

  const handleEditCancel = () => {
    resetImages();
    setIsEditMode(false);
  };

  const handleEditChange = (field: keyof EditableFields, value: string | number | null) =>
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));

  const handleEditSave = async () => {
    if (!employee || !editForm || isSaving || isProcessing) return;
    setIsSaving(true);
    try {
      // ── ① 정보 저장 ──
      const res = await fetch(`/api/hr/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const result = await res.json();
      if (!result.success) {
        console.error('직원 정보 수정 실패:', result.error, result.details);
        alert(t('hr.employees.saveFailed'));
        return;
      }

      // ── ② 이미지 변경 적용 ──
      const failed = await applyImageChanges(employee.id, changes);
      if (failed.length > 0) {
        const kinds = failed.map((k) => t(`hr.employees.images.${k}`)).join(', ');
        alert(t('hr.employees.images.uploadFailed', { kinds }));
      }

      onUpdated(result.data);
      resetImages();
      setIsEditMode(false);
      loadImages(employee.id);
    } catch (err) {
      console.error('직원 정보 수정 오류:', err);
      alert(t('hr.employees.serverError'));
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================
  // 보기 모드 값 포맷
  // ============================================================
  const formatValue = (key: keyof Employee, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '-';
    if (key === 'access_authorization') {
      return value ? t('hr.employees.access.yes') : t('hr.employees.access.no');
    }
    if (key === 'created_at' || key === 'birth_date' || key === 'hire_date' || key === 'resigned_date') {
      return formatDate(String(value));
    }
    if (key === 'hourly_wage') return t('hr.employees.wage', { value: Number(value).toLocaleString() });
    if (key === 'status') return t(`hr.employees.statuses.${value}`, { defaultValue: String(value) });
    if (key === 'role') {
      const opt = ROLE_OPTIONS.find((o) => o.value === value);
      const labelKey = opt?.labelKey ?? LEGACY_ROLE_LABEL_KEYS[String(value)];
      return labelKey ? t(`hr.employees.roles.${labelKey}`) : String(value);
    }
    return String(value);
  };

  if (!employee) return null;

  return (
    <>
      <div className="em-overlay" onClick={isSaving ? undefined : onClose} />
      <div className="em-slide-modal open">
        {/* ── 헤더 ── */}
        <div className="em-slide-header">
          <h2 className="em-slide-title">
            {employee.name || employee.name_kr || t('hr.employees.detailTitle')}
          </h2>
          <button className="em-slide-close" onClick={onClose} disabled={isSaving}>✕</button>
        </div>

        {/* ── 본문 ── */}
        <div className="em-slide-body">
          {/* 사진 · 신분증 */}
          <div className="em-slide-images">
            {IMAGE_KINDS.map((kind) => (
              <EmployeeImageSlot
                key={kind}
                kind={kind}
                savedUrl={imageUrls[kind]}
                change={isEditMode ? changes[kind] : undefined}
                editable={isEditMode}
                processing={!!processing[kind]}
                loading={imagesLoading}
                onSelect={selectImage}
                onRemove={(k) => removeImage(k, !!imageUrls[k])}
              />
            ))}
          </div>

          {isEditMode && editForm ? (
            /* ── 수정 모드 ── */
            <div className="em-edit-form">
              <EmployeeFormFields form={editForm} onChange={handleEditChange} originalRole={employee.role} />
              {/* access_authorization — 읽기 전용 */}
              <div className="em-form-row">
                <label className="em-form-label">{t('hr.employees.fields.access_authorization')}</label>
                <span className="em-form-readonly">
                  {employee.access_authorization ? t('hr.employees.access.yes') : t('hr.employees.access.no')}{' '}
                  {t('hr.employees.access.readonlySuffix')}
                </span>
              </div>
            </div>
          ) : (
            /* ── 보기 모드 ── */
            <div className="em-detail-view">
              {DETAIL_FIELDS.map((field) => (
                <div key={field} className="em-detail-row">
                  <span className="em-detail-label">{t(`hr.employees.fields.${field}`)}</span>
                  <span className="em-detail-value">{formatValue(field, employee[field])}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 푸터 ── */}
        <div className="em-slide-footer">
          {isEditMode ? (
            <>
              <button className="em-btn em-btn-cancel" onClick={handleEditCancel} disabled={isSaving}>
                {t('hr.employees.buttons.cancel')}
              </button>
              <button
                className="em-btn em-btn-save"
                onClick={handleEditSave}
                disabled={isSaving || isProcessing}
              >
                {isSaving ? t('hr.employees.buttons.saving') : t('hr.employees.buttons.save')}
              </button>
            </>
          ) : (
            <button className="em-btn em-btn-edit" onClick={handleEditStart}>
              {t('hr.employees.buttons.edit')}
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default EmployeeDetailSlide;
