'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  EDIT_FIELDS,
  DATE_FIELDS,
  NUMBER_FIELDS,
  WIDE_FIELDS,
  ROLE_OPTIONS,
  LEGACY_ROLE_LABEL_KEYS,
  STATUS_OPTIONS,
  type EditableFields,
} from '../utils/employeeFields';

// ============================================================
// 직원 입력 필드 (추가 모달 · 상세 수정 공용) — 2열 그리드
//   직책: 드롭박스 (매니저 / 검수 / 포장 / 단기 아르바이트)
//     선택지에 없는 기존 값(예: '기업')은 현재 값으로만 표시 — 저장해도 그대로 유지된다
// ============================================================
interface EmployeeFormFieldsProps {
  form: EditableFields;
  onChange: (field: keyof EditableFields, value: string | number | null) => void;
  /** 수정 모드에서 원래 직책 — 선택지에 없는 값이면 보존용 옵션으로 표시 */
  originalRole?: string | null;
}

const EmployeeFormFields: React.FC<EmployeeFormFieldsProps> = ({ form, onChange, originalRole }) => {
  const { t } = useTranslation();

  // ── 직책 선택지 + (필요 시) 기존 값 보존 옵션 ──
  const legacyRole =
    originalRole && !ROLE_OPTIONS.some((o) => o.value === originalRole) ? originalRole : null;

  const roleLabel = (value: string) => {
    const opt = ROLE_OPTIONS.find((o) => o.value === value);
    if (opt) return t(`hr.employees.roles.${opt.labelKey}`);
    const legacyKey = LEGACY_ROLE_LABEL_KEYS[value];
    return legacyKey ? t(`hr.employees.roles.${legacyKey}`) : value;
  };

  // ── 필드별 입력 요소 ──
  const renderInput = (field: keyof EditableFields) => {
    if (field === 'note') {
      return (
        <textarea
          className="em-form-textarea"
          value={(form[field] as string) || ''}
          onChange={(e) => onChange(field, e.target.value)}
          rows={3}
        />
      );
    }

    if (field === 'role') {
      return (
        <select
          className="em-form-input"
          value={(form.role as string) || ''}
          onChange={(e) => onChange('role', e.target.value)}
        >
          <option value="">{t('hr.employees.select')}</option>
          {legacyRole && <option value={legacyRole}>{roleLabel(legacyRole)}</option>}
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{roleLabel(o.value)}</option>
          ))}
        </select>
      );
    }

    if (field === 'status') {
      return (
        <select
          className="em-form-input"
          value={(form.status as string) || ''}
          onChange={(e) => onChange('status', e.target.value)}
        >
          <option value="">{t('hr.employees.select')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{t(`hr.employees.statuses.${s}`)}</option>
          ))}
        </select>
      );
    }

    const isNumber = NUMBER_FIELDS.has(field);
    return (
      <input
        type={DATE_FIELDS.has(field) ? 'date' : isNumber ? 'number' : 'text'}
        className="em-form-input"
        value={isNumber ? (form[field] ?? '') : (form[field] as string) || ''}
        onChange={(e) => {
          const val = isNumber
            ? (e.target.value === '' ? null : Number(e.target.value))
            : e.target.value;
          onChange(field, val);
        }}
      />
    );
  };

  return (
    <div className="em-form-grid">
      {EDIT_FIELDS.map((field) => (
        <div key={field} className={`em-form-row ${WIDE_FIELDS.has(field) ? 'em-form-row-wide' : ''}`}>
          <label className="em-form-label">{t(`hr.employees.fields.${field}`)}</label>
          {renderInput(field)}
        </div>
      ))}
    </div>
  );
};

export default EmployeeFormFields;
