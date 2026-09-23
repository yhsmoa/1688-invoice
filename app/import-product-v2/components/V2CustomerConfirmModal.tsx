'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../hooks/useFtData';
import { resolveSizeBadge } from '../../../lib/sizeCode';
import { compressImage, formatBytes, ImageCompressError } from '../../../lib/compressImage';
import { CUSTOMER_CONFIRM_MAX_ATTACHMENTS, customerConfirmFileField } from '../../../lib/customerConfirm';
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
//       우측 : 첨부 이미지 여러 장 (최대 CUSTOMER_CONFIRM_MAX_ATTACHMENTS 장)
//              썸네일 그리드 + [+] 타일 — 클릭(다중 선택) 또는 드래그앤드롭으로 추가,
//              썸네일 ✕ 로 개별 삭제. 선택 즉시 브라우저에서 JPEG 로 압축
//              (lib/compressImage, 목표 500KB 이하)해 압축본만 업로드한다.
//              압축은 한 장씩 순서대로 (대용량 여러 장 동시 디코딩 → 메모리 폭증 방지),
//              압축 중에는 저장 버튼을 막는다.
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

// ── 첨부 이미지 1장 ──
interface Attachment {
  /** 모달 안에서 유일한 키 — 삭제·압축 결과 반영 대상 식별 (삭제된 장의 늦은 결과는 버림) */
  key: number;
  /** 사용자가 고른 원본 이름 (오류 안내용) */
  sourceName: string;
  file: File | null;           // 업로드할 파일 (압축본 — 압축 완료 전에는 null)
  previewUrl: string | null;   // 압축본 data URL (미리보기용 — 해제 불필요)
  compressing: boolean;        // 압축 대기·진행 중
  /** 원본 → 업로드 용량 (완료 후 표시용) */
  sizeInfo: { original: number; output: number; compressed: boolean } | null;
}

// ── 아이템별 폼 상태 (key = item.id) ──
interface ItemFormState {
  attachments: Attachment[];   // 첨부 순서 = Notion 표시 순서
  attributes: Set<string>;     // 선택된 속성 key 집합
  etcText: string;             // 기타 입력값
  confirmQty: string;          // 확인수량
}

const createEmptyForm = (): ItemFormState => ({
  attachments: [],
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
  // 첨부 키 발급용 카운터 (crypto.randomUUID 는 http LAN 접속에서 없을 수 있어 쓰지 않는다)
  const attachmentSeqRef = useRef(0);
  // 최신 formData — 장수 제한 계산에서 현재 장수를 읽기 위함
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  // 압축 루프가 "이 장을 아직 처리해야 하는지" 판정 — 렌더 타이밍과 무관하게 동기로 판단
  //   sessionRef : 모달을 새로 열 때마다 +1 → 이전 세션의 남은 압축은 중단
  //   removedKeysRef : ✕ 로 지운 장의 키 → 압축 건너뜀
  const sessionRef = useRef(0);
  const removedKeysRef = useRef<Set<number>>(new Set());

  // ── 모달 열릴 때 폼 초기화 (data URL 사용 → 해제 불필요) ──
  useEffect(() => {
    if (isOpen) {
      const next = new Map<string, ItemFormState>();
      items.forEach((item) => next.set(item.id, createEmptyForm()));
      setFormData(next);
      setAttemptedSave(false);
      sessionRef.current += 1;               // 이전 세션의 진행 중 압축 결과 무효화
      removedKeysRef.current = new Set();
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
  // 첨부 이미지 — 추가 / 삭제 / 압축
  // ============================================================

  // ── 한 장 상태 반영 — 이미 삭제됐거나(모달 재오픈 포함) 없는 키면 버린다 ──
  const patchAttachment = useCallback((itemId: string, key: number, patch: Partial<Attachment>) => {
    setFormData((prev) => {
      const current = prev.get(itemId);
      if (!current || !current.attachments.some((a) => a.key === key)) return prev;
      const next = new Map(prev);
      next.set(itemId, {
        ...current,
        attachments: current.attachments.map((a) => (a.key === key ? { ...a, ...patch } : a)),
      });
      return next;
    });
  }, []);

  // ── 한 장 삭제 (✕ 버튼 · 압축 실패) ──
  const removeAttachment = useCallback((itemId: string, key: number) => {
    removedKeysRef.current.add(key);   // 압축 대기 중이면 건너뛰도록 동기 기록
    setFormData((prev) => {
      const current = prev.get(itemId);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(itemId, { ...current, attachments: current.attachments.filter((a) => a.key !== key) });
      return next;
    });
  }, []);

  // ============================================================
  // 첨부 추가 (클릭 다중 선택 / 드래그앤드롭 공통)
  //   1. 이미지 파일만, 남은 자리(최대 장수 − 현재 장수)만큼 받는다 — 넘치면 안내
  //   2. 받은 장들을 '압축 중' 타일로 먼저 추가 (첨부 순서 = 선택 순서)
  //   3. 한 장씩 순서대로 compressImage → 압축본 + data URL 미리보기 반영
  //      - 대용량 원본 여러 장을 동시에 디코딩하면 메모리가 크게 튀므로 순차 처리
  //      - 그 사이 삭제된 장·모달 재오픈으로 사라진 장은 건너뛴다 (session + removedKeys)
  //   4. 읽을 수 없는 형식은 그 장만 빼고 모아서 한 번에 알린다 — 원본을 대신 올리지 않는다
  // ============================================================
  const addFiles = useCallback(async (itemId: string, picked: File[]) => {
    const images = picked.filter((f) => f.type.startsWith('image/'));
    const nonImageCount = picked.length - images.length;

    // ── 장수 제한 — 현재 장수는 최신 상태(ref)에서 읽는다 ──
    const currentCount = formDataRef.current.get(itemId)?.attachments.length ?? 0;
    const room = Math.max(0, CUSTOMER_CONFIRM_MAX_ATTACHMENTS - currentCount);
    const accepted = images.slice(0, room);
    const overflowCount = images.length - accepted.length;

    const notices: string[] = [];
    if (nonImageCount > 0) notices.push(`이미지가 아닌 파일 ${nonImageCount}개는 제외했습니다.`);
    if (overflowCount > 0) {
      notices.push(`첨부 이미지는 항목당 최대 ${CUSTOMER_CONFIRM_MAX_ATTACHMENTS}장입니다. ${overflowCount}장은 추가하지 않았습니다.`);
    }
    if (notices.length > 0) alert(notices.join('\n'));
    if (accepted.length === 0) return;

    const session = sessionRef.current;
    /** 이 장을 아직 처리해야 하는지 — 모달 재오픈·✕ 삭제면 false */
    const isAlive = (key: number) => sessionRef.current === session && !removedKeysRef.current.has(key);

    // ── '압축 중' 타일로 먼저 추가 ──
    const pending: { key: number; source: File }[] = accepted.map((source) => ({
      key: ++attachmentSeqRef.current,
      source,
    }));
    const pendingTiles: Attachment[] = pending.map(({ key, source }) => ({
      key,
      sourceName: source.name,
      file: null,
      previewUrl: null,
      compressing: true,
      sizeInfo: null,
    }));
    setFormData((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? createEmptyForm();
      // 연속으로 빠르게 추가한 경우에도 최대 장수를 넘지 않게 여기서 한 번 더 자른다
      const merged = [...current.attachments, ...pendingTiles].slice(0, CUSTOMER_CONFIRM_MAX_ATTACHMENTS);
      next.set(itemId, { ...current, attachments: merged });
      return next;
    });

    // ── 한 장씩 압축 ──
    const failedNames: string[] = [];
    for (const { key, source } of pending) {
      if (!isAlive(key)) continue;
      try {
        const result = await compressImage(source);
        const previewUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new ImageCompressError('미리보기를 만들 수 없습니다.'));
          reader.readAsDataURL(result.file);
        });
        patchAttachment(itemId, key, {
          file: result.file,
          previewUrl,
          compressing: false,
          sizeInfo: { original: result.originalBytes, output: result.outputBytes, compressed: result.compressed },
        });
      } catch (err) {
        console.error('첨부 이미지 압축 오류:', err);
        if (!isAlive(key)) continue;
        removeAttachment(itemId, key);
        failedNames.push(source.name);
      }
    }

    if (failedNames.length > 0) {
      alert(
        `다음 이미지를 처리하지 못해 제외했습니다. 다른 이미지로 다시 첨부해주세요.\n` +
        failedNames.map((n) => `- ${n}`).join('\n')
      );
    }
  }, [patchAttachment, removeAttachment]);

  // input change — 다중 선택 (취소 시 onChange 미발생 → 기존 첨부 유지)
  const handleFileChange = useCallback(
    (itemId: string, e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ''; // 같은 파일 재선택 가능하도록 초기화
      if (files.length > 0) addFiles(itemId, files);
    },
    [addFiles]
  );

  // 드래그앤드롭 — 여러 장, 이미지 파일만 (addFiles 에서 거름)
  const handleDrop = useCallback(
    (itemId: string, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverId(null);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) addFiles(itemId, files);
    },
    [addFiles]
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

    // ── 압축이 끝나지 않은 첨부가 있으면 저장하지 않는다 (원본·누락 업로드 방지) ──
    if (items.some((item) => formData.get(item.id)?.attachments.some((a) => a.compressing))) {
      alert('첨부 이미지를 줄이는 중입니다. 잠시 후 다시 저장해주세요.');
      return;
    }

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

      // 첨부파일 — 같은 필드명(file_<id>)으로 여러 개, 첨부 순서대로 (서버가 getAll 로 받음)
      const files = form.attachments
        .map((a) => a.file)
        .filter((f): f is File => f !== null);
      files.forEach((file) => fd.append(customerConfirmFileField(item.id), file, file.name));

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
        // 배송 사이즈 코드 (A/B/C/P/X) — 화면 배지와 동일 로직, Notion 'type' 속성용
        size_code: resolveSizeBadge(item.shipment_type, item.coupang_shipment_size)?.code ?? null,
        attributes: attributeLabels,
        // 서버가 받은 장수와 대조 — 전송 중 일부 누락 시 그 항목을 실패 처리
        file_count: files.length,
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

  /** 압축 중인 첨부가 하나라도 있는지 — 저장 버튼 비활성화 */
  const anyCompressing = items.some((item) =>
    formData.get(item.id)?.attachments.some((a) => a.compressing)
  );

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
              const openPicker = () => fileInputRefs.current.get(item.id)?.click();

              // ── 첨부 용량 합계 (압축 끝난 장만) ──
              const done = form.attachments.filter((a) => a.sizeInfo && !a.compressing);
              const originalTotal = done.reduce((s, a) => s + (a.sizeInfo?.original ?? 0), 0);
              const outputTotal = done.reduce((s, a) => s + (a.sizeInfo?.output ?? 0), 0);
              const attachSummary = done.length > 0
                ? `${done.length}장 · ${originalTotal !== outputTotal
                    ? `${formatBytes(originalTotal)} → ${formatBytes(outputTotal)}`
                    : formatBytes(outputTotal)}`
                : null;

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

                    {/* 우측: 첨부 이미지 여러 장 — 영역 전체가 드롭존, [+] 타일 클릭으로 추가 */}
                    <div className="v2-cc-image-col">
                      <div className="v2-cc-image-label">
                        첨부 이미지 ({form.attachments.length}/{CUSTOMER_CONFIRM_MAX_ATTACHMENTS})
                      </div>
                      <div
                        className={`v2-cc-attach-area ${form.attachments.length === 0 ? 'is-empty' : ''} ${isDragOver ? 'dragover' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setDragOverId(item.id); }}
                        onDragLeave={() => setDragOverId(null)}
                        onDrop={(e) => handleDrop(item.id, e)}
                        onClick={form.attachments.length === 0 ? openPicker : undefined}
                        title={form.attachments.length === 0 ? '클릭 또는 드래그하여 이미지 첨부 (여러 장 가능)' : undefined}
                      >
                        {form.attachments.length === 0 ? (
                          // ── 빈 상태: 영역 전체가 클릭 대상 ──
                          <div className="v2-cc-dropzone-empty">
                            클릭 또는 이미지를 드래그하여 첨부
                            <br />
                            <span className="v2-cc-dropzone-sub">
                              여러 장 가능 · 최대 {CUSTOMER_CONFIRM_MAX_ATTACHMENTS}장
                            </span>
                          </div>
                        ) : (
                          // ── 썸네일 그리드 + [+] 타일 ──
                          <div className="v2-cc-attach-grid">
                            {form.attachments.map((att, idx) => (
                              <div
                                key={att.key}
                                className="v2-cc-attach-tile"
                                title={
                                  att.sizeInfo
                                    ? `${att.sourceName}\n${att.sizeInfo.compressed
                                        ? `${formatBytes(att.sizeInfo.original)} → ${formatBytes(att.sizeInfo.output)}`
                                        : `${formatBytes(att.sizeInfo.output)} (원본)`}`
                                    : att.sourceName
                                }
                              >
                                {att.compressing || !att.previewUrl ? (
                                  <span className="v2-cc-spinner v2-cc-spinner-dark" />
                                ) : (
                                  <img src={att.previewUrl} alt={`첨부 ${idx + 1}`} className="v2-cc-attach-img" />
                                )}
                                <span className="v2-cc-attach-order">{idx + 1}</span>
                                <button
                                  type="button"
                                  className="v2-cc-attach-remove"
                                  onClick={(e) => { e.stopPropagation(); removeAttachment(item.id, att.key); }}
                                  aria-label={`첨부 ${idx + 1} 삭제`}
                                  disabled={isSaving}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                            {form.attachments.length < CUSTOMER_CONFIRM_MAX_ATTACHMENTS && (
                              <button
                                type="button"
                                className="v2-cc-attach-add"
                                onClick={openPicker}
                                disabled={isSaving}
                                title="클릭 또는 드래그하여 이미지 추가"
                              >
                                +
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* 업로드 용량 안내 — 압축 끝난 장들의 합계 (원본 → 압축본) */}
                      {attachSummary && (
                        <div className="v2-cc-size-info">{attachSummary}</div>
                      )}
                      <input
                        ref={(el) => { fileInputRefs.current.set(item.id, el); }}
                        type="file"
                        accept="image/*"
                        multiple
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
            disabled={isSaving || anyCompressing || items.length === 0}
          >
            {isSaving ? (
              <span className="v2-cc-saving">
                <span className="v2-cc-spinner" />
                저장 중...
              </span>
            ) : anyCompressing ? (
              '이미지 처리 중...'
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
