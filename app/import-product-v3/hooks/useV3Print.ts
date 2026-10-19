'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import type { LabelTemplatePlan } from '../../import-product-v2/hooks/useLabelTemplatePlan';
import type { AudienceTemplates, PrintLabelResult } from '../../import-product-v2/utils/printLabels';
import type { LabelType } from '../../../lib/labelTypes';
import { planCareLabels } from '../utils/stickerPlan';
import { setInstanceKeyOf } from '../utils/groupKeys';
import type { BatchStatus } from './useAllocationBatch';
import type { SetPrintedInfo, StickerPlanState } from './useStickerPlan';

// ============================================================
// 모달 하단 [저장] [라벨 스티커] [케어 라벨] [모두]
//
//   저장        : 페이지의 onSave (ft_fulfillments ARRIVAL + BarTender 라벨 저장)
//   라벨 스티커  : 출력 직전 최신 계산(buildFresh) → 단품 행 + 세트 대표 행만 출력
//                 이미 출력된 세트가 있으면 조용히 건너뛰지 않고 확인을 받는다
//                 ("10/19 14:20 · 손개열 · PC-2 · 灰色 입고 때 출력됨 — 그래도 다시 출력?")
//                   확인 → 그 세트도 다시 출력 / 취소 → 건너뜀 (실패가 아니다)
//                 출력 기록만 있고 실물이 없는 경우(용지 걸림·분실·잘못 입력 후 입고 삭제)를
//                 작업자가 그 자리에서 잡게 하려는 것
//   케어 라벨    : 배분된 바코드 행 그대로 (세트도 구성품마다)
//   모두        : 저장(안 됐으면) → 라벨 스티커 → 케어 라벨. 중간 실패 시 그 단계에서 멈춘다.
//                 (V2 의 [모두] 는 출력 0건을 실패로 보고 멈추지만, V3 는 세트 스티커
//                  건너뜀이 정상 흐름이라 별도로 작성)
// ============================================================

/** 단계 결과 표시 유지 시간 */
const FLASH_MS = 3000;

/** 재출력 확인 문구에 보여 줄 출력 기록 묶음 수 (넘으면 "외 n건") */
const CONFIRM_MAX_LINES = 3;

/** ISO 시각 → "MM/DD HH:mm" (브라우저 로컬 시간) */
function formatPrintedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Params {
  alloc: Map<string, number>;
  status: BatchStatus;
  rowsById: Map<string, FtOrderItem>;
  /** 저장 — 성공 true. 실패 알림은 호출 측이 띄운다 */
  onSave: () => Promise<boolean>;
  sticker: StickerPlanState;
  templatePlan: LabelTemplatePlan;
  onPrintLabel: (
    rows: { item: FtOrderItem; qty: number }[],
    labelType: LabelType,
    templates: AudienceTemplates
  ) => Promise<PrintLabelResult>;
  t: TFunction;
}

export function useV3Print({ alloc, status, rowsById, onSave, sticker, templatePlan, onPrintLabel, t }: Params) {
  const [isSaving, setIsSaving] = useState(false);
  const [isPrintingBarcode, setIsPrintingBarcode] = useState(false);
  const [isPrintingCare, setIsPrintingCare] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [flashes, setFlashes] = useState<string[]>([]);

  // ── 단계 결과 플래시 — 마지막 추가 후 FLASH_MS 뒤 비움 ──
  useEffect(() => {
    if (flashes.length === 0) return;
    const timer = setTimeout(() => setFlashes([]), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashes]);
  const flash = useCallback((msg: string) => setFlashes((prev) => [...prev, msg]), []);

  const isBusy = isSaving || isPrintingBarcode || isPrintingCare || isRunningAll;

  // ============================================================
  // 저장
  // ============================================================
  const save = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    try {
      const ok = await onSave();
      if (ok) flash(t('importProductV3.footer.saveOk'));
      return ok;
    } finally {
      setIsSaving(false);
    }
  }, [onSave, flash, t]);

  // ============================================================
  // 라벨 스티커 — includePending: 배분이 아직 저장 전이면 true
  // ============================================================
  const printSticker = useCallback(
    async (includePending: boolean): Promise<boolean> => {
      setIsPrintingBarcode(true);
      try {
        let fresh;
        try {
          fresh = await sticker.buildFresh(includePending);
        } catch (err) {
          console.error('세트 스티커 계산 오류:', err);
          alert(t('importProductV3.alerts.stickerDataFailed'));
          return false;
        }
        const { plan, printedInfo } = fresh;
        let rows = plan.rows;

        // ── 이미 출력돼서 0장이 된 세트 — 직접 지정(0 포함)한 세트는 묻지 않는다 ──
        const alreadyPrinted = plan.sets.filter(
          (s) => s.toPrint === 0 && s.printed > 0 && s.target > 0 && !s.overridden
        );
        if (alreadyPrinted.length > 0) {
          // 출력 기록 묶음별 세트 수 — "10/19 14:20 · 손개열 · PC-2 · 灰色 입고 때 — 7세트"
          const groups = new Map<string, number>();
          for (const s of alreadyPrinted) {
            const info: SetPrintedInfo | undefined = printedInfo.get(s.productId);
            const line = info
              ? t('importProductV3.stickerPlan.printedLine', {
                  at: formatPrintedAt(info.at),
                  by: info.by || '-',
                  station: info.station ?? '-',
                  color: info.color || '-',
                })
              : t('importProductV3.stickerPlan.printedUnknown');
            groups.set(line, (groups.get(line) ?? 0) + 1);
          }
          const lines = Array.from(groups.entries());
          const details = lines
            .slice(0, CONFIRM_MAX_LINES)
            .map(([line, n]) => `· ${line} — ${t('importProductV3.stickerPlan.setCount', { count: n })}`)
            .join('\n');
          const more =
            lines.length > CONFIRM_MAX_LINES
              ? `\n${t('importProductV3.stickerPlan.more', { count: lines.length - CONFIRM_MAX_LINES })}`
              : '';

          const reprint = window.confirm(
            t('importProductV3.stickerPlan.reprintConfirm', {
              count: alreadyPrinted.length,
              details: details + more,
            })
          );

          if (reprint) {
            // 다시 출력할 장수 = 이번 배분에서 그 세트의 수량 (필요 누적 장수를 넘지 않게)
            const reprintRows = alreadyPrinted.map((s) => {
              const allocQty = Math.max(
                0,
                ...Array.from(alloc.entries())
                  .filter(([id]) => {
                    const row = rowsById.get(id);
                    return row ? setInstanceKeyOf(row) === s.productId : false;
                  })
                  .map(([, q]) => q)
              );
              return { item: s.rep, qty: Math.min(allocQty, s.target) };
            });
            rows = [...rows, ...reprintRows.filter((r) => r.qty > 0)];
          }
        }

        if (rows.length === 0) {
          // 단품이 없고 세트 스티커는 이미 출력됨(또는 작업자가 건너뛰기 선택) → 정상적으로 건너뜀
          flash(t('importProductV3.footer.skipped'));
          return true;
        }

        const result = await onPrintLabel(rows, 'barcode', templatePlan.selectedOf('barcode'));
        if (!result.success) {
          alert(result.error || t('importProduct.processReady.printing'));
          return false;
        }
        flash(
          `${t('importProduct.processReady.labelSticker')} ${t('importProduct.processReady.printedCount', {
            count: result.printed,
          })}`
        );
        sticker.resetOverrides();
        await sticker.refreshPrinted();
        return true;
      } catch (err) {
        console.error('라벨 스티커 출력 오류:', err);
        alert('라벨 출력 중 오류가 발생했습니다.');
        return false;
      } finally {
        setIsPrintingBarcode(false);
      }
    },
    [sticker, onPrintLabel, templatePlan, flash, alloc, rowsById, t]
  );

  // ============================================================
  // 케어 라벨
  // ============================================================
  const printCare = useCallback(async (): Promise<boolean> => {
    const rows = planCareLabels(alloc, rowsById);
    if (rows.length === 0) {
      alert(t('importProductV3.alerts.noPrintable'));
      return false;
    }
    setIsPrintingCare(true);
    try {
      const result = await onPrintLabel(rows, 'care', templatePlan.selectedOf('care'));
      if (!result.success) {
        alert(result.error || t('importProduct.processReady.printing'));
        return false;
      }
      flash(
        `${t('importProduct.processReady.careLabel')} ${t('importProduct.processReady.printedCount', {
          count: result.printed,
        })}`
      );
      return true;
    } catch (err) {
      console.error('케어 라벨 출력 오류:', err);
      alert('라벨 출력 중 오류가 발생했습니다.');
      return false;
    } finally {
      setIsPrintingCare(false);
    }
  }, [alloc, rowsById, onPrintLabel, templatePlan, flash, t]);

  // ============================================================
  // 모두 — 저장(안 됐으면) → 라벨 스티커 → 케어 라벨
  // ============================================================
  const runAll = useCallback(async () => {
    setIsRunningAll(true);
    try {
      if (status === 'editing') {
        const ok = await save();
        if (!ok) return;
      }
      // 이 시점엔 배분이 DB 에 들어가 있다 → includePending=false
      if (!(await printSticker(false))) return;
      await printCare();
    } finally {
      setIsRunningAll(false);
    }
  }, [status, save, printSticker, printCare]);

  return {
    isSaving,
    isPrintingBarcode,
    isPrintingCare,
    isRunningAll,
    isBusy,
    flashes,
    save,
    printSticker,
    printCare,
    runAll,
  };
}
