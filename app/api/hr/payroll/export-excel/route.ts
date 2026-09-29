import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { calcSalary, fetchPayrollMonth, parseYearMonth } from '../../../../../lib/payrollCalc';

// ============================================================
// GET /api/hr/payroll/export-excel?year=YYYY&month=MM
//
// 급여장부 엑셀 다운로드 — [정리] 패널과 동일한 데이터
//   조회·급여 계산은 lib/payrollCalc (급여장부·무역계좌와 공용)
// 컬럼(헤더 영문): Name | Korean Name | Position | Hourly Wage | Total Hours (h)
//                | Estimated Salary | Expense | Total Amount | Bank | Account No | TAX
//   - 조회 열      : 연한 회색 배경
//   - 입력 열      : 연한 주황색 배경 (Expense, TAX — 값 없이 공란)
//   - Total Amount : Estimated Salary + Expense 엑셀 수식 (입력 시 자동 반영)
//   - Total Hours  : 'h' 접미사 없이 숫자로 출력 (소수 1자리)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam  = searchParams.get('year');
    const monthParam = searchParams.get('month');

    // ── 1. 파라미터 검증 ───────────────────────────────────────
    const ym = parseYearMonth(yearParam, monthParam);
    if (!ym) {
      return NextResponse.json(
        { success: false, error: 'year, month 파라미터가 필요합니다. (유효한 년도/월)' },
        { status: 400 }
      );
    }
    const { year, month } = ym;

    // ── 2~4. 출근기록 · 직원별 총 근무 분 · 직원 정보 (lib/payrollCalc) ──
    const { records, employees, minutesByEmployee: minutesMap } = await fetchPayrollMonth(year, month);

    if (records.length === 0) {
      return NextResponse.json(
        { success: false, error: '해당 월 근무 기록이 없습니다.' },
        { status: 404 }
      );
    }

    // ── 5. 유틸: 분 → 시간(숫자, 소수 1자리) ───────────────────
    //    'h' 접미사 없이 숫자로 반환 → 엑셀에서 집계 가능
    const minutesToHours = (m: number): number => Math.round(m / 6) / 10;

    // ── 6. ExcelJS 워크북 생성 ─────────────────────────────────
    const workbook  = new ExcelJS.Workbook();
    const sheetName = `${year}년 ${month}월 급여`;
    const ws        = workbook.addWorksheet(sheetName);

    // ── 7. 열 너비 설정 ────────────────────────────────────────
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

    // ── 8. 스타일 정의 ─────────────────────────────────────────
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

    // ── 9. 헤더 행 추가 (영문) ─────────────────────────────────
    const headers = [
      'Name', 'Korean Name', 'Position', 'Hourly Wage', 'Total Hours (h)',
      'Estimated Salary', 'Expense', 'Total Amount', 'Bank', 'Account No', 'TAX',
    ];
    // 입력 열(주황): G=Expense(7), K=TAX(11)
    const INPUT_COLS = new Set([7, 11]);

    const headerRow = ws.addRow(headers);
    headerRow.height = 22;

    for (let col = 1; col <= headers.length; col++) {
      const cell     = headerRow.getCell(col);
      cell.fill      = INPUT_COLS.has(col) ? ORANGE_FILL : GRAY_FILL;
      cell.font      = HEADER_FONT;
      cell.alignment = CENTER_ALIGN;
      cell.border    = THIN_BORDER;
    }

    // ── 10. 데이터 행 추가 ──────────────────────────────────────
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

    // ── 11. 버퍼로 변환 후 응답 ────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();

    const filename = encodeURIComponent(`${year}년_${String(month).padStart(2, '0')}월_급여.xlsx`);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    });

  } catch (error) {
    console.error('급여 엑셀 생성 오류:', error);
    return NextResponse.json(
      { success: false, error: '엑셀 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
