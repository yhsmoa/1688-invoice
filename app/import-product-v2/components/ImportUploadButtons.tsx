'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportUploads } from '../hooks/useImportUploads';

// ============================================================
// 상품입고 업로드·다운로드 버튼 — V2 · V3 공용 (스타일은 V2 ItemCheck.css)
//
//   ImportUploadButtons : SearchSection 의 rightButtons 자리
//                         [1688 XLSX] [배송상황 csv] [XLSX 다운] [주문 ID]
//   V2MigrationButton   : 제목 옆 [V2 이전]
//
// 핸들러·상태는 hooks/useImportUploads.ts. ItemCheck.tsx(V2) 에 인라인으로 있던
// 마크업을 그대로 옮겼다 (클래스·문구 동일).
//
// 사용처: 상품입고 V2 (기본 클래스) / 주문상태 V2 (buttonClassName 으로 os-v2 스타일,
//         배송상황 csv 는 그 페이지의 DeliveryStatusTools 가 이미 있어 hideCsv)
// ============================================================

/** 기본 버튼 클래스 — V2 ItemCheck.css */
const DEFAULT_BUTTON_CLASS = 'v2-excel-upload-btn';
const DEFAULT_MIGRATION_CLASS = 'v2-migration-btn';

interface ImportUploadButtonsProps {
  uploads: ImportUploads;
  selectedUserId: string;
  /** 버튼 클래스 (미지정 시 V2 스타일) */
  buttonClassName?: string;
  /** [배송상황 csv] 숨김 — 같은 업로드 버튼이 페이지에 이미 있을 때 */
  hideCsv?: boolean;
}

const ImportUploadButtons: React.FC<ImportUploadButtonsProps> = ({
  uploads,
  selectedUserId,
  buttonClassName = DEFAULT_BUTTON_CLASS,
  hideCsv = false,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* ⬆️ 1688 XLSX 업로드 버튼 */}
      <button
        className={buttonClassName}
        onClick={uploads.handleXlsxClick}
        disabled={uploads.isUploadingExcel}
      >
        {uploads.isUploadingExcel ? (
          <span className="v2-button-loading">
            <span className="v2-spinner"></span>
            {t('importProductV2.buttons.uploading')}
          </span>
        ) : (
          `⬆️ ${t('importProductV2.buttons.xlsx')}`
        )}
      </button>
      <input
        ref={uploads.excelFileInputRef}
        type="file"
        accept=".xlsx,.xls"
        multiple
        style={{ display: 'none' }}
        onChange={uploads.handleXlsxFileChange}
      />

      {/* 📋 배송상황 CSV 업로드 버튼 */}
      {!hideCsv && (
        <>
          <button
            className={buttonClassName}
            onClick={uploads.handleCsvClick}
            disabled={uploads.isUploadingCsv}
          >
            {uploads.isUploadingCsv ? (
              <span className="v2-button-loading">
                <span className="v2-spinner"></span>
                {t('importProductV2.buttons.uploading')}
              </span>
            ) : (
              `📋 ${t('importProductV2.buttons.csv')}`
            )}
          </button>
          <input
            ref={uploads.csvFileInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={uploads.handleCsvFileChange}
          />
        </>
      )}

      {/* ⬇️ XLSX 다운 버튼 */}
      <button
        className={buttonClassName}
        onClick={uploads.handleXlsxDownload}
        disabled={uploads.isDownloadingExcel || !selectedUserId}
      >
        {uploads.isDownloadingExcel ? (
          <span className="v2-button-loading">
            <span className="v2-spinner"></span>
            다운로드 중
          </span>
        ) : (
          '⬇️ XLSX 다운'
        )}
      </button>

      {/* 🔗 주문 ID — 엑셀 업로드 → 1688_order_id 매칭 */}
      <button
        className={buttonClassName}
        onClick={uploads.handleOrderIdClick}
        disabled={uploads.isMatchingOrderId}
      >
        {uploads.isMatchingOrderId ? (
          <span className="v2-button-loading">
            <span className="v2-spinner"></span>
            매칭 중
          </span>
        ) : (
          '🔗 주문 ID'
        )}
      </button>
      <input
        ref={uploads.orderIdFileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={uploads.handleOrderIdFileChange}
      />
    </>
  );
};

// ============================================================
// [V2 이전] 버튼 — 사용자 + Worker 선택 후 활성화
// ============================================================
interface V2MigrationButtonProps {
  uploads: ImportUploads;
  selectedUserId: string;
  selectedWorker: string;
  /** 버튼 클래스 (미지정 시 V2 스타일) */
  className?: string;
}

export const V2MigrationButton: React.FC<V2MigrationButtonProps> = ({
  uploads,
  selectedUserId,
  selectedWorker,
  className = DEFAULT_MIGRATION_CLASS,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <button
        className={className}
        onClick={uploads.handleV2MigrationClick}
        disabled={uploads.isV2Migrating || !selectedUserId || !selectedWorker}
        title={
          !selectedUserId
            ? t('importProductV2.alerts.selectUser')
            : !selectedWorker
              ? t('importProductV2.worker')
              : undefined
        }
      >
        {uploads.isV2Migrating ? t('importProductV2.buttons.uploading') : t('importProductV2.buttons.v2Migration')}
      </button>
      <input
        ref={uploads.v2MigrationFileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={uploads.handleV2MigrationFileChange}
      />
    </>
  );
};

export default ImportUploadButtons;
