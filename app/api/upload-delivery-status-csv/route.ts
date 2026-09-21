import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';

// ============================================================
// POST /api/upload-delivery-status-csv
// 배송상황 CSV 업로드 → im_1688_orders_delivery_status 테이블 저장
// 업로드 시 기존 데이터 전체 삭제 후 새 데이터 삽입
//
// ── 검증을 삭제보다 먼저 하는 이유 ─────────────────────────
// 전체 삭제 → 삽입 구조라, 깨진 파일을 올리면 정상 데이터가 통째로
// 쓰레기 값으로 바뀐다. (실제 사례: 2026-09-02 파일은 물류상태 열에
// 화면 버튼 글자 '订单详情' 이 섞여 들어와 배송완료 판별이 불가능했음)
// → 헤더·내용 검증을 모두 통과한 경우에만 삭제를 시작한다.
//
// ── 열은 위치가 아니라 헤더 이름으로 찾는다 ────────────────
// 수집기 버전마다 열 구성이 다르다.
//   구: 탭,주문번호,주문일시,주문상태,상태,상세내용,환불상태
//   신: 탭,주문번호,주문일시,주문상태,물류상태,상세내용,택배사,송장번호
// ============================================================

// ── 헤더 이름 → 저장 필드 (별칭은 앞에 있는 것이 우선) ──
const HEADER_ALIASES = {
  order_status:    ['탭'],
  order_no:        ['주문번호'],
  timestamp:       ['주문일시'],
  status_details:  ['주문상태'],
  delivery_status: ['물류상태', '상태'],
  description:     ['상세내용'],
  courier:         ['택배사'],
  tracking_no:     ['송장번호'],
} as const;

type Field = keyof typeof HEADER_ALIASES;

/** 없으면 업로드를 거부하는 열 */
const REQUIRED_FIELDS: Field[] = ['order_no', 'delivery_status'];

/**
 * 수집기가 물류상태 대신 화면 블록을 통째로 긁었을 때 섞여 드는 버튼 글자.
 * 정상 상태 값에는 절대 나오지 않으므로 발견 즉시 파일 전체를 거부한다.
 */
const SCRAPE_ERROR_MARKER = '订单详情';

const BATCH = 50;

interface DeliveryRow {
  order_status: string | null;
  '1688_order_no': string;
  timestamp: string | null;
  status_details: string | null;
  delivery_status: string | null;
  description: string | null;
  courier: string | null;
  tracking_no: string | null;
}

// ============================================================
// 헬퍼
// ============================================================

/** 줄바꿈·연속 공백을 한 칸으로, 앞뒤 공백·BOM 제거 */
const clean = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/^﻿/, '').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};

/** 헤더 행에서 필드별 열 위치 찾기 (없으면 -1) */
function resolveColumns(header: unknown[]): Record<Field, number> {
  const names = header.map((h) => clean(h) ?? '');
  const out = {} as Record<Field, number>;
  (Object.keys(HEADER_ALIASES) as Field[]).forEach((field) => {
    out[field] = -1;
    for (const alias of HEADER_ALIASES[field]) {
      const idx = names.indexOf(alias);
      if (idx !== -1) { out[field] = idx; break; }
    }
  });
  return out;
}

/**
 * 1688 주문일시는 중국 표준시(UTC+8) 기준.
 * 시간대 표기 없이 new Date() 에 넘기면 서버 시간대(로컬 KST / Railway UTC)에
 * 따라 저장값이 달라지므로 오프셋을 명시한다.
 */
const CN_UTC_OFFSET = '+08:00';
/** 화면 크롤러(v2): '2026-09-19 11:10' / '2026-08-25 15:27:35' */
const CSV_DATETIME_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;
/** API 크롤러(v3) gmtCreate 대비: '20260919111023000+0800' (밀리초·오프셋 생략 가능) */
const CSV_COMPACT_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{0,3}([+-]\d{2})(\d{2})?$|^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{0,3}$/;

/** 1688 주문일시 (중국시간) → ISO. 형식이 다르면 null */
function parseTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  const pad = (v: string | undefined) => (v ?? '0').padStart(2, '0');
  let iso: string | null = null;

  const m = raw.match(CSV_DATETIME_RE);
  if (m) {
    iso = `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${pad(m[6])}${CN_UTC_OFFSET}`;
  } else {
    const c = raw.match(CSV_COMPACT_RE);
    if (c && c[1]) {
      iso = `${c[1]}-${c[2]}-${c[3]}T${c[4]}:${c[5]}:${c[6]}${c[7]}:${c[8] ?? '00'}`;
    } else if (c) {
      iso = `${c[9]}-${c[10]}-${c[11]}T${c[12]}:${c[13]}:${c[14]}${CN_UTC_OFFSET}`;
    }
  }
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

// ============================================================
// POST
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // ── 1) FormData에서 CSV 파일 수신 ──
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return fail('파일이 업로드되지 않았습니다.');

    // ── 2) 파일 확장자 검증 ──
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return fail('CSV 파일(.csv)만 업로드 가능합니다.');
    }

    // ── 3) 파싱 — raw: true 로 값을 글자 그대로 읽는다 ──
    //   기본 설정은 '2026-09-19 11:10' 같은 값을 날짜로 추정해 '9/19/26' 로
    //   바꿔버려 시간이 사라진다. 주문번호(19자리)도 숫자 변환 위험이 있다.
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as unknown[][];

    if (jsonData.length < 2) return fail('데이터가 없습니다. CSV 파일 내용을 확인해주세요.');

    // ── 4) 헤더 검증 (삭제 전) ──
    const col = resolveColumns(jsonData[0] ?? []);
    const missing = REQUIRED_FIELDS.filter((f) => col[f] === -1);
    if (missing.length > 0) {
      const labels = missing.map((f) => HEADER_ALIASES[f].join(' 또는 '));
      return fail(`CSV 형식이 올바르지 않습니다. 필요한 열이 없습니다: ${labels.join(', ')}`, 400, {
        header: (jsonData[0] ?? []).map((h) => clean(h)),
      });
    }

    const pick = (row: unknown[], field: Field) => (col[field] === -1 ? null : clean(row[col[field]]));

    // ── 5) 행 변환 ──
    const rows: DeliveryRow[] = [];
    for (const row of jsonData.slice(1)) {
      if (!row || row.length === 0) continue;
      const orderNo = pick(row, 'order_no');
      if (!orderNo) continue;

      rows.push({
        order_status: pick(row, 'order_status'),
        '1688_order_no': orderNo,
        timestamp: parseTimestamp(pick(row, 'timestamp')),
        status_details: pick(row, 'status_details'),
        delivery_status: pick(row, 'delivery_status'),
        description: pick(row, 'description'),
        courier: pick(row, 'courier'),
        tracking_no: pick(row, 'tracking_no'),
      });
    }

    if (rows.length === 0) return fail('유효한 데이터가 없습니다. CSV 파일 내용을 확인해주세요.');

    // ── 6) 내용 검증 (삭제 전) — 수집 오류 파일 거부 ──
    const broken = rows.filter(
      (r) => r.delivery_status?.includes(SCRAPE_ERROR_MARKER) || r.status_details?.includes(SCRAPE_ERROR_MARKER)
    );
    if (broken.length > 0) {
      return fail(
        `수집이 잘못된 파일입니다. 물류상태에 '${SCRAPE_ERROR_MARKER}' 가 섞인 행이 ${broken.length}/${rows.length}건 있습니다. ` +
          '기존 데이터는 그대로 유지했습니다. 1688 배송상황을 다시 수집해 주세요.',
        400,
        { brokenCount: broken.length, total: rows.length, sample: broken[0]['1688_order_no'] }
      );
    }

    // ── 7) 기존 데이터 전체 삭제 ──
    const { error: deleteError } = await supabase
      .from('im_1688_orders_delivery_status')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) {
      return fail('기존 데이터 삭제 중 오류가 발생했습니다.', 500, { details: deleteError.message });
    }

    // ── 8) 새 데이터 배치 삽입 ──
    let savedCount = 0;
    let errorCount = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('im_1688_orders_delivery_status')
        .insert(batch)
        .select('id');

      if (error) {
        console.error(`배송상황 CSV 배치 ${Math.floor(i / BATCH) + 1} 저장 오류:`, error);
        errorCount += batch.length;
      } else {
        savedCount += data?.length || 0;
      }
    }

    // ── 9) 결과 반환 ──
    return NextResponse.json({
      success: true,
      message: `배송상황 CSV 업로드 완료 (${savedCount}개 저장)`,
      count: rows.length,
      savedCount,
      errorCount,
    });
  } catch (error) {
    console.error('배송상황 CSV 업로드 오류:', error);
    return fail('CSV 파일 처리 중 오류가 발생했습니다.', 500, {
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
