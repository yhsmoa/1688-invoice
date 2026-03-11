import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// GET /api/hr/payroll/export-excel?year=YYYY&month=MM
//
// 급여장부 엑셀 다운로드
// 컬럼: name | id (신분증) | salary | Income tax
//   - name ~ salary: 연한 회색 배경
//   - Income tax:    연한 주황색 배경 (입력 공간, 값 없음)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam  = searchParams.get('year');
    const monthParam = searchParams.get('month');

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

    // ── 1. 해당 월 출퇴근 기록으로 직원 ID 목록 수집 ────────────
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

    // ── 2. 직원별 총 근무 분 집계 ────────────────────────────────
    const minutesMap = new Map<string, number>();
    for (const rec of records) {
      const prev = minutesMap.get(rec.employee_id) ?? 0;
      minutesMap.set(rec.employee_id, prev + (rec.total_minutes ?? 0));
    }

    // ── 3. 직원 정보 조회 (identification 포함) ──────────────────
    const employeeIds = [...minutesMap.keys()];

    const { data: employees, error: empErr } = await supabase
      .from('invoiceManager_employees')
      .select('id, name, name_kr, identification, hourly_wage')
      .in('id', employeeIds)
      .order('name');

    if (empErr) throw empErr;

    // ── 4. ExcelJS 워크북 생성 ────────────────────────────────────
    const workbook  = new ExcelJS.Workbook();
    const sheetName = `${year}년 ${month}월 급여`;
    const ws        = workbook.addWorksheet(sheetName);

    // ── 5. 열 너비 설정 ──────────────────────────────────────────
    ws.columns = [
      { key: 'name',        width: 18 },  // A: 이름
      { key: 'id',          width: 22 },  // B: 신분증 ID
      { key: 'salary',      width: 16 },  // C: 총급여
      { key: 'income_tax',  width: 16 },  // D: Income tax
    ];

    // ── 6. 헤더 행 스타일 정의 ───────────────────────────────────
    const GRAY_FILL: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE5E7EB' }, // 연한 회색
    };

    const ORANGE_FILL: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFDE8C8' }, // 연한 주황
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

    // ── 7. 헤더 행 추가 ──────────────────────────────────────────
    const headerRow = ws.addRow(['name', 'id', 'salary', 'Income tax']);
    headerRow.height = 22;

    const grayHeaders  = [1, 2, 3]; // A, B, C
    const orangeHeader = [4];        // D

    grayHeaders.forEach((col) => {
      const cell    = headerRow.getCell(col);
      cell.fill     = GRAY_FILL;
      cell.font     = HEADER_FONT;
      cell.alignment = CENTER_ALIGN;
      cell.border   = THIN_BORDER;
    });

    orangeHeader.forEach((col) => {
      const cell    = headerRow.getCell(col);
      cell.fill     = ORANGE_FILL;
      cell.font     = HEADER_FONT;
      cell.alignment = CENTER_ALIGN;
      cell.border   = THIN_BORDER;
    });

    // ── 8. 데이터 행 추가 ─────────────────────────────────────────
    for (const emp of employees ?? []) {
      const totalMinutes = minutesMap.get(emp.id) ?? 0;
      const hourlyWage   = emp.hourly_wage ?? 0;
      const salary       = hourlyWage > 0 && totalMinutes > 0
        ? Math.floor((hourlyWage * totalMinutes) / 60)
        : 0;

      // 이름: 한글명 우선 (없으면 영문명)
      const displayName = emp.name_kr || emp.name || '-';

      const dataRow = ws.addRow([
        displayName,
        emp.identification ?? '',
        salary > 0 ? salary : '',
        '', // Income tax: 입력 공란
      ]);
      dataRow.height = 20;

      // 데이터 행 스타일 (테두리 + 정렬)
      dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.border    = THIN_BORDER;
        cell.alignment = colNum === 1
          ? { horizontal: 'left',   vertical: 'middle' }  // 이름: 왼쪽
          : { horizontal: 'center', vertical: 'middle' };  // 나머지: 가운데

        // Income tax 열 배경 연한 주황 유지
        if (colNum === 4) {
          cell.fill = ORANGE_FILL;
        }
      });
    }

    // ── 9. 버퍼로 변환 후 응답 ───────────────────────────────────
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
