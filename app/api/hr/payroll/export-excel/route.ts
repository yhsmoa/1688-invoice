import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import {
  calcSalary,
  fetchPayrollMonth,
  filterPayrollByRecords,
  parseYearMonth,
  type PayrollEmployee,
} from '../../../../../lib/payrollCalc';
import { fetchPaidItems } from '../../../../../lib/payrollPayments';

// ============================================================
// 급여장부 엑셀 다운로드 — [정리] 패널과 동일한 데이터
//
//   GET  ?year=YYYY&month=MM               → 해당 월 전체 ([엑셀])
//   GET  ?year=YYYY&month=MM&scope=unpaid  → 지급완료된 시간을 뺀 나머지 ([월급엑셀])
//   POST { year, month, recordIds[] }      → 선택한 출근기록만 ([부분엑셀])
//                                            이미 지급완료된 시간이 섞이면 거부 (이중 지급 방지)
//
//   조회·급여 계산은 lib/payrollCalc (급여장부·무역계좌와 공용)
// 컬럼(헤더 영문): Name | Korean Name | Position | Hourly Wage | Total Hours (h)
//                | Estimated Salary | Expense | Total Amount | Bank | Account No | TAX
//   - 조회 열      : 연한 회색 배경
//   - 입력 열      : 연한 주황색 배경 (Expense, TAX — 값 없이 공란)
//   - Total Amount : Estimated Salary + Expense 엑셀 수식 (입력 시 자동 반영)
//   - Total Hours  : 'h' 접미사 없이 숫자로 출력 (소수 1자리)
// ============================================================

// ── 분 → 시간(숫자, 소수 1자리) ─────────────────────────────
//    'h' 접미사 없이 숫자로 반환 → 엑셀에서 집계 가능
const minutesToHours = (m: number): number => Math.round(m / 6) / 10;

// ── 스타일 정의 ─────────────────────────────────────────────
const GRAY_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE5E7EB' },
};

const ORANGE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFDE8C8' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 11,
};

const CENTER_ALIGN: Partial<ExcelJS.Alignment> = {
  horizontal: 'center',
  vertical:   'middle',
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin' },
  left:   { style: 'thin' },
  bottom: { style: 'thin' },
  right:  { style: 'thin' },
};

const HEADERS = [
  'Name', 'Korean Name', 'Position', 'Hourly Wage', 'Total Hours (h)',
  'Estimated Salary', 'Expense', 'Total Amount', 'Bank', 'Account No', 'TAX',
];

// 입력 열(주황): G=Expense(7), K=TAX(11)
const INPUT_COLS = new Set([7, 11]);

// ── 엑셀 종류 — 시트명·파일명 표기만 다르고 컬럼은 같다 ──
type ExcelKind = 'full' | 'partial' | 'unpaid';

const KIND_LABEL: Record<ExcelKind, { sheet: string; file: string }> = {
  full:    { sheet: '급여',                file: '급여' },
  partial: { sheet: '급여 (부분)',         file: '급여_부분' },
  unpaid:  { sheet: '월급 (지급분 제외)', file: '월급' },
};

// ============================================================
// 워크북 생성 → 엑셀 응답
//   kind: 전체 / 부분 / 월급(지급분 제외) — KIND_LABEL 참고
// ============================================================
async function buildExcelResponse(
  year: number,
  month: number,
  employees: PayrollEmployee[],
  minutesMap: Map<string, number>,
  kind: ExcelKind
): Promise<NextResponse> {
  const workbook = new ExcelJS.Workbook();
  const label    = KIND_LABEL[kind];
  const ws       = workbook.addWorksheet(`${year}년 ${month}월 ${label.sheet}`);

  // ── 열 너비 설정 ──────────────────────────────────────────
  ws.columns = [
    { key: 'name',        width: 16 },  // A: Name
    { key: 'name_kr',     width: 14 },  // B: Korean Name
    { key: 'role',        width: 12 },  // C: Position
    { key: 'hourly_wage', width: 12 },  // D: Hourly Wage
    { key: 'total_hours', width: 14 },  // E: Total Hours (h)
    { key: 'salary',      width: 16 },  // F: Estimated Salary
    { key: 'expense',     width: 14 },  // G: Expense (입력)
    { key: 'total_amount',width: 16 },  // H: Total Amount (수식)
    { key: 'bank_name',   width: 14 },  // I: Bank
    { key: 'bank_no',     width: 22 },  // J: Account No
    { key: 'tax',         width: 16 },  // K: TAX (입력)
  ];

  // ── 헤더 행 추가 (영문) ───────────────────────────────────
  const headerRow = ws.addRow(HEADERS);
  headerRow.height = 22;

  for (let col = 1; col <= HEADERS.length; col++) {
    const cell     = headerRow.getCell(col);
    cell.fill      = INPUT_COLS.has(col) ? ORANGE_FILL : GRAY_FILL;
    cell.font      = HEADER_FONT;
    cell.alignment = CENTER_ALIGN;
    cell.border    = THIN_BORDER;
  }

  // ── 데이터 행 추가 ────────────────────────────────────────
  for (const emp of employees) {
    const totalMinutes = minutesMap.get(emp.id) ?? 0;
    const hourlyWage   = emp.hourly_wage ?? 0;
    const salary       = calcSalary(hourlyWage, totalMinutes);

    const dataRow = ws.addRow([
      emp.name || '-',
      emp.name_kr || '-',
      emp.role || '-',
      hourlyWage > 0 ? hourlyWage : '-',
      totalMinutes > 0 ? minutesToHours(totalMinutes) : '-',
      salary > 0 ? salary : 0,
      null, // Expense: 입력 공란 — 빈 문자열('')을 넣으면 텍스트 셀이 되어 수식이 #VALUE! 가 남
      null, // Total Amount: 아래에서 수식 지정
      emp.bank_name || '-',
      emp.bank_no || '-',
      null, // TAX: 입력 공란
    ]);
    dataRow.height = 20;

    // Total Amount(H) = Estimated Salary(F) + Expense(G)
    //   · Expense 를 나중에 입력해도 자동 반영되도록 수식으로 지정
    //   · SUM 사용: 빈 칸이나 텍스트가 들어가도 #VALUE! 없이 무시하고 계산
    const r = dataRow.number;
    dataRow.getCell(8).value = { formula: `SUM(F${r},G${r})`, result: salary > 0 ? salary : 0 };

    // 데이터 행 스타일
    dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.border    = THIN_BORDER;
      cell.alignment = CENTER_ALIGN;

      // 입력 열(Expense, TAX) 배경 연한 주황 유지
      if (INPUT_COLS.has(colNum)) {
        cell.fill = ORANGE_FILL;
      }
    });
  }

  // ── 버퍼로 변환 후 응답 ───────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();

  const namePart = `${year}년_${String(month).padStart(2, '0')}월_${label.file}.xlsx`;
  const filename = encodeURIComponent(namePart);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  });
}

// ============================================================
// GET — 해당 월 전체 급여 엑셀 / scope=unpaid 면 지급완료된 시간을 뺀 월급 엑셀
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // ── 파라미터 검증 ───────────────────────────────────────
    const ym = parseYearMonth(searchParams.get('year'), searchParams.get('month'));
    if (!ym) {
      return NextResponse.json(
        { success: false, error: 'year, month 파라미터가 필요합니다. (유효한 년도/월)' },
        { status: 400 }
      );
    }
    const { year, month } = ym;

    const scope = searchParams.get('scope');
    if (scope !== null && scope !== 'unpaid') {
      return NextResponse.json(
        { success: false, error: 'scope 는 unpaid 만 지원합니다.' },
        { status: 400 }
      );
    }

    // ── 출근기록 · 직원별 총 근무 분 · 직원 정보 (lib/payrollCalc) ──
    const monthData = await fetchPayrollMonth(year, month);

    if (monthData.records.length === 0) {
      return NextResponse.json(
        { success: false, error: '해당 월 근무 기록이 없습니다.' },
        { status: 404 }
      );
    }

    if (scope !== 'unpaid') {
      return await buildExcelResponse(year, month, monthData.employees, monthData.minutesByEmployee, 'full');
    }

    // ── [월급엑셀]: 지급완료된 출근기록을 빼고 남은 시간만 계산 ──
    const paidIds = new Set(
      (await fetchPaidItems(monthData.startDate, monthData.endDate)).map((p) => p.record_id)
    );
    const unpaid = filterPayrollByRecords(
      monthData,
      monthData.records.filter((r) => !paidIds.has(r.id)).map((r) => r.id)
    );

    if (unpaid.records.length === 0) {
      return NextResponse.json(
        { success: false, error: '지급하지 않은 근무 기록이 없습니다. (모두 지급완료)' },
        { status: 404 }
      );
    }

    return await buildExcelResponse(year, month, unpaid.employees, unpaid.minutesByEmployee, 'unpaid');

  } catch (error) {
    console.error('급여 엑셀 생성 오류:', error);
    return NextResponse.json(
      { success: false, error: '엑셀 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

// ============================================================
// POST — [부분엑셀]: 선택한 출근기록만 계산
//   body: { year, month, recordIds: string[] }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: '요청 본문이 올바르지 않습니다.' },
        { status: 400 }
      );
    }

    // ── 연·월 검증 ──────────────────────────────────────────
    const ym = parseYearMonth(String(body.year ?? ''), String(body.month ?? ''));
    if (!ym) {
      return NextResponse.json(
        { success: false, error: 'year, month 값이 필요합니다. (유효한 년도/월)' },
        { status: 400 }
      );
    }
    const { year, month } = ym;

    // ── 선택 기록 id 검증 (문자열만 · 중복 제거) ──────────────
    if (!Array.isArray(body.recordIds)) {
      return NextResponse.json(
        { success: false, error: 'recordIds 배열이 필요합니다.' },
        { status: 400 }
      );
    }
    const idSet = new Set<string>();
    for (const id of body.recordIds as unknown[]) {
      if (typeof id === 'string' && id.length > 0) idSet.add(id);
    }
    const recordIds: string[] = [...idSet];
    if (recordIds.length === 0) {
      return NextResponse.json(
        { success: false, error: '선택된 시간이 없습니다.' },
        { status: 400 }
      );
    }

    // ── 해당 월 조회 후 선택 기록만 필터 ─────────────────────
    const monthData = await fetchPayrollMonth(year, month);

    // 이미 지급완료된 시간이 섞이면 거부 — 부분엑셀로 같은 시간을 두 번 지급하지 않도록
    const paidIds = new Set(
      (await fetchPaidItems(monthData.startDate, monthData.endDate)).map((p) => p.record_id)
    );
    const paidPicked = recordIds.filter((id) => paidIds.has(id)).length;
    if (paidPicked > 0) {
      return NextResponse.json(
        { success: false, error: `이미 급여 지급완료된 시간 ${paidPicked}건이 선택되어 있습니다. 새로고침 후 다시 선택해 주세요.` },
        { status: 409 }
      );
    }

    const picked    = filterPayrollByRecords(monthData, recordIds);

    if (picked.records.length === 0) {
      return NextResponse.json(
        { success: false, error: '선택한 시간에 해당하는 근무 기록이 없습니다.' },
        { status: 404 }
      );
    }

    return await buildExcelResponse(year, month, picked.employees, picked.minutesByEmployee, 'partial');

  } catch (error) {
    console.error('급여 부분 엑셀 생성 오류:', error);
    return NextResponse.json(
      { success: false, error: '엑셀 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
