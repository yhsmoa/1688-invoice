'use client';

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadBoxLabelPdf, todayYYMMDD } from '../../../lib/boxLabelPdf';
import type { ShipmentV2Row } from '../types';
import { SHIPMENT_SIZE_CODES, getBoxType, type ShipmentSizeCode } from '../utils/shipmentCodes';

// ============================================================
// BoxLabelPrintModal — [박스라벨] 10×15 라벨 PDF (export-invoice/box-label 과 같은 출력물)
//
//   출력 대상 박스
//     · 체크된 행이 있으면 → 체크된 행이 담긴 박스
//     · 없으면             → 현재 화면(필터 적용)에 보이는 행의 박스
//     · 합배송 하위 박스(master_box_code 있음)는 마스터 안에 들어 있으므로 기본 제외 (토글로 포함)
//   타입별 카운트 "출력 / 전체" — 전체 = 이 사용자의 모든 미출고 박스, 같으면(>0) 초록
//   라벨 3줄: 날짜(YYMMDD) / 박스코드 / 박스 사이즈 (없으면 빈 줄)
// ============================================================
interface BoxLabelPrintModalProps {
  /** 사용자의 전체 미출고 행 — 타입별 분모 */
  allRows: ShipmentV2Row[];
  /** 출력 후보 행 — 체크된 행 또는 화면에 보이는 행 */
  targetRows: ShipmentV2Row[];
  /** targetRows 가 체크 기준인지 (안내 문구) */
  fromChecked: boolean;
  userCode: string;
  onClose: () => void;
}

interface LabelBox {
  key: string;
  box_code: string;
  size: string | null;
  type: string;
  merged: boolean;
}

const DATE_PATTERN = /^\d{6}$/;

/** 행 목록 → 박스 목록 (box_info_id, 없으면 box_code 고유) */
const collectBoxes = (rows: ShipmentV2Row[]): LabelBox[] => {
  const map = new Map<string, LabelBox>();
  for (const r of rows) {
    const key = r.box_info_id || `code:${r.box_code}`;
    if (!r.box_code || map.has(key)) continue;
    map.set(key, {
      key,
      box_code: r.box_code,
      size: r.box_size,
      type: getBoxType(r.box_code),
      merged: !!r.master_box_code,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.box_code.localeCompare(b.box_code));
};

const BoxLabelPrintModal: React.FC<BoxLabelPrintModalProps> = ({ allRows, targetRows, fromChecked, userCode, onClose }) => {
  const { t } = useTranslation();
  const [date, setDate] = useState(todayYYMMDD);
  const [includeMerged, setIncludeMerged] = useState(false);
  const [printing, setPrinting] = useState(false);

  // ── 박스 집합 ──
  const allBoxes = useMemo(() => collectBoxes(allRows), [allRows]);
  const candidateBoxes = useMemo(() => collectBoxes(targetRows), [targetRows]);
  const mergedCount = candidateBoxes.filter((b) => b.merged).length;
  const printBoxes = useMemo(
    () => candidateBoxes.filter((b) => includeMerged || !b.merged),
    [candidateBoxes, includeMerged]
  );

  // ── 타입별 "출력 / 전체" (전체는 합배송 포함 여부와 같은 기준으로 센다) ──
  const typeCounts = useMemo(() => {
    const count = (boxes: LabelBox[], code: ShipmentSizeCode) => boxes.filter((b) => b.type === code).length;
    const denomBoxes = allBoxes.filter((b) => includeMerged || !b.merged);
    return SHIPMENT_SIZE_CODES.map((code) => ({
      code,
      printed: count(printBoxes, code),
      total: count(denomBoxes, code),
    }));
  }, [allBoxes, printBoxes, includeMerged]);

  const dateValid = DATE_PATTERN.test(date);

  const handlePrint = () => {
    if (!dateValid) {
      alert(t('shipmentV2.boxLabel.invalidDate'));
      return;
    }
    if (printBoxes.length === 0 || printing) return;
    setPrinting(true);
    try {
      downloadBoxLabelPdf(
        printBoxes.map((b) => ({ date, location: b.box_code, weight: b.size || '' })),
        `박스라벨_${userCode || 'BOX'}_${date}.pdf`
      );
      onClose();
    } catch (err) {
      console.error('박스 라벨 PDF 오류:', err);
      alert(t('shipmentV2.boxLabel.error'));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="shipment-v2-modal-overlay" onClick={() => !printing && onClose()}>
      <div className="shipment-v2-modal sv2-modal--label" onClick={(e) => e.stopPropagation()}>
        <h3 className="shipment-v2-modal-title">{t('shipmentV2.boxLabel.title')}</h3>
        <p className="shipment-v2-modal-desc">
          {fromChecked
            ? t('shipmentV2.boxLabel.scopeChecked', { count: printBoxes.length })
            : t('shipmentV2.boxLabel.scopeAll', { count: printBoxes.length })}
        </p>

        {/* ── 타입별 출력 / 전체 ── */}
        <div className="sv2-label-counts">
          {typeCounts.map(({ code, printed, total }) => {
            const complete = total > 0 && printed === total;
            return (
              <div
                key={code}
                className={`sv2-label-count ${complete ? 'is-complete' : ''} ${total === 0 ? 'is-zero' : ''}`}
              >
                <span className={`sv2-type-chip sv2-type-chip--${code.toLowerCase()}`}>{code}</span>
                <span className="sv2-label-count-num">
                  <strong>{printed}</strong>
                  <span>/ {total}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="shipment-v2-move-hint">{t('shipmentV2.boxLabel.countHint')}</div>

        {/* ── 합배송 하위 박스 ── */}
        {mergedCount > 0 && (
          <label className="sv2-check-line">
            <input type="checkbox" checked={includeMerged} onChange={(e) => setIncludeMerged(e.target.checked)} />
            {includeMerged
              ? t('shipmentV2.boxLabel.includeMerged', { count: mergedCount })
              : t('shipmentV2.boxLabel.excludedMerged', { count: mergedCount })}
          </label>
        )}

        {/* ── 날짜 ── */}
        <div className="shipment-v2-modal-field sv2-label-date">
          <label>{t('shipmentV2.boxLabel.date')}</label>
          <input
            type="text"
            className={`sv2-date-input ${dateValid ? '' : 'is-invalid'}`}
            inputMode="numeric"
            maxLength={6}
            value={date}
            onChange={(e) => setDate(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePrint(); }}
            autoFocus
          />
        </div>

        {printBoxes.length === 0 && (
          <div className="shipment-v2-move-hint shipment-v2-move-hint--error">{t('shipmentV2.boxLabel.noBoxes')}</div>
        )}

        <div className="shipment-v2-modal-actions">
          <button className="shipment-v2-modal-cancel" onClick={onClose} disabled={printing}>
            {t('shipmentV2.boxLabel.cancel')}
          </button>
          <button className="shipment-v2-modal-confirm" onClick={handlePrint} disabled={!dateValid || printBoxes.length === 0 || printing}>
            {printing ? t('shipmentV2.boxLabel.printing') : `${t('shipmentV2.boxLabel.print')} (${printBoxes.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BoxLabelPrintModal;
