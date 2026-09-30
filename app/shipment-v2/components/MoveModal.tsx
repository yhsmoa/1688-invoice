'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BoxCreateModal, { type CreatedBox } from '../../../component/BoxCreateModal';
import type { BoxInfoItem, ShipmentV2Row } from '../types';
import { getBoxType, getShipmentError } from '../utils/shipmentCodes';

// ============================================================
// MoveModal — 박스 이동 (단건: 수량 분할 가능 / 다건: 전체 이동만)
//
//   [이동할 주문번호]  단건: 주문번호 + 상품명 / 다건: "{첫 주문번호} 외 N건"
//   [이동할 박스]      해당 사용자의 열린 박스 (PACKING & 미출고) 드롭다운만 — 자유 입력 없음
//                      [+ 새 박스] → BoxCreateModal (상품출고 V2 와 같은 생성 모달)
//                      생성된 박스는 목록에 추가되고 바로 이동 대상으로 선택된다
//   [이동할 수량]      단건만 입력 (1 ~ 현재 수량). 다건은 비활성 → 전체 이동
//
//   저장: POST /api/ft/shipment-v2/move
//     · 수량 = 현재 수량이면 quantity 를 보내지 않아 "전체 이동" 으로 처리
//       (화면 '스캔' 수량은 인라인 편집으로 DB 와 다를 수 있어 전체 의도를 명시)
//     · 최종 수량 검증은 서버가 DB 수량 기준으로 수행
// ============================================================

interface MoveModalProps {
  userId: string;
  /** ft_users.user_code — 새 박스 코드 접두어 (비어 있으면 박스 생성 불가) */
  userCode: string;
  /** 선택된 행 (화면 순서) — 1건 이상 */
  rows: ShipmentV2Row[];
  onClose: () => void;
  /** 이동 요청이 끝난 뒤 (일부 실패 포함) — 부모가 재조회 */
  onMoved: () => void;
}

interface MoveResponse {
  success: boolean;
  error?: string;
  moved_full?: number;
  moved_split?: number;
  skipped?: number;
  failed?: { id: string; error: string }[];
}

const MoveModal: React.FC<MoveModalProps> = ({ userId, userCode, rows, onClose, onMoved }) => {
  const { t } = useTranslation();
  const isSingle = rows.length === 1;
  const single = isSingle ? rows[0] : null;

  // ============================================================
  // 상태
  // ============================================================
  const [boxes, setBoxes] = useState<BoxInfoItem[]>([]);
  const [boxesLoading, setBoxesLoading] = useState(true);
  const [boxesError, setBoxesError] = useState(false);
  const [targetBoxId, setTargetBoxId] = useState('');
  const [quantityText, setQuantityText] = useState(single ? String(single.quantity) : '');
  const [submitting, setSubmitting] = useState(false);
  const [showBoxCreate, setShowBoxCreate] = useState(false);

  // ============================================================
  // 열린 박스 목록 조회 (PACKING & shipment_id IS NULL)
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBoxesLoading(true);
      setBoxesError(false);
      try {
        const res = await fetch(
          `/api/ft/box-info?user_id=${encodeURIComponent(userId)}&status=PACKING&shipment_id=null`
        );
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || 'box-info');
        const sorted = ((json.data || []) as BoxInfoItem[])
          .slice()
          .sort((a, b) => (a.box_code || '').localeCompare(b.box_code || ''));
        setBoxes(sorted);
      } catch (err) {
        if (!cancelled) {
          console.error('이동 모달 박스 조회 오류:', err);
          setBoxesError(true);
        }
      } finally {
        if (!cancelled) setBoxesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ── 모든 선택 행이 같은 박스에 있으면 그 박스는 대상에서 제외 ──
  const selectableBoxes = useMemo(() => {
    const codes = new Set(rows.map((r) => r.box_code));
    const onlyCode = codes.size === 1 ? rows[0].box_code : null;
    return onlyCode ? boxes.filter((b) => b.box_code !== onlyCode) : boxes;
  }, [boxes, rows]);

  /** 현재 선택된 대상 박스 — 목록에 없는 id 면 undefined (버튼 비활성 기준) */
  const targetBox = useMemo(
    () => selectableBoxes.find((b) => b.id === targetBoxId),
    [selectableBoxes, targetBoxId]
  );

  // ============================================================
  // 새 박스 생성 → 목록에 추가(코드순 유지) + 바로 대상으로 선택
  // ============================================================
  const handleBoxCreated = (created: CreatedBox) => {
    const item: BoxInfoItem = {
      id: created.id,
      box_code: created.box_code,
      size: created.size,
      type: created.type,
      no: created.no,
    };
    setBoxes((prev) =>
      [...prev.filter((b) => b.id !== item.id), item]
        .sort((a, b) => (a.box_code || '').localeCompare(b.box_code || ''))
    );
    // 목록 조회가 실패했더라도 방금 만든 박스는 확실히 존재하므로 드롭다운을 다시 보여준다
    setBoxesError(false);
    // 선택 행이 모두 담긴 박스와 같은 코드로 만들었다면 selectableBoxes 에 없어
    // targetBox 가 undefined → [이동] 버튼이 비활성으로 유지된다
    setTargetBoxId(created.id);
    setShowBoxCreate(false);
  };

  // ============================================================
  // 표시값
  // ============================================================
  const orderLabel = isSingle
    ? single!.product_no || '-'
    : t('shipmentV2.move.orderNoMulti', { first: rows[0].product_no || '-', count: rows.length - 1 });

  const singleProductInfo = single
    ? [single.item_name, single.option_name].filter(Boolean).join(', ')
    : '';

  // ============================================================
  // 수량 검증 (단건만)
  // ============================================================
  const parsedQty = Number(quantityText);
  const qtyValid = !isSingle || (
    Number.isInteger(parsedQty) && parsedQty >= 1 && parsedQty <= single!.quantity
  );

  // ============================================================
  // 이동 실행
  // ============================================================
  const handleConfirm = async () => {
    if (submitting) return;
    const target = targetBox;
    if (!target) return;

    if (!qtyValid) {
      alert(t('shipmentV2.move.invalidQuantity', { max: single!.quantity }));
      return;
    }

    // ── 박스 타입 ≠ 상품 사이즈 (주문 기준 size_code, 테이블 쉽먼트에러와 같은 판정) → 확인 (차단하지 않음) ──
    const boxType = getBoxType(target.box_code);
    const mismatched = Array.from(new Set(
      rows
        .map((r) => getShipmentError({ box_code: target.box_code, size_code: r.size_code }))
        .filter((code): code is NonNullable<typeof code> => code !== null)
    ));
    if (mismatched.length > 0) {
      const ok = window.confirm(
        t('shipmentV2.move.sizeMismatch', { box: boxType, items: mismatched.join(', ') })
      );
      if (!ok) return;
    }

    // ── 요청 본문 — 수량이 현재 수량과 같으면 전체 이동으로 보낸다 ──
    const moves = rows.map((r) =>
      isSingle && parsedQty < r.quantity ? { id: r.id, quantity: parsedQty } : { id: r.id }
    );

    setSubmitting(true);
    try {
      const res = await fetch('/api/ft/shipment-v2/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, target_box_info_id: target.id, moves }),
      });
      const json: MoveResponse = await res.json();

      // 박스 검증 실패 등 — 아무것도 옮기지 않은 경우
      if (!res.ok) {
        alert(json.error || t('shipmentV2.move.error'));
        return;
      }

      // 행 단위 실패 — 성공분은 반영됐으므로 재조회
      const failed = json.failed ?? [];
      if (failed.length > 0) {
        const labelOf = (id: string) => rows.find((r) => r.id === id)?.product_no || id;
        const details = failed.map((f) => `· ${labelOf(f.id)}: ${f.error}`).join('\n');
        alert(t('shipmentV2.move.partialFailed', { count: failed.length, details }));
      }
      onMoved();
    } catch (err) {
      console.error('박스 이동 오류:', err);
      alert(t('shipmentV2.move.error'));
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="shipment-v2-modal-overlay" onClick={() => !submitting && onClose()}>
      <div className="shipment-v2-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="shipment-v2-modal-title">{t('shipmentV2.move.title')}</h3>

        {/* ── 이동할 주문번호 ── */}
        <div className="shipment-v2-modal-field">
          <label>{t('shipmentV2.move.orderNo')}</label>
          <div className="shipment-v2-move-readonly">
            <span className="shipment-v2-move-order">{orderLabel}</span>
            {singleProductInfo && (
              <span className="shipment-v2-move-sub">{singleProductInfo}</span>
            )}
          </div>
        </div>

        {/* ── 이동할 박스 (+ 새 박스 생성) ── */}
        <div className="shipment-v2-modal-field">
          <div className="shipment-v2-move-box-head">
            <label>{t('shipmentV2.move.box')}</label>
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
          {boxesLoading ? (
            <div className="shipment-v2-move-hint">{t('shipmentV2.move.loadingBoxes')}</div>
          ) : boxesError ? (
            <div className="shipment-v2-move-hint shipment-v2-move-hint--error">
              {t('shipmentV2.move.boxLoadError')}
            </div>
          ) : selectableBoxes.length === 0 ? (
            <div className="shipment-v2-move-hint shipment-v2-move-hint--error">
              {t('shipmentV2.move.noBoxes')}
            </div>
          ) : (
            <select
              className="shipment-v2-modal-select"
              value={targetBox ? targetBoxId : ''}
              onChange={(e) => setTargetBoxId(e.target.value)}
              disabled={submitting}
            >
              <option value="">{t('shipmentV2.move.selectBox')}</option>
              {selectableBoxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.box_code}{b.size ? ` (${b.size})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* ── 이동할 수량 ── */}
        <div className="shipment-v2-modal-field">
          <label>{t('shipmentV2.move.quantity')}</label>
          <input
            type="number"
            className="shipment-v2-move-qty"
            min={1}
            max={single?.quantity}
            step={1}
            value={isSingle ? quantityText : ''}
            placeholder={isSingle ? '' : '—'}
            onChange={(e) => setQuantityText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
            disabled={!isSingle || submitting}
          />
          <div className={`shipment-v2-move-hint ${isSingle && !qtyValid ? 'shipment-v2-move-hint--error' : ''}`}>
            {isSingle
              ? (qtyValid
                  ? t('shipmentV2.move.quantityHint', { current: single!.quantity })
                  : t('shipmentV2.move.invalidQuantity', { max: single!.quantity }))
              : t('shipmentV2.move.quantityMultiHint')}
          </div>
        </div>

        {/* ── 버튼 ── */}
        <div className="shipment-v2-modal-actions">
          <button className="shipment-v2-modal-cancel" onClick={onClose} disabled={submitting}>
            {t('shipmentV2.move.cancel')}
          </button>
          <button
            className="shipment-v2-modal-confirm"
            onClick={handleConfirm}
            disabled={!targetBox || !qtyValid || submitting}
          >
            {submitting ? t('shipmentV2.move.moving') : t('shipmentV2.move.confirm')}
          </button>
        </div>

        {/* ── 새 박스 생성 모달 (이동 모달 위에 겹침) ── */}
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

export default MoveModal;
