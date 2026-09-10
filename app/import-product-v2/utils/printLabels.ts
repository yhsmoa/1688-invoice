import type { FtOrderItem, FtUser } from '../hooks/useFtData';
import { resolveScanSizeCode } from '../../../lib/sizeCode';
import { buildTsplBatch } from '../../../lib/tspl';
import { preloadTemplateAssets } from '../../../lib/labelRender';
import { printRaw, QZ_NOT_RUNNING } from '../../../lib/qzTray';
import { getLocalPrinter, LOCAL_PRINTER_HELP } from '../../../lib/localPrinterMap';
import {
  accountFieldsToLabelData,
  audienceOfItem,
  LABEL_AUDIENCES,
  templateHasAudience,
  type LabelAudience,
  type LabelTemplate,
  type LabelType,
  type LabelData,
} from '../../../lib/labelTypes';

// ============================================================
// 라벨 즉시 출력 — [입고]·[라벨] 모달에서 QZ Tray 로 바로 인쇄
//
// 흐름:
//   1. 세트상품 병합 (saveLabelData 와 동일 규칙)
//   2. 항목마다 대상 판정 — 권장연령 있으면 키즈, 없으면 성인 (audienceOfItem)
//   3. 대상별 템플릿은 호출 측(모달의 드롭다운, useLabelTemplatePlan)이 이미 골라서
//      넘긴다. 필요한 대상에 템플릿이 없으면 아무것도 찍지 않고 안내만 돌려준다.
//   4. 프린터 결정 — "이 템플릿을 이 PC 에서 어떤 프린터로 뽑을지" (브라우저 로컬 저장,
//      lib/localPrinterMap.ts). PC-NO 개념이 아니다 — 같은 프린터도 PC 마다 QZ Tray 에
//      보이는 이름이 달라서, 서버에 "자리 번호 → 프린터"로 저장하면 PC 가 바뀔 때마다
//      깨진다. 대신 각 PC 가 "이 템플릿은 이 프린터" 를 스스로 한 번만 기억한다.
//      → 모든 그룹의 프린터를 먼저 확인하고 나서 인쇄한다 (반만 찍히는 일 방지)
//   5. 템플릿(=프린터)별로 묶어 데이터 바인딩(상품 + 계정 정보) → TSPL → QZ RAW
//   6. label_print_logs 기록 (station_no 는 기록용 — 어느 자리에서 찍었는지 참고만 한다)
//
// 인쇄 실패가 입고/라벨 저장을 막지 않도록, 호출 측에서 결과만 안내한다.
// ============================================================

/** 대상별로 고른 템플릿 — 그 대상의 항목이 없으면 키 자체가 없어도 된다 */
export type AudienceTemplates = Partial<Record<LabelAudience, LabelTemplate | null>>;

export interface PrintLabelParams {
  items: { item: FtOrderItem; qty: number }[];
  /** 선택된 사업자 계정 — 라벨의 계정 정보 바인딩(ACCOUNT_FIELDS)에 쓴다 */
  selectedUser?: FtUser | null;
  /** ft_users.brand — 라벨 brand 필드 (하위 호환. selectedUser 가 있으면 그쪽이 우선 소스) */
  brand: string | null;
  /** PC-NO (작업 자리) — 프린터 조회에는 안 쓰고, 인쇄 기록(label_print_logs)에만 남긴다 */
  stationNo: number;
  labelType: LabelType;
  /** 대상(성인/키즈)별 템플릿 — 모달의 드롭다운에서 확정된 값 */
  templates: AudienceTemplates;
  /** 기록용 담당자 */
  printedBy?: string | null;
}

export interface PrintLabelResult {
  success: boolean;
  printed: number;
  error?: string;
}

const audienceLabel = (a: LabelAudience) => LABEL_AUDIENCES.find((x) => x.key === a)?.label ?? a;
const typeLabel = (t: LabelType) => (t === 'care' ? '케어라벨' : '라벨 스티커');

/** 세트상품 병합 — 동일 product_no 중 최대 qty 1건만 (saveLabelData 와 동일) */
function mergeSets(items: { item: FtOrderItem; qty: number }[]) {
  const normal: typeof items = [];
  const setGroups = new Map<string, { item: FtOrderItem; qty: number }>();

  for (const entry of items) {
    const isSet = (entry.item.set_total ?? 0) > 1;
    const productNo = entry.item.product_no;
    if (isSet && productNo) {
      const existing = setGroups.get(productNo);
      if (!existing || entry.qty > existing.qty) setGroups.set(productNo, entry);
    } else {
      normal.push(entry);
    }
  }
  return [...normal, ...Array.from(setGroups.values())];
}

/**
 * 항목 → 라벨 바인딩 데이터 (saveLabelData 의 toLabelRow 와 같은 필드)
 * + 선택된 사업자 계정 정보(ACCOUNT_FIELDS, acc_ 접두사)도 같이 채운다.
 */
function toLabelData(
  item: FtOrderItem,
  qty: number,
  brand: string | null,
  selectedUser: FtUser | null | undefined
): LabelData {
  return {
    // selectedUser.brand 가 있으면 그게 더 최신 값이지만, brand 파라미터를 명시적으로
    // 넘긴 호출부(V2LabelModal 등)와의 하위 호환을 위해 brand 파라미터를 우선한다.
    brand: brand || selectedUser?.brand || null,
    item_name: [item.item_name, item.option_name].filter(Boolean).join(', '),
    barcode: item.barcode || '',
    product_no: item.item_no || '',
    shipment_size: resolveScanSizeCode(item.shipment_type, item.coupang_shipment_size),
    composition: item.composition || null,
    recommanded_age: item.recommanded_age || null,
    qty,
    ...accountFieldsToLabelData(selectedUser ?? null),
  };
}

// ============================================================
// 템플릿 자동 선택 — (사용자 + 종류 + 대상)
//   사용자 기본 → 공용 기본 → 사용자 첫째 → 공용 첫째. 그 대상을 가진 템플릿만 후보.
//   모달의 드롭다운 초기값이 이 결과다 (useLabelTemplatePlan).
// ============================================================
export function pickTemplate(
  templates: LabelTemplate[],
  userId: string | null,
  labelType: LabelType,
  audience: LabelAudience
): LabelTemplate | null {
  const candidates = templates.filter(
    (t) => t.label_type === labelType && templateHasAudience(t, audience)
  );
  const isSpecificallyFor = (t: LabelTemplate) =>
    !!t.user_ids && t.user_ids.length > 0 && userId != null && t.user_ids.includes(userId);
  const isShared = (t: LabelTemplate) => !t.user_ids || t.user_ids.length === 0;

  return (
    candidates.find((t) => t.is_default && isSpecificallyFor(t)) ??
    candidates.find((t) => t.is_default && isShared(t)) ??
    candidates.find((t) => isSpecificallyFor(t)) ??
    candidates.find((t) => isShared(t)) ??
    null
  );
}

/** 항목들을 대상별로 나눈다 — 항목이 없는 대상은 키가 없다 */
export function groupByAudience<T extends { item: Pick<FtOrderItem, 'recommanded_age'> }>(
  entries: T[]
): Partial<Record<LabelAudience, T[]>> {
  const out: Partial<Record<LabelAudience, T[]>> = {};
  for (const e of entries) {
    const a = audienceOfItem(e.item.recommanded_age);
    (out[a] ??= []).push(e);
  }
  return out;
}

export async function printLabels(params: PrintLabelParams): Promise<PrintLabelResult> {
  const { items, selectedUser, brand, stationNo, labelType, templates, printedBy } = params;

  if (items.length === 0) {
    return { success: false, printed: 0, error: '출력할 항목이 없습니다.' };
  }

  try {
    // ── 1) 세트 병합 → 대상별 분류 ──
    const merged = mergeSets(items);
    const byAudience = groupByAudience(merged);

    // ── 2) 대상마다 템플릿 확인 — 하나라도 없으면 아무것도 찍지 않는다 ──
    const missing = (Object.keys(byAudience) as LabelAudience[]).filter((a) => !templates[a]);
    if (missing.length > 0) {
      const names = missing.map(audienceLabel).join(', ');
      return {
        success: false,
        printed: 0,
        error:
          `${names} 상품에 쓸 ${typeLabel(labelType)} 템플릿이 없습니다.\n` +
          `[라벨 설정]에서 대상을 "${names}"로 둔 템플릿을 만들거나, 드롭다운에서 다른 템플릿을 고르세요.`,
      };
    }

    // ── 3) 템플릿(=프린터) 단위로 묶기 — 성인·키즈가 같은 템플릿이면 한 번에 ──
    const jobs = new Map<string, { template: LabelTemplate; rows: { item: FtOrderItem; qty: number }[] }>();
    for (const a of Object.keys(byAudience) as LabelAudience[]) {
      const template = templates[a]!;
      const job = jobs.get(template.id) ?? { template, rows: [] };
      job.rows.push(...byAudience[a]!);
      jobs.set(template.id, job);
    }

    // ── 4) 프린터 — 전부 먼저 확인 (반만 찍히는 일 방지) ──
    const printers = new Map<string, string>();
    for (const { template } of jobs.values()) {
      const printer = getLocalPrinter(template.id);
      if (!printer) {
        return {
          success: false,
          printed: 0,
          error: `"${template.name}" 템플릿에 이 PC 의 프린터가 지정되지 않았습니다.\n${LOCAL_PRINTER_HELP}`,
        };
      }
      printers.set(template.id, printer);
    }

    // ── 5) TSPL 생성 + QZ 인쇄 (템플릿별) ──
    for (const { template, rows } of jobs.values()) {
      await preloadTemplateAssets(template); // 이미지(세탁 기호)가 빠진 채 나가지 않게
      const bytes = buildTsplBatch(
        template,
        rows.map(({ item, qty }) => ({ data: toLabelData(item, qty, brand, selectedUser), copies: qty }))
      );
      await printRaw(printers.get(template.id)!, bytes);
    }

    // ── 6) 기록 (실패해도 인쇄 성공은 유지) ──
    try {
      const logItems = Array.from(jobs.values()).flatMap(({ template, rows }) =>
        rows.map(({ item, qty }) => ({
          template_id: template.id,
          order_item_id: item.id,
          barcode: item.barcode,
          item_name: [item.item_name, item.option_name].filter(Boolean).join(', '),
          qty,
          station_no: stationNo,
          label_type: labelType,
          printed_by: printedBy ?? null,
        }))
      );
      await fetch('/api/label-print-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: logItems }),
      });
    } catch (logErr) {
      console.error('인쇄 기록 저장 실패(무시):', logErr);
    }

    const totalSheets = merged.reduce((n, r) => n + r.qty, 0);
    return { success: true, printed: totalSheets };
  } catch (error) {
    console.error('라벨 인쇄 오류:', error);
    return {
      success: false,
      printed: 0,
      error: error instanceof Error ? `${QZ_NOT_RUNNING}\n\n(${error.message})` : QZ_NOT_RUNNING,
    };
  }
}
