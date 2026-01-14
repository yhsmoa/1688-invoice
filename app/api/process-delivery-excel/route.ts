import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

// 사업자 코드 매핑
const BUSINESS_CODE_MAP: Record<string, string> = {
  'BZ': '아이엠몽',
  'BO': '설온',
  'HI': '안녕릴리',
  'MB': '무드베이지'
};

// 특수 위치 (P, X)에서 사용할 정보
const SPECIAL_LOCATION_INFO = {
  name: '', // A열 값 참조
  phone: '010-6762-3066',
  address: '대구광역시 동구 신평로 121'
};

// 특수 위치를 사용하는 사업자
const SPECIAL_LOCATION_BUSINESSES = ['아이엠몽', '설온'];

interface BoxData {
  location: string;
  size: string;
  prefix: string;      // BZ-A
  section: string;     // A, B, C, P, X
  number: number;      // 01, 02, ...
  businessCode: string; // BZ, BO, ...
}

// 박스 위치 파싱 (예: BZ-A-01)
function parseLocation(location: string): { prefix: string; section: string; number: number; businessCode: string } | null {
  const match = location.match(/^([A-Z]{2})-([A-Z])-(\d+)$/);
  if (!match) return null;
  return {
    businessCode: match[1],
    prefix: `${match[1]}-${match[2]}`,
    section: match[2],
    number: parseInt(match[3], 10)
  };
}

// 연속 번호 그룹화 (예: 01,02,03,06,07 -> [[1,2,3],[6,7]])
function groupConsecutiveNumbers(numbers: number[]): number[][] {
  if (numbers.length === 0) return [];

  const sorted = [...numbers].sort((a, b) => a - b);
  const groups: number[][] = [];
  let currentGroup: number[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);

  return groups;
}

// 그룹을 문자열로 변환 (예: [1,2,3] -> "01 ~ 03")
function formatNumberGroup(prefix: string, group: number[]): string {
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (group.length === 1) {
    return `${prefix}-${pad(group[0])}`;
  }
  return `${prefix}-${pad(group[0])} ~ ${pad(group[group.length - 1])}`;
}

// 박스 데이터를 마킹별로 그룹화
function groupBoxesByMarking(boxes: BoxData[]): { marking: string; count: number; section: string; businessName: string }[] {
  // prefix별로 그룹화
  const prefixGroups: Record<string, BoxData[]> = {};

  boxes.forEach(box => {
    if (!prefixGroups[box.prefix]) {
      prefixGroups[box.prefix] = [];
    }
    prefixGroups[box.prefix].push(box);
  });

  const result: { marking: string; count: number; section: string; businessName: string }[] = [];

  Object.entries(prefixGroups).forEach(([prefix, boxList]) => {
    const numbers = boxList.map(b => b.number);
    const groups = groupConsecutiveNumbers(numbers);
    const businessCode = boxList[0].businessCode;
    const businessName = BUSINESS_CODE_MAP[businessCode] || businessCode;
    const section = boxList[0].section;

    groups.forEach(group => {
      result.push({
        marking: formatNumberGroup(prefix, group),
        count: group.length,
        section,
        businessName
      });
    });
  });

  return result;
}

// 사이즈별로 박스 그룹화 (연속 번호 고려)
function groupBoxesBySize(boxes: BoxData[]): { size: string; markings: string[] }[] {
  // 사이즈별로 먼저 그룹화
  const sizeGroups: Record<string, BoxData[]> = {};

  boxes.forEach(box => {
    if (!sizeGroups[box.size]) {
      sizeGroups[box.size] = [];
    }
    sizeGroups[box.size].push(box);
  });

  const result: { size: string; markings: string[] }[] = [];

  Object.entries(sizeGroups).forEach(([size, boxList]) => {
    // 동일 사이즈 내에서 prefix별로 그룹화
    const prefixGroups: Record<string, BoxData[]> = {};

    boxList.forEach(box => {
      if (!prefixGroups[box.prefix]) {
        prefixGroups[box.prefix] = [];
      }
      prefixGroups[box.prefix].push(box);
    });

    const markings: string[] = [];

    Object.entries(prefixGroups).forEach(([prefix, prefixBoxes]) => {
      const numbers = prefixBoxes.map(b => b.number);
      const groups = groupConsecutiveNumbers(numbers);

      groups.forEach(group => {
        markings.push(formatNumberGroup(prefix, group));
      });
    });

    result.push({ size, markings });
  });

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ success: false, error: '파일이 없습니다.' }, { status: 400 });
    }

    // 엑셀 파일 읽기
    const arrayBuffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    // 시트 찾기 - '품목별' 시트
    const itemSheet = workbook.getWorksheet('품목별');
    if (!itemSheet) {
      return NextResponse.json({ success: false, error: '품목별 시트를 찾을 수 없습니다.' }, { status: 400 });
    }

    console.log('사용 시트:', itemSheet.name);

    // 박스 데이터 수집 (마킹: F열(6), 사이즈: I열(9) - 9행부터 데이터 시작)
    // 셀 병합된 경우를 위해 마지막 유효값 추적
    const boxDataMap: Map<string, BoxData> = new Map();
    let lastValidMarking = '';
    let lastValidSize = '';

    // 디버깅: 처음 몇 행 출력
    console.log('=== 엑셀 데이터 디버깅 ===');
    itemSheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 12) {
        const fVal = row.getCell(6).value;
        const iVal = row.getCell(9).value;
        console.log(`행 ${rowNumber}: F열="${fVal}", I열="${iVal}"`);
      }
    });

    itemSheet.eachRow((row, rowNumber) => {
      if (rowNumber < 9) return; // 1~8행은 헤더 영역, 9행부터 데이터

      // F열(마킹) - 병합 셀의 경우 첫 행에만 값이 있음
      const markingCell = row.getCell(6);
      const markingValue = String(markingCell.value || '').trim();
      if (markingValue) {
        lastValidMarking = markingValue;
      }

      // I열(사이즈) - 병합 셀의 경우 첫 행에만 값이 있음
      const sizeCell = row.getCell(9);
      const sizeValue = String(sizeCell.value || '').trim();
      if (sizeValue) {
        lastValidSize = sizeValue;
      }

      // 마킹이 없으면 스킵
      if (!lastValidMarking) return;

      // 이미 처리된 마킹이면 스킵
      if (boxDataMap.has(lastValidMarking)) return;

      const parsed = parseLocation(lastValidMarking);
      if (!parsed) {
        console.log(`파싱 실패: "${lastValidMarking}"`);
        return;
      }

      boxDataMap.set(lastValidMarking, {
        location: lastValidMarking,
        size: lastValidSize || '미입력',
        prefix: parsed.prefix,
        section: parsed.section,
        number: parsed.number,
        businessCode: parsed.businessCode
      });
    });

    console.log('수집된 박스 수:', boxDataMap.size);

    const boxes = Array.from(boxDataMap.values());

    if (boxes.length === 0) {
      return NextResponse.json({ success: false, error: '유효한 박스 데이터가 없습니다.' }, { status: 400 });
    }

    // 결과 워크북 생성
    const resultWorkbook = new ExcelJS.Workbook();

    // ========== 출고정리 시트 ==========
    const deliverySheet = resultWorkbook.addWorksheet('출고정리');

    // 헤더 설정
    const deliveryHeaders = ['사업자명', '마킹', 'CTN', '받는사람', '연락처', '주소', '진행방법', '출고번호건'];
    deliverySheet.getRow(1).values = deliveryHeaders;

    // 헤더 스타일
    deliverySheet.getRow(1).eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // 열 너비 설정
    deliverySheet.columns = [
      { width: 12 }, // 사업자명
      { width: 18 }, // 마킹
      { width: 8 },  // CTN
      { width: 12 }, // 받는사람
      { width: 15 }, // 연락처
      { width: 30 }, // 주소
      { width: 15 }, // 진행방법
      { width: 12 }  // 출고번호건
    ];

    // 마킹별 그룹화된 데이터
    const markingGroups = groupBoxesByMarking(boxes);

    // 데이터 입력
    let deliveryRow = 2;
    const deliveryStartRow = 2;

    markingGroups.forEach(group => {
      const row = deliverySheet.getRow(deliveryRow);
      const isSpecialLocation = group.section === 'P' || group.section === 'X';
      const useSpecialInfo = isSpecialLocation && SPECIAL_LOCATION_BUSINESSES.includes(group.businessName);

      // 섹션에 따라 진행방법 결정: X는 '이우 합배송', 나머지(A,B,C,P 등)는 '롯데택배 신용'
      const deliveryMethod = group.section === 'X' ? '이우 합배송' : '롯데택배 신용';

      row.values = [
        group.businessName,                                    // A: 사업자명
        group.marking,                                         // B: 마킹
        group.count,                                           // C: CTN
        useSpecialInfo ? group.businessName : '',             // D: 받는사람
        useSpecialInfo ? SPECIAL_LOCATION_INFO.phone : '',    // E: 연락처
        useSpecialInfo ? SPECIAL_LOCATION_INFO.address : '',  // F: 주소
        deliveryMethod,                                        // G: 진행방법
        ''                                                     // H: 출고번호건
      ];

      // 스타일 적용
      row.eachCell((cell, colNumber) => {
        // A, B열은 좌측정렬, 나머지는 중앙정렬
        cell.alignment = {
          horizontal: colNumber <= 2 ? 'left' : 'center',
          vertical: 'middle'
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      deliveryRow++;
    });

    // H열 병합 및 노란색 배경
    const deliveryEndRow = deliveryRow - 1;
    if (deliveryEndRow >= deliveryStartRow) {
      deliverySheet.mergeCells(`H${deliveryStartRow}:H${deliveryEndRow}`);
      const hCell = deliverySheet.getCell(`H${deliveryStartRow}`);
      hCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFF00' }
      };
      hCell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    }

    // ========== 사이즈 시트 ==========
    const sizeSheet = resultWorkbook.addWorksheet('사이즈');

    // 헤더 설정
    const sizeHeaders = ['상자사이즈', '박스마킹'];
    sizeSheet.getRow(1).values = sizeHeaders;

    // 헤더 스타일
    sizeSheet.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // 열 너비 설정
    sizeSheet.columns = [
      { width: 15 }, // 상자사이즈
      { width: 20 }  // 박스마킹
    ];

    // 사이즈별 그룹화된 데이터
    const sizeGroups = groupBoxesBySize(boxes);

    // 데이터 입력 및 셀 병합
    let sizeRow = 2;

    sizeGroups.forEach(group => {
      const startRow = sizeRow;

      group.markings.forEach((marking, index) => {
        const row = sizeSheet.getRow(sizeRow);
        row.values = [
          index === 0 ? group.size : '', // A: 상자사이즈 (첫 행만)
          marking                         // B: 박스마킹
        ];

        // 스타일 적용
        row.eachCell((cell, colNumber) => {
          // B열(박스마킹)은 좌측정렬
          cell.alignment = {
            horizontal: colNumber === 2 ? 'left' : 'center',
            vertical: 'middle'
          };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });

        sizeRow++;
      });

      // A열 병합 (사이즈가 같은 행들)
      const endRow = sizeRow - 1;
      if (endRow > startRow) {
        sizeSheet.mergeCells(`A${startRow}:A${endRow}`);
      }
    });

    // 엑셀 버퍼 생성
    const buffer = await resultWorkbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="delivery_organized_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx"`
      }
    });

  } catch (error) {
    console.error('택배사 정리 엑셀 처리 오류:', error);
    return NextResponse.json(
      { success: false, error: '엑셀 파일 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
