'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../hooks/useFtData';
import './V2CustomerConfirmModal.css';

// ============================================================
// V2 고객확인 모달
//
// 목적: 체크된 ft_order_items 를 Notion DB 로 전송하여 고객 확인을 요청.
//       (구 Google Sheets Apps Script sendSelectedRowToNotion 대체)
//
// 동작:
//   - 체크된 항목 each 마다 카드 1개 (항목별 폼)
//   - 카드 구성:
//       헤더 : 아이템번호 - 중국옵션1, 중국옵션2
//       좌측 : img_url 큰 미리보기 (image-proxy 경유)
//       우측 : 첨부 이미지 드롭존 — 클릭 또는 드래그앤드롭으로 첨부/교체 (별도 버튼 없음)
//       하단 : 확인수량 입력 ([입력] / 입고개수) + 확인 항목 체크박스
//              속성 라벨은 언어설정(ko/zh) 적용, 단 Notion 저장은 항상 한글
//              기타 체크박스 + 입력폼 상시 노출, 입력 시 기타 자동 체크
//   - [저장] → /api/notion/customer-confirm (multipart) → 항목당 Notion 페이지 1개 생성
// ============================================================

// ── 확인 속성 정의 ──
//   key : 영문 식별자 (i18n 키 + 내부 식별)
//   ko  : Notion 저장용 한글 라벨 (언어설정과 무관하게 항상 한글로 전송)
const ATTRIBUTE_OPTIONS: { key: string; ko: string }[] = [
  { key: 'neckline', ko: '네크라인' },
  { key: 'sleeve',   ko: '소매' },
  { key: 'hem',      ko: '밑단' },
  { key: 'pattern',  ko: '패턴' },
  { key: 'material', ko: '소재' },
  { key: 'color',    ko: '색상' },
  { key: 'etc',      ko: '기타' },
];

const ETC_KEY = 'etc';

interface V2CustomerConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 체크박스로 선택된 ft_order_items 목록 */
  items: FtOrderItem[];
  /** 선택된 ft_users.user_code → Notion '팀' 속성 */
  sellerCode: string;
  /** item_id → ARRIVAL(입고) 합계 — '확인수량 / 입고개수' 표시용 */
  arrivalMap: Map<string, number>;
  /** 저장 완료 후 콜백 (모달 닫기 + 선택 해제 등) */
  onSaveComplete: () => void;
}

// ── 아이템별 폼 상태 (key = item.id) ──
interface ItemFormState {
  file: File | null;
  previewUrl: string | null;   // 첨부 파일 object URL (미리보기용)
  attributes: Set<string>;     // 선택된 속성 key 집합
  etcText: string;             // 기타 입력값
  confirmQty: string;          // 확인수량
}

const createEmptyForm = (): ItemFormState => ({
  file: null,
  previewUrl: null,
  attributes: new Set(),
  etcText: '',
  confirmQty: '',
});

const V2CustomerConfirmModal: React.FC<V2CustomerConfirmModalProps> = ({
  isOpen,
  onClose,
  items,
  sellerCode,
  arrivalMap,
  onSaveComplete,
}) => {
  const { t } = useTranslation();

  // ── 아이템별 폼 상태 ──
  const [formData, setFormData] = useState<Map<string, ItemFormState>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  // 저장 시도 여부 — 미입력 확인수량 강조용 (저장 1회 시도 후 true)
  const [attemptedSave, setAttemptedSave] = useState(false);
  // 드래그 오버 중인 항목 id (드롭존 하이라이트용)
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 첨부파일 input ref (item.id → input element)
  const fileInputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());

  // ── 모달 열릴 때 폼 초기화 (data URL 사용 → 해제 불필요) ──
  useEffect(() => {
    if (isOpen) {
      const next = new Map<string, ItemFormState>();
      items.forEach((item) => next.set(item.id, createEmptyForm()));
      setFormData(next);
      setAttemptedSave(false);
    }
  }, [isOpen, items]);

  // ── Esc 키로 닫기 ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isSaving]);

  // ============================================================
  // 첨부 이미지 설정 (클릭 선택 / 드래그앤드롭 공통)
  // ============================================================
  const setItemFile = useCallback((itemId: string, file: File | null) => {
    // 파일은 즉시 반영 (저장용), 미리보기는 FileReader data URL 로 비동기 세팅.
    //   - blob: URL + revoke 경합으로 인한 ERR_FILE_NOT_FOUND 회피
    //   - data URL 은 자체 완결형이라 해제 불필요
    setFormData((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? createEmptyForm();
      next.set(itemId, { ...current, file, previewUrl: null });
      return next;
    });

    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setFormData((prev) => {
        const current = prev.get(itemId);
        // 그 사이 다른 파일로 교체되었으면 stale 결과 무시
        if (!current || current.file !== file) return prev;
        const next = new Map(prev);
        next.set(itemId, { ...current, previewUrl: url });
        return next;
      });
    };
    reader.readAsDataURL(file);
  }, []);

  // input change — 파일 선택 (취소 시 onChange 미발생 → 기존 첨부 유지)
  const handleFileChange = useCallback(
    (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) setItemFile(itemId, file);
      e.target.value = ''; // 같은 파일 재선택 가능하도록 초기화
    },
    [setItemFile]
  );

  // 드래그앤드롭 — 이미지 파일만 허용
  const handleDrop = useCallback(
    (itemId: string, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverId(null);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) {
        setItemFile(itemId, file);
      }
    },
    [setItemFile]
  );

  // ============================================================
  // 속성 체크박스 토글
  // ============================================================
  const toggleAttribute = useCallback((itemId: string, attrKey: string) => {
    setFormData((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? createEmptyForm();
      const attributes = new Set(current.attributes);
      if (attributes.has(attrKey)) attributes.delete(attrKey);
      else attributes.add(attrKey);
      next.set(itemId, { ...current, attributes });
      return next;
    });
  }, []);

  // 기타 입력 — 입력값이 있으면 기타 자동 체크
  const updateEtcText = useCallback((itemId: string, value: string) => {
    setFormData((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? createEmptyForm();
      const attributes = new Set(current.attributes);
      if (value.trim() !== '') attributes.add(ETC_KEY);
      next.set(itemId, { ...current, etcText: value, attributes });
      return next;
    });
  }, []);

  // 확인수량 입력 (숫자만)
  const updateConfirmQty = useCallback((itemId: string, value: string) => {
    const cleaned = value.replace(/[^0-9]/g, '');
    setFormData((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? createEmptyForm();
      next.set(itemId, { ...current, confirmQty: cleaned });
      return next;
    });
  }, []);

  // ============================================================
  // [저장] — multipart 로 항목별 메타 + 첨부파일 전송
  // ============================================================
  const handleSubmit = useCallback(async () => {
    if (isSaving || items.length === 0) return;

    if (!sellerCode) {
      alert('선택된 사용자의 USER_CODE 가 없어 Notion 팀 정보를 저장할 수 없습니다.');
      return;
    }

    // ── 확인수량 필수 검증 (0 은 허용, 빈 값만 차단) ──
    const missing = items.filter(
      (item) => (formData.get(item.id)?.confirmQty ?? '').trim() === ''
    );
    if (missing.length > 0) {
      setAttemptedSave(true);
      alert(
        '확인수량을 입력하지 않은 항목이 있습니다 (0 이라도 입력 필요):\n' +
        missing.map((item) => `- ${item.item_no || item.id}`).join('\n')
      );
      return;
    }

    const fd = new FormData();

    // ── 항목별 메타 페이로드 + 첨부파일 ──
    const payload = items.map((item) => {
      const form = formData.get(item.id) ?? createEmptyForm();

      // 선택된 속성을 한글 라벨로 변환 (언어설정 무관, 기타는 입력값 결합)
      const attributeLabels = ATTRIBUTE_OPTIONS
        .filter((opt) => form.attributes.has(opt.key))
        .map((opt) => {
          if (opt.key === ETC_KEY) {
            const txt = form.etcText.trim();
            return txt ? `기타: ${txt}` : '기타';
          }
          return opt.ko;
        });

      // 첨부파일이 있으면 file_<id> 로 함께 전송
      if (form.file) {
        fd.append(`file_${item.id}`, form.file, form.file.name);
      }

      return {
        id: item.id,
        item_no: item.item_no,
        item_name: item.item_name,
        option_name: item.option_name,
        china_option1: item.china_option1,
        china_option2: item.china_option2,
        order_no: item.order_no,
        order_qty: item.order_qty,
        confirm_qty: form.confirmQty || null,
        arrival_qty: arrivalMap.get(item.id) ?? 0,
        img_url: item.img_url,
        site_url: item.site_url,
        attributes: attributeLabels,
        has_file: !!form.file,
      };
    });

    fd.append('seller_code', sellerCode);
    fd.append('payload', JSON.stringify(payload));

    setIsSaving(true);
    try {
      const res = await fetch('/api/notion/customer-confirm', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Notion 저장에 실패했습니다.');
      }

      // 일부 실패 항목 안내 (있을 경우)
      if (Array.isArray(json.failed) && json.failed.length > 0) {
        alert(
          `✅ ${json.created}건 저장 완료\n` +
          `❌ ${json.failed.length}건 실패:\n${json.failed.map((f: { item_no: string; error: string }) => `- ${f.item_no}: ${f.error}`).join('\n')}`
        );
      } else {
        alert(`✅ Notion 에 ${json.created}건 저장 완료되었습니다.`);
      }

      onSaveComplete();
    } catch (err) {
      console.error('고객확인 저장 오류:', err);
      alert(err instanceof Error ? err.message : 'Notion 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, items, formData, sellerCode, arrivalMap, onSaveComplete]);

  if (!isOpen) return null;

  return (
    // ── 배경 오버레이 ──
    <div className="v2-cc-overlay" onClick={() => !isSaving && onClose()}>
      {/* ── 모달 박스 (클릭 전파 차단) ── */}
      <div className="v2-cc-dialog" onClick={(e) => e.stopPropagation()}>
        {/* ────────────────────────────────────────
            헤더
        ──────────────────────────────────────── */}
        <div className="v2-cc-header">
          <h2>고객확인 ({items.length}건)</h2>
          <button className="v2-cc-close-btn" onClick={onClose} disabled={isSaving}>×</button>
        </div>

        {/* ────────────────────────────────────────
            바디 — 항목별 카드
        ──────────────────────────────────────── */}
        <div className="v2-cc-body">
          {items.length === 0 ? (
            <div className="v2-cc-empty">선택된 항목이 없습니다.</div>
          ) : (
            items.map((item) => {
              const form = formData.get(item.id) ?? createEmptyForm();
              const chinaOption = [item.china_option1, item.china_option2]
                .filter(Boolean)
                .join(', ');
              const arrivalCount = arrivalMap.get(item.id) ?? 0;
              const isDragOver = dragOverId === item.id;

              return (
                <div key={item.id} className="v2-cc-item-card">
                  {/* ── 헤더: 아이템번호 - 중국옵션1, 중국옵션2 ── */}
                  <div className="v2-cc-item-header">
                    <span className="v2-cc-item-no">{item.item_no || '-'}</span>
                    <span className="v2-cc-item-sep">-</span>
                    <span className="v2-cc-item-option">{chinaOption || '옵션 없음'}</span>
                  </div>

                  {/* ── 이미지 2단: 좌 img_url / 우 첨부(드롭존) ── */}
                  <div className="v2-cc-image-row">
                    {/* 좌측: 상품 이미지 (img_url) */}
                    <div className="v2-cc-image-col">
                      <div className="v2-cc-image-label">상품 이미지 (URL)</div>
                      <div className="v2-cc-image-box">
                        {item.img_url ? (
                          <img
                            src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
                            alt="상품 이미지"
                            className="v2-cc-image"
                          />
                        ) : (
                          <div className="v2-cc-image-empty">이미지 없음</div>
                        )}
                      </div>
                    </div>

                    {/* 우측: 첨부 이미지 드롭존 (클릭/드래그앤드롭으로 첨부·교체) */}
                    <div className="v2-cc-image-col">
                      <div className="v2-cc-image-label">첨부 이미지</div>
                      <div
                        className={`v2-cc-image-box v2-cc-dropzone ${isDragOver ? 'dragover' : ''}`}
                        onClick={() => fileInputRefs.current.get(item.id)?.click()}
                        onDragOver={(e) => { e.preventDefault(); setDragOverId(item.id); }}
                        onDragLeave={() => setDragOverId(null)}
                        onDrop={(e) => handleDrop(item.id, e)}
                        title="클릭 또는 드래그하여 이미지 첨부·교체"
                      >
                        {form.previewUrl ? (
                          <>
                            <img src={form.previewUrl} alt="첨부 미리보기" className="v2-cc-image" />
                            <div className="v2-cc-dropzone-hint">클릭 또는 드래그하여 교체</div>
                          </>
                        ) : (
                          <div className="v2-cc-dropzone-empty">
                            클릭 또는 이미지를 드래그하여 첨부
                          </div>
                        )}
                      </div>
                      <input
                        ref={(el) => { fileInputRefs.current.set(item.id, el); }}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => handleFileChange(item.id, e)}
                      />
                    </div>
                  </div>

                  {/* ── 확인 항목 (확인수량 + 속성 체크박스) ── */}
                  <div className="v2-cc-attr-section">
                    {/* 확인수량 : [입력] / 입고개수 */}
                    <div className="v2-cc-qty-row">
                      <span className="v2-cc-qty-label">확인수량 :</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className={`v2-cc-qty-input ${attemptedSave && form.confirmQty.trim() === '' ? 'v2-cc-qty-input-error' : ''}`}
                        value={form.confirmQty}
                        placeholder="0"
                        onChange={(e) => updateConfirmQty(item.id, e.target.value)}
                      />
                      <span className="v2-cc-qty-divider">/</span>
                      <span className="v2-cc-qty-arrival">
                        {arrivalCount}
                        <em className="v2-cc-qty-caption">입고개수</em>
                      </span>
                    </div>

                    <div className="v2-cc-attr-label">확인 항목</div>
                    <div className="v2-cc-attr-grid">
                      {ATTRIBUTE_OPTIONS.map((opt) => (
                        <label key={opt.key} className="v2-cc-attr-checkbox">
                          <input
                            type="checkbox"
                            checked={form.attributes.has(opt.key)}
                            onChange={() => toggleAttribute(item.id, opt.key)}
                          />
                          <span>{t(`importProductV2.customerConfirm.attr.${opt.key}`)}</span>
                        </label>
                      ))}
                    </div>

                    {/* 기타 입력폼 — 상시 노출, 입력 시 기타 자동 체크 */}
                    <input
                      type="text"
                      className="v2-cc-etc-input"
                      value={form.etcText}
                      placeholder={`${t('importProductV2.customerConfirm.attr.etc')} 내용을 입력하세요`}
                      onChange={(e) => updateEtcText(item.id, e.target.value)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ────────────────────────────────────────
            푸터 — 닫기 / 저장
        ──────────────────────────────────────── */}
        <div className="v2-cc-footer">
          <button className="v2-cc-btn-secondary" onClick={onClose} disabled={isSaving}>
            닫기
          </button>
          <button
            className="v2-cc-btn-primary"
            onClick={handleSubmit}
            disabled={isSaving || items.length === 0}
          >
            {isSaving ? (
              <span className="v2-cc-saving">
                <span className="v2-cc-spinner" />
                저장 중...
              </span>
            ) : (
              '저장'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2CustomerConfirmModal;
