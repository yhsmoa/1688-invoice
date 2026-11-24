'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BarcodeCameraLabels } from '../components/BarcodeCamera';

// ============================================================
// useCamLabels — 카메라 스캔 창(components/BarcodeCamera)의 문구
//   공용 문구(mobile.cam.*) + 그 화면의 "읽었지만 이 화면에서 쓰는 형식이 아님" 문구
//   notMatched 에는 {{value}} 를 그대로 둔 문장을 넘긴다 (BarcodeCamera 가 읽은 값으로 바꾼다)
// ============================================================
export function useCamLabels(notMatched: string): BarcodeCameraLabels {
  const { t } = useTranslation();

  return useMemo(() => ({
    close: t('mobile.cam.close'),
    preparing: t('mobile.cam.preparing'),
    align: t('mobile.cam.align'),
    photoReading: t('mobile.cam.photoReading'),
    photoFail: t('mobile.cam.photoFail'),
    camFailTitle: t('mobile.cam.failTitle'),
    photoScan: t('mobile.cam.photoScan'),
    closeManual: t('mobile.cam.closeManual'),
    permissionDenied: t('mobile.cam.permissionDenied'),
    noCamera: t('mobile.cam.noCamera'),
    cannotOpen: t('mobile.cam.cannotOpen'),
    moduleFail: t('mobile.cam.moduleFail'),
    continueHint: t('mobile.cam.continueHint'),
    notMatched,
  }), [t, notMatched]);
}
