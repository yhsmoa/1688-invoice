'use client';

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './SaveResultModal.css';

// ============================================================
// SaveResultModal
// /import-product 페이지의 [postgre+저장] 결과를 표시하는 모달
//
// - 모두 성공: 큰 성공 이모지 + 항목별 ✅ → 2초 후 자동 사라짐
// - 실패 포함: 큰 실패 이모지 + 항목별 ✅/❌ → [확인] 버튼 필요
// - i18n: ko/zh 언어 설정 반영 (saveResult.sheetSave 등)
// ============================================================

// ── 상태 이모지 상수 ────────────────────────────────────────
const ICON_SUCCESS = '✅';
const ICON_FAIL = '❌';

// ── 자동 닫힘 지연 시간 ─────────────────────────────────────
const AUTO_DISMISS_MS = 2000;

// ============================================================
// Props
// ============================================================
export interface SaveResultItem {
  success: boolean;
  error?: string;
}

export interface SaveResultModalProps {
  isOpen: boolean;
  sheetResult: SaveResultItem | null;   // 입고(시트) 저장 결과. null이면 row 미표시
  labelResult: SaveResultItem | null;   // 라벨 저장 결과. null이면 row 미표시
  onClose: () => void;
}

// ============================================================
// 컴포넌트
// ============================================================
const SaveResultModal: React.FC<SaveResultModalProps> = ({
  isOpen,
  sheetResult,
  labelResult,
  onClose,
}) => {
  const { t } = useTranslation();

  // ── 전체 성공 여부 판정 ──────────────────────────────────
  //    null(미실행)은 "성공"으로 간주 (실패 근거가 없음)
  const sheetOk = sheetResult === null ? true : sheetResult.success;
  const labelOk = labelResult === null ? true : labelResult.success;
  const allSuccess = sheetOk && labelOk;

  // ── 모두 성공 시 자동 닫힘 ──────────────────────────────
  useEffect(() => {
    if (!isOpen || !allSuccess) return;
    const timer = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [isOpen, allSuccess, onClose]);

  if (!isOpen) return null;

  // ============================================================
  // 항목별 row 렌더링 헬퍼
  // success/fail에 따라 row 상태 클래스 부여 → CSS에서 색상 톤 차등 적용
  // ============================================================
  const renderRow = (label: string, item: SaveResultItem) => (
    <div className={`save-result-row ${item.success ? 'is-success' : 'is-fail'}`}>
      <span className="save-result-row-label">{label}</span>
      <span className="save-result-row-icon">
        {item.success ? ICON_SUCCESS : ICON_FAIL}
      </span>
    </div>
  );

  // ============================================================
  // 렌더링
  // 오버레이 클릭 → onClose (모달 외부 클릭 시 즉시 닫힘)
  // 모달 내부 클릭은 stopPropagation으로 버블링 차단
  // ============================================================
  return (
    <div className="save-result-overlay" onClick={onClose}>
      <div className="save-result-modal" onClick={(e) => e.stopPropagation()}>
        {/* 상단: 대형 상태 이모지 */}
        <div className={`save-result-hero ${allSuccess ? 'is-success' : 'is-fail'}`}>
          {allSuccess ? ICON_SUCCESS : ICON_FAIL}
        </div>

        {/* 중단: 항목별 결과 row */}
        <div className="save-result-rows">
          {sheetResult !== null && renderRow(t('saveResult.sheetSave'), sheetResult)}
          {labelResult !== null && renderRow(t('saveResult.labelSave'), labelResult)}
        </div>

        {/* 하단: [확인] 버튼 — 실패가 포함된 경우에만 노출 */}
        {!allSuccess && (
          <div className="save-result-footer">
            <button className="save-result-confirm-btn" onClick={onClose}>
              {t('saveResult.confirm')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SaveResultModal;
