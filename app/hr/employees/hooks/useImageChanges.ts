'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageKind } from '../utils/employeeFields';
import {
  prepareImage,
  releasePreview,
  type ImageChanges,
} from '../utils/employeeImageApi';

// ============================================================
// 저장 전 이미지 변경 상태 — 추가 모달 · 상세 수정 모드 공용
//   · 파일 선택 → 브라우저 압축(lib/compressImage) → 미리보기
//   · 삭제: 저장된 이미지가 있으면 'remove' 로 표시, 새로 고른 것만 있으면 취소
//   · object URL 은 교체·초기화·언마운트 때 해제
// ============================================================
export function useImageChanges() {
  const { t } = useTranslation();
  const [changes, setChanges] = useState<ImageChanges>({});
  const [processing, setProcessing] = useState<Partial<Record<ImageKind, boolean>>>({});

  // 언마운트 시 해제용 — 최신 changes 참조
  const changesRef = useRef<ImageChanges>({});
  changesRef.current = changes;

  // ── 파일 선택 ──
  const selectImage = useCallback(
    async (kind: ImageKind, file: File) => {
      setProcessing((p) => ({ ...p, [kind]: true }));
      try {
        const pending = await prepareImage(file);
        setChanges((prev) => {
          releasePreview(prev[kind]);
          return { ...prev, [kind]: pending };
        });
      } catch (err) {
        console.error('직원 이미지 처리 오류:', err);
        alert(t('hr.employees.images.processFailed'));
      } finally {
        setProcessing((p) => ({ ...p, [kind]: false }));
      }
    },
    [t]
  );

  // ── 삭제 — hasSaved: 서버에 저장된 이미지가 있는지 ──
  const removeImage = useCallback((kind: ImageKind, hasSaved: boolean) => {
    setChanges((prev) => {
      releasePreview(prev[kind]);
      const next = { ...prev };
      if (hasSaved) next[kind] = 'remove';
      else delete next[kind];
      return next;
    });
  }, []);

  // ── 초기화 ──
  const resetImages = useCallback(() => {
    setChanges((prev) => {
      Object.values(prev).forEach(releasePreview);
      return {};
    });
    setProcessing({});
  }, []);

  useEffect(() => () => Object.values(changesRef.current).forEach(releasePreview), []);

  const isProcessing = Object.values(processing).some(Boolean);
  const hasChanges = Object.keys(changes).length > 0;

  return { changes, processing, isProcessing, hasChanges, selectImage, removeImage, resetImages };
}
