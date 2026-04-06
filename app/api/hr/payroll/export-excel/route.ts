import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// GET /api/hr/payroll/export-excel?year=YYYY&month=MM
//
// 급여장부 엑셀 다운로드 — [정리] 패널과 동일한 데이터
// 컬럼: 이름 | 한글명 | 시급 | 총 근무 | 예상 급여 | 은행 | 계좌번호 | TAX
//   - 이름 ~ 계좌번호: 연한 회색 배경
//   - TAX:             연한 주황색 배경 (입력 공간, 값 없음)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam  = searchParams.get('year');
    const monthParam = searchParams.get('month');

    // ── 1. 파라미터 검증 ───────────────────────────────────────
    if (!yearParam || !monthParam) {
      return NextResponse.json(
        { success: false, error: 'year, month 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    const year  = parseInt(yearParam,  10);
    const month = parseInt(monthParam, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 년도/월입니다.' },
        { status: 400 }
      );
    }

    // ── 2. 해당 월 출퇴근 기록 조회 ────────────────────────────
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate   = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate     = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    const { data: records, error: recErr } = await supabase
      .from('invoiceManager_emplyee_records')
      .select('employee_id, total_minutes')
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .not('clock_in', 'is', null);

    if (recErr) throw recErr;

    if (!records || records.length === 0) {
      return NextResponse.json(
        { success: false, error: '해당 월 근무 기록이 없습니다.' },
        { status: 404 }
      );
    }

    // ── 3. 직원별 총 근무 분 집계 ──────────────────────────────
    const minutesMap = new Map<string, number>();
    for (const rec of records) {
      const prev = minutesMap.get(rec.employee_id) ?? 0;
      minutesMap.set(rec.employee_id, prev + (rec.total_minutes ?? 0));
    }

    // ── 4. 직원 정보 조회 (은행, 계좌 포함) ────────────────────
    const employeeIds = [...minutesMap.keys()];

    const { data: employees, error: empErr } = await supabase
      .from('invoiceManager_employees')
      .select('id, name, name_kr, hourly_wage, bank_name, bank_no')
      .in('id', employeeIds)
      .order('name');

    if (empErr) throw empErr;

    // ── 5. 유틸: 분 → 시간 변환 (정리 패널과 동일 로직) ────────
    const minutesToHours = (m: number): string => {
      const h = Math.floor(m / 60);
      const rem = m % 60;
      return rem === 0 ? `${h}h` : `${h}.${Math.round((rem / 60) * 10)}h`;
    };

    // ── 6. ExcelJS 워크북 생성 ─────────────────────────────────
    const workbook  = new ExcelJS.Workbook();
    const sheetName = `${year}년 ${month}월 급여`;
    const ws        = workbook.addWorksheet(sheetName);

    // ── 7. 열 너비 설정 ────────────────────────────────────────
    ws.columns = [
      { key: 'name',        width: 16 },  // A: 이름
      { key: 'name_kr',     width: 14 },  // B: 한글명
      { key: 'hourly_wage', width: 12 },  // C: 시급
      { key: 'total_hours', width: 12 },  // D: 총 근무
      { key: 'salary',      width: 16 },  // E: 예상 급여
      { key: 'bank_name',   width: 14 },  // F: 은행
      { key: 'bank_no',     width: 22 },  // G: 계좌번호
      { key: 'tax',         width: 16 },  // H: TAX
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

    // ── 9. 헤더 행 추가 ────────────────────────────────────────
    const headers = ['이름', '한글명', '시급', '총 근무', '예상 급여', '은행', '계좌번호', 'TAX'];
    const headerRow = ws.addRow(headers);
    headerRow.height = 22;

    // A~G: 회색 배경
    for (let col = 1; col <= 7; col++) {
      const cell      = headerRow.getCell(col);
      cell.fill       = GRAY_FILL;
      cell.font       = HEADER_FONT;
      cell.alignment  = CENTER_ALIGN;
      cell.border     = THIN_BORDER;
    }

    // H: TAX 주황색 배경
    const taxHeaderCell     = headerRow.getCell(8);
    taxHeaderCell.fill      = ORANGE_FILL;
    taxHeaderCell.font      = HEADER_FONT;
    taxHeaderCell.alignment = CENTER_ALIGN;
    taxHeaderCell.border    = THIN_BORDER;

    // ── 10. 데이터 행 추가 ──────────────────────────────────────
    for (const emp of employees ?? []) {
      const totalMinutes = minutesMap.get(emp.id) ?? 0;
      const hourlyWage   = emp.hourly_wage ?? 0;
      const salary       = hourlyWage > 0 && totalMinutes > 0
        ? Math.floor((hourlyWage * totalMinutes) / 60)
        : 0;

      const dataRow = ws.addRow([
        emp.name || '-',
        emp.name_kr || '-',
        hourlyWage > 0 ? hourlyWage : '-',
        totalMinutes > 0 ? minutesToHours(totalMinutes) : '-',
        salary > 0 ? salary : '',
        emp.bank_name || '-',
        emp.bank_no || '-',
        '', // TAX: 입력 공란
      ]);
      dataRow.height = 20;

      // 데이터 행 스타일
      dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.border    = THIN_BORDER;
        cell.alignment = CENTER_ALIGN;

        // TAX 열 배경 연한 주황 유지
        if (colNum === 8) {
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
