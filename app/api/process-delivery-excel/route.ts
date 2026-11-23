import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { fetchIn, formatPhone } from '../ft/storage/storageShared';

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

// 진행방법 문구
const METHOD_COURIER = '롯데택배 신용';
const METHOD_YIWU_MERGE = '이우 합배송';
const METHOD_DIRECT = '직접 처리';

/** 와우출고 상자의 받는 곳 (쿠팡 물류센터) */
interface WowRecipient {
  center: string;
  phone: string;
  address: string;
}

interface BoxData {
  location: string;
  size: string;
  prefix: string;      // BZ-A
  section: string;     // A, B, C, P, X
  number: number;      // 01, 02, ...
  businessCode: string; // BZ, BO, ...
  wow: boolean;        // 와우출고 마킹 상자인가
  recipient: WowRecipient | null; // 받는 곳이 하나인 와우출고 상자만 (그 밖은 null)
}

interface MarkingGroup {
  marking: string;
  count: number;
  section: string;
  businessName: string;
  wow: boolean;
  recipient: WowRecipient | null;
}

// ============================================================
// 와우출고 상자의 받는 곳 조회
//   마킹(상자 코드) → 출고 전 마킹 상자(ft_box_info) → 그 상자에 든 와우 박스(ft_wow_boxes)
//     큰 박스는 와우 박스 하나, 마대는 여러 개 (supabase/storage/010_wow_flow.sql)
//     · 받는 곳이 하나면 그 센터를 적는다
//     · 한 마대에 센터가 여럿이면 받는 곳은 비우고 진행방법에 '직접 처리' 라고만 적는다
//   · 상자 코드는 출고 후 다시 쓰이므로(BR-X-10 등) 출고 전(shipment_id 없음) 상자만 본다
//     → 택배사 정리는 쉽먼트 출고 처리 전에 받아야 센터 정보가 들어간다
//   · 센터 · 연락처 · 주소는 로켓이 채운다 (supabase/storage/009_wow_courier.sql)
//   · 와우출고 상자인데 센터 · 주소가 빈 박스가 있거나, 같은 코드의 출고 전 상자가 둘 이상이면
//     빈 칸 · 추측으로 내보내지 않고 알려 준다 (와우출고 [택배엑셀] 과 같은 기준)
//   건수 (2026-11-23): ft_box_info 2,749 / ft_wow_boxes 62 → fetchIn (in 100개 단위 + range 루프)
// ============================================================
interface WowRecipientLookup {
  recipients: Map<string, WowRecipient>;
  /** 센터 · 주소를 아직 받지 못한 상자 코드 */
  missing: string[];
  /** 출고 전 와우출고 상자가 둘 이상인 상자 코드 */
  duplicated: string[];
  /** 와우출고 마킹 상자의 코드 (받는 곳이 비어 있어도 택배로 나간다) */
  wowCodes: Set<string>;
}

async function loadWowRecipients(boxCodes: string[]): Promise<WowRecipientLookup> {
  const boxInfos = await fetchIn<{ id: string; box_code: string; shipment_id: string | null }>(
    'ft_box_info', 'id, box_code, shipment_id', 'box_code', boxCodes);
  const codeByBoxId = new Map(boxInfos.filter((b) => !b.shipment_id).map((b) => [b.id, b.box_code]));

  const wowBoxes = await fetchIn<{
    box_info_id: string; center: string | null; center_phone: string | null; center_address: string | null;
  }>('ft_wow_boxes', 'id, box_info_id, center, center_phone, center_address', 'box_info_id', [...codeByBoxId.keys()]);

  // ── 마킹 상자(코드)별로 모은다 — 마대는 와우 박스 여러 개가 한 상자에 들어 있다 ──
  const cartonIdsByCode = new Map<string, Set<string>>();
  const recipientsByCode = new Map<string, WowRecipient[]>();
  const missing = new Set<string>();
  for (const wow of wowBoxes) {
    const code = codeByBoxId.get(wow.box_info_id);
    if (!code) continue;
    cartonIdsByCode.set(code, (cartonIdsByCode.get(code) ?? new Set<string>()).add(wow.box_info_id));
    const center = (wow.center ?? '').trim();
    const address = (wow.center_address ?? '').trim();
    if (!center || !address) {
      missing.add(code);
      continue;
    }
    const recipient = { center, phone: formatPhone((wow.center_phone ?? '').trim()), address };
    const list = recipientsByCode.get(code) ?? [];
    if (!list.some((r) => sameRecipient(r, recipient))) list.push(recipient);
    recipientsByCode.set(code, list);
  }

  // 받는 곳이 하나인 상자만 채운다. 한 마대에 센터가 여럿이면 받는 곳은 비운다 (진행방법 '직접 처리')
  const recipients = new Map<string, WowRecipient>();
  for (const [code, list] of recipientsByCode) {
    if (list.length === 1 && !missing.has(code)) recipients.set(code, list[0]);
  }
  const duplicated = [...cartonIdsByCode].filter(([, ids]) => ids.size > 1).map(([code]) => code);
  return { recipients, wowCodes: new Set(cartonIdsByCode.keys()), missing: [...missing].sort(), duplicated: duplicated.sort() };
}

const sameRecipient = (a: WowRecipient | null, b: WowRecipient | null): boolean =>
  a === b || (!!a && !!b && a.center === b.center && a.phone === b.phone && a.address === b.address);

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
//   번호가 이어지고 받는 곳이 같은 상자끼리 한 줄 (와우출고는 상자마다 센터가 달라 센터가 바뀌면 줄을 나눈다)
function groupBoxesByMarking(boxes: BoxData[]): MarkingGroup[] {
  // prefix별로 그룹화
  const prefixGroups: Record<string, BoxData[]> = {};

  boxes.forEach(box => {
    if (!prefixGroups[box.prefix]) {
      prefixGroups[box.prefix] = [];
    }
    prefixGroups[box.prefix].push(box);
  });

  const result: MarkingGroup[] = [];

  Object.entries(prefixGroups).forEach(([prefix, boxList]) => {
    const sorted = [...boxList].sort((a, b) => a.number - b.number);
    const businessCode = sorted[0].businessCode;
    const businessName = BUSINESS_CODE_MAP[businessCode] || businessCode;
    const section = sorted[0].section;

    let run: BoxData[] = [];
    const flushRun = () => {
      if (run.length === 0) return;
      result.push({
        marking: formatNumberGroup(prefix, run.map(b => b.number)),
        count: run.length,
        section,
        businessName,
        wow: run[0].wow,
        recipient: run[0].recipient
      });
      run = [];
    };

    sorted.forEach(box => {
      const prev = run[run.length - 1];
      if (prev && (box.number !== prev.number + 1 || box.wow !== prev.wow || !sameRecipient(prev.recipient, box.recipient))) {
        flushRun();
      }
      run.push(box);
    });
    flushRun();
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
        businessCode: parsed.businessCode,
        wow: false,
        recipient: null
      });
    });

    console.log('수집된 박스 수:', boxDataMap.size);

    const boxes = Array.from(boxDataMap.values());

    if (boxes.length === 0) {
      return NextResponse.json({ success: false, error: '유효한 박스 데이터가 없습니다.' }, { status: 400 });
    }

    // ── 와우출고 상자: 받는 곳(센터 · 연락처 · 주소) 붙이기 ──
    const wow = await loadWowRecipients(boxes.map(box => box.location));
    if (wow.duplicated.length > 0) {
      return NextResponse.json(
        { success: false, error: `출고 전 와우출고 상자 중 코드가 같은 상자가 있어 받는 곳을 정할 수 없습니다: ${wow.duplicated.join(', ')}` },
        { status: 409 }
      );
    }
    if (wow.missing.length > 0) {
      return NextResponse.json(
        { success: false, error: `받는 곳(센터 · 주소) 정보가 아직 없는 와우출고 상자가 있습니다: ${wow.missing.join(', ')}. 로켓에서 정보를 다시 보내야 합니다.` },
        { status: 409 }
      );
    }
    boxes.forEach(box => {
      box.wow = wow.wowCodes.has(box.location);
      box.recipient = wow.recipients.get(box.location) ?? null;
    });

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
      { width: 52 }, // 주소 (센터 주소가 길다 — 와우출고 택배엑셀과 같은 너비)
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

      // 받는 곳: 와우출고 상자는 센터, 그 밖의 P · X 상자는 사업자 고정 주소
      const receiver = group.recipient
        ? { name: group.recipient.center, phone: group.recipient.phone, address: group.recipient.address }
        : useSpecialInfo
          ? { name: group.businessName, phone: SPECIAL_LOCATION_INFO.phone, address: SPECIAL_LOCATION_INFO.address }
          : { name: '', phone: '', address: '' };

      // 진행방법: 와우출고 상자는 센터로 바로 보내므로 X 여도 택배 (한 마대에 센터가 여럿이면 '직접 처리'),
      //           그 밖의 X 는 '이우 합배송', 나머지(A,B,C,P 등)는 택배
      const deliveryMethod = group.wow
        ? (group.recipient ? METHOD_COURIER : METHOD_DIRECT)
        : (group.section === 'X' ? METHOD_YIWU_MERGE : METHOD_COURIER);

      row.values = [
        group.businessName,   // A: 사업자명
        group.marking,        // B: 마킹
        group.count,          // C: CTN
        receiver.name,        // D: 받는사람
        receiver.phone,       // E: 연락처
        receiver.address,     // F: 주소
        deliveryMethod,       // G: 진행방법
        ''                    // H: 출고번호건
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
