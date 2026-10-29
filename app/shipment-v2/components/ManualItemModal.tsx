'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BoxCreateModal, { type CreatedBox } from '../../../component/BoxCreateModal';
import type { BoxInfoItem } from '../types';
import { SHIPMENT_SIZE_CODES, type ShipmentSizeCode } from '../utils/shipmentCodes';

// ============================================================
// ManualItemModal — [생성] 주문 없는 쉽먼트 행 (부자재 등)
//
//   입력: 박스 · 주문번호 · 바코드 · 상품정보 · 주문옵션 · 단가 · 품목 · 쉽먼트사이즈 · 입고 · 스캔
//     · 박스: 열린 박스(PACKING & 미출고) 드롭다운 + [+ 새 박스] (이동 모달과 같은 방식)
//             — 포장 행은 박스 없이 존재할 수 없으므로 필수
//     · 품목: 통관정보(invoiceManager-Customs) 한글 품목 드롭다운 — 영문 표시·통관서류와 같은 키
//     · 스캔: 입고 이하. 입고를 바꾸면 스캔을 손대기 전까지 같은 값으로 따라간다
//   저장: POST /api/ft/shipment-v2/manual → DB 함수가 부자재 1행 + 포장 1행을 한 트랜잭션으로
// ============================================================
interface ManualItemModalProps {
  userId: string;
  /** ft_users.user_code — 새 박스 코드 접두어 */
  userCode: string;
  /** 처리 담당자 — created_by / operator_name 으로 기록 (선택) */
  operatorName: string;
  onClose: () => void;
  onCreated: (boxCode: string, itemName: string) => void;
}

interface CustomsOption {
  ko: string;
  en: string | null;
}

const POSITIVE_INT = /^[1-9]\d*$/;
const PRICE_PATTERN = /^\d+(\.\d{1,4})?$/;

const ManualItemModal: React.FC<ManualItemModalProps> = ({ userId, userCode, operatorName, onClose, onCreated }) => {
  const { t } = useTranslation();

  // ============================================================
  // 상태
  // ============================================================
  const [boxes, setBoxes] = useState<BoxInfoItem[]>([]);
  const [boxesLoading, setBoxesLoading] = useState(true);
  const [boxId, setBoxId] = useState('');
  const [showBoxCreate, setShowBoxCreate] = useState(false);

  const [customs, setCustoms] = useState<CustomsOption[]>([]);
  const [customsError, setCustomsError] = useState(false);

  const [productNo, setProductNo] = useState('');
  const [barcode, setBarcode] = useState('');
  const [itemName, setItemName] = useState('');
  const [chinaOption, setChinaOption] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [sizeCode, setSizeCode] = useState<ShipmentSizeCode | ''>('');
  const [arrival, setArrival] = useState('');
  const [scan, setScan] = useState('');
  const [scanTouched, setScanTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ============================================================
  // 열린 박스 / 통관 품목 조회
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ft/box-info?user_id=${encodeURIComponent(userId)}&status=PACKING&shipment_id=null`);
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || 'box-info');
        setBoxes(((json.data || []) as BoxInfoItem[]).slice().sort((a, b) => a.box_code.localeCompare(b.box_code)));
      } catch (err) {
        if (!cancelled) console.error('생성 모달 박스 조회 오류:', err);
      } finally {
        if (!cancelled) setBoxesLoading(false);
      }
    })();
    (async () => {
      try {
        const res = await fetch('/api/get-customs-data');
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || 'customs');
        // 같은 한글 품목이 HS CODE 별로 여러 행일 수 있어(가방 3종) 한글 기준으로 하나만
        const map = new Map<string, string | null>();
        for (const r of (json.data || []) as { item_name_ko?: string | null; item_name_en?: string | null }[]) {
          const ko = (r.item_name_ko || '').trim();
          if (ko && !map.has(ko)) map.set(ko, (r.item_name_en || '').trim() || null);
        }
        setCustoms(Array.from(map.entries()).map(([ko, en]) => ({ ko, en })).sort((a, b) => a.ko.localeCompare(b.ko)));
      } catch (err) {
        if (!cancelled) {
          console.error('통관 품목 조회 오류:', err);
          setCustomsError(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ── 새 박스 생성 → 목록 추가 + 선택 ──
  const handleBoxCreated = (created: CreatedBox) => {
    setBoxes((prev) =>
      [...prev.filter((b) => b.id !== created.id), {
        id: created.id, box_code: created.box_code, size: created.size, type: created.type, no: created.no,
      }].sort((a, b) => a.box_code.localeCompare(b.box_code))
    );
    setBoxId(created.id);
    setShowBoxCreate(false);
  };

  // ── 입고 변경 → 스캔을 손대지 않았으면 같은 값 ──
  const handleArrivalChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 6);
    setArrival(digits);
    if (!scanTouched) setScan(digits);
  };

  // ============================================================
  // 검증
  // ============================================================
  const selectedBox = useMemo(() => boxes.find((b) => b.id === boxId), [boxes, boxId]);
  const arrivalNum = POSITIVE_INT.test(arrival) ? Number(arrival) : NaN;
  const scanNum = POSITIVE_INT.test(scan) ? Number(scan) : NaN;
  const priceValid = price === '' || PRICE_PATTERN.test(price);
  const scanValid = !Number.isNaN(scanNum) && !Number.isNaN(arrivalNum) && scanNum <= arrivalNum;

  const canSubmit = Boolean(
    selectedBox && productNo.trim() && itemName.trim() && sizeCode &&
    !Number.isNaN(arrivalNum) && scanValid && priceValid
  ) && !submitting;

  // ============================================================
  // 저장
  // ============================================================
  const handleSubmit = async () => {
    if (!canSubmit || !selectedBox) {
      alert(t('shipmentV2.manual.invalid'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/ft/shipment-v2/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          box_info_id: selectedBox.id,
          product_no: productNo.trim(),
          barcode: barcode.trim(),
          item_name: itemName.trim(),
          china_option: chinaOption.trim(),
          price_cny: price === '' ? null : Number(price),
          customs_category: category,
          size_code: sizeCode,
          arrival_qty: arrivalNum,
          scan_qty: scanNum,
          operator_name: operatorName,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || t('shipmentV2.manual.error'));
        return;
      }
      onCreated(selectedBox.box_code, itemName.trim());
    } catch (err) {
      console.error('쉽먼트 행 생성 오류:', err);
      alert(t('shipmentV2.manual.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const req = <span className="sv2-req-mark">*</span>;

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="shipment-v2-modal-overlay" onClick={() => !submitting && onClose()}>
      <div className="shipment-v2-modal sv2-modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="shipment-v2-modal-title">{t('shipmentV2.manual.title')}</h3>
        <p className="shipment-v2-modal-desc">{t('shipmentV2.manual.desc')}</p>

        <div className="sv2-form-grid">
          {/* ── 박스 ── */}
          <div className="sv2-field sv2-field--full">
            <div className="shipment-v2-move-box-head">
              <label>{t('shipmentV2.manual.box')} {req}</label>
              <button
                type="button"
                className="shipment-v2-move-new-box"
                onClick={() => setShowBoxCreate(true)}
                disabled={boxesLoading || submitting || !userCode}
                title={!userCode ? t('shipmentV2.move.noUserCode') : undefined}
              >
                {t('shipmentV2.move.newBox')}
              </button>
            </div>
            <select
              className="shipment-v2-modal-select"
              value={boxId}
              onChange={(e) => setBoxId(e.target.value)}
              disabled={boxesLoading || submitting}
            >
              <option value="">{boxesLoading ? t('shipmentV2.move.loadingBoxes') : t('shipmentV2.move.selectBox')}</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>{b.box_code}{b.size ? ` (${b.size})` : ''}</option>
              ))}
            </select>
          </div>

          {/* ── 주문번호 / 바코드 ── */}
          <div className="sv2-field">
            <label>{t('shipmentV2.manual.orderNo')} {req}</label>
            <input className="shipment-v2-modal-input sv2-input-plain" value={productNo} onChange={(e) => setProductNo(e.target.value)} disabled={submitting} />
          </div>
          <div className="sv2-field">
            <label>{t('shipmentV2.manual.barcode')}</label>
            <input className="shipment-v2-modal-input sv2-input-plain" value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={submitting} />
          </div>

          {/* ── 상품정보 / 주문옵션 ── */}
          <div className="sv2-field sv2-field--full">
            <label>{t('shipmentV2.manual.product')} {req}</label>
            <input className="shipment-v2-modal-input sv2-input-plain" value={itemName} onChange={(e) => setItemName(e.target.value)} disabled={submitting} />
          </div>
          <div className="sv2-field sv2-field--full">
            <label>{t('shipmentV2.manual.options')}</label>
            <input className="shipment-v2-modal-input sv2-input-plain" value={chinaOption} onChange={(e) => setChinaOption(e.target.value)} disabled={submitting} />
          </div>

          {/* ── 단가 / 품목 ── */}
          <div className="sv2-field">
            <label>{t('shipmentV2.manual.price')}</label>
            <input
              className={`shipment-v2-modal-input sv2-input-plain ${priceValid ? '' : 'is-invalid'}`}
              inputMode="decimal"
              value={price}
              placeholder="0.00"
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
              disabled={submitting}
            />
          </div>
          <div className="sv2-field">
            <label>{t('shipmentV2.manual.category')}</label>
            <select className="shipment-v2-modal-select" value={category} onChange={(e) => setCategory(e.target.value)} disabled={submitting}>
              <option value="">{t('shipmentV2.manual.categoryNone')}</option>
              {customs.map((c) => (
                <option key={c.ko} value={c.ko}>{c.en ? `${c.en} · ${c.ko}` : c.ko}</option>
              ))}
            </select>
            {customsError && <div className="shipment-v2-move-hint shipment-v2-move-hint--error">{t('shipmentV2.manual.customsLoadError')}</div>}
          </div>

          {/* ── 쉽먼트사이즈 ── */}
          <div className="sv2-field sv2-field--full">
            <label>{t('shipmentV2.manual.shipmentSize')} {req}</label>
            <div className="sv2-size-pick">
              {SHIPMENT_SIZE_CODES.map((code) => (
                <button
                  key={code}
                  type="button"
                  className={`sv2-size-pick-btn sv2-size-pick-btn--${code.toLowerCase()} ${sizeCode === code ? 'is-active' : ''}`}
                  onClick={() => setSizeCode(code)}
                  disabled={submitting}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          {/* ── 입고 / 스캔 ── */}
          <div className="sv2-field">
            <label>{t('shipmentV2.manual.arrival')} {req}</label>
            <input className="shipment-v2-modal-input sv2-input-plain" inputMode="numeric" value={arrival} onChange={(e) => handleArrivalChange(e.target.value)} disabled={submitting} />
          </div>
          <div className="sv2-field">
            <label>{t('shipmentV2.manual.scan')} {req}</label>
            <input
              className={`shipment-v2-modal-input sv2-input-plain ${scan && !scanValid ? 'is-invalid' : ''}`}
              inputMode="numeric"
              value={scan}
              onChange={(e) => { setScanTouched(true); setScan(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              disabled={submitting}
            />
            <div className={`shipment-v2-move-hint ${scan && !scanValid ? 'shipment-v2-move-hint--error' : ''}`}>
              {t('shipmentV2.manual.scanHint')}
            </div>
          </div>
        </div>

        <div className="shipment-v2-modal-actions">
          <button className="shipment-v2-modal-cancel" onClick={onClose} disabled={submitting}>
            {t('shipmentV2.manual.cancel')}
          </button>
          <button className="shipment-v2-modal-confirm" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? t('shipmentV2.manual.creating') : t('shipmentV2.manual.create')}
          </button>
        </div>

        {/* ── 새 박스 생성 (이 모달 위에 겹침) ── */}
        {showBoxCreate && (
          <BoxCreateModal
            userId={userId}
            userCode={userCode}
            existingBoxes={boxes}
            onClose={() => setShowBoxCreate(false)}
            onCreated={handleBoxCreated}
          />
        )}
      </div>
    </div>
  );
};

export default ManualItemModal;
