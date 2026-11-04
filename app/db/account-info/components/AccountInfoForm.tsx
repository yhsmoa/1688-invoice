'use client';

import React, { useState } from 'react';
import ComboboxInput from '../../../hr/employees/components/ComboboxInput';
import { BANK_NAMES } from '../../../hr/employees/utils/bankNames';
import {
  ACCOUNT_FIELDS,
  EMPTY_FORM,
  INFO_FIELDS,
  toForm,
  type AccountInfo,
  type AccountInfoField,
  type AccountInfoForm as FormValues,
} from '../types';

// ============================================================
// 계좌정보 입력폼 — 신규 등록 / 수정 공용
//   · editing 이 있으면 그 행 값으로 채워 수정 모드, 없으면 빈 폼(신규)
//     호출 측이 key 를 editing id 로 바꿔 다시 마운트 → 폼 상태 초기화
//   · 은행: 직원관리와 같은 입력형 + 드롭박스 (BANK_NAMES) — 목록 외 값도 직접 입력 가능
//   · 비고: 여러 줄 입력, 한 줄 전체 폭
// ============================================================
interface AccountInfoFormProps {
  editing: AccountInfo | null;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancelEdit: () => void;
}

const AccountInfoForm: React.FC<AccountInfoFormProps> = ({ editing, onSubmit, onCancelEdit }) => {
  const [form, setForm] = useState<FormValues>(editing ? toForm(editing) : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = editing !== null;

  const setField = (key: AccountInfoField, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  // ============================================================
  // 저장
  // ============================================================
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (INFO_FIELDS.every((f) => !form[f].trim())) {
      setError('회사이름·이름·연락처·은행·계좌번호 중 하나 이상 입력해주세요.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
      // 신규 등록은 다음 입력을 위해 폼을 비운다 (수정은 호출 측이 폼을 닫는다)
      if (!isEdit) setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  // ── 필드별 입력 요소 ──
  const renderInput = (key: AccountInfoField) => {
    if (key === 'bank_name') {
      return (
        <ComboboxInput
          className="ai-input"
          value={form.bank_name}
          options={BANK_NAMES}
          onChange={(v) => setField('bank_name', v)}
        />
      );
    }
    if (key === 'note') {
      return (
        <textarea
          className="ai-textarea"
          value={form.note}
          rows={2}
          onChange={(e) => setField('note', e.target.value)}
        />
      );
    }
    return (
      <input
        type="text"
        className="ai-input"
        value={form[key]}
        inputMode={key === 'phone' || key === 'account_no' ? 'tel' : undefined}
        onChange={(e) => setField(key, e.target.value)}
      />
    );
  };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <form className={`ai-form ${isEdit ? 'ai-form--edit' : ''}`} onSubmit={handleSubmit}>
      <div className="ai-form-head">
        <h2 className="ai-form-title">{isEdit ? '계좌정보 수정' : '계좌정보 등록'}</h2>
      </div>

      <div className="ai-form-grid">
        {ACCOUNT_FIELDS.map(({ key, label }) => (
          // div — <label> 로 감싸면 은행 콤보박스의 ▾ 버튼 클릭이 label 활성화와 겹친다
          <div key={key} className={`ai-field ${key === 'note' ? 'ai-field--wide' : ''}`}>
            <span className="ai-label">{label}</span>
            {renderInput(key)}
          </div>
        ))}
      </div>

      {error && <div className="ai-error">{error}</div>}

      <div className="ai-form-actions">
        {isEdit && (
          <button type="button" className="ai-btn ai-btn--ghost" onClick={onCancelEdit} disabled={saving}>
            취소
          </button>
        )}
        <button type="submit" className="ai-btn ai-btn--primary" disabled={saving}>
          {saving ? '저장 중...' : isEdit ? '수정 저장' : '저장'}
        </button>
      </div>
    </form>
  );
};

export default AccountInfoForm;
