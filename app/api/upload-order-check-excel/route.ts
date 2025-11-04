import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';

/**
 * order_info에서 주문번호 추출
 * 예: "BZ-250925-0039 // 深灰色 | FREE // S0033426163033 // 1ea" → "BZ-250925-0039"
 * "//"가 없으면 order_info 전체를 반환
 * @param orderInfo - order_info 문자열
 * @returns 추출된 주문번호 또는 전체 order_info
 */
function extractSheetOrderNumber(orderInfo: string): string {
  if (!orderInfo || typeof orderInfo !== 'string') {
    return '';
  }

  const trimmed = orderInfo.trim();

  // "//" 기준으로 분리
  if (trimmed.includes('//')) {
    const parts = trimmed.split('//');
    const orderNumber = parts[0].trim();
    return orderNumber;
  }

  // "//"가 없으면 전체 반환
  return trimmed;
}

/**
 * 엑셀 날짜/시간 데이터를 PostgreSQL timestamptz 형식으로 변환
 * @param value - 엑셀 셀 값 (숫자 또는 문자열)
 * @returns ISO 8601 형식의 날짜 문자열 또는 null
 */
function parseExcelDateTime(value: any): string | null {
  if (!value) return null;

  try {
    // 엑셀 숫자 날짜 형식인 경우 (예: 45234.567)
    if (typeof value === 'number') {
      // XLSX 라이브러리의 SSF 모듈을 사용하여 엑셀 날짜를 JS Date로 변환
      const excelDate = XLSX.SSF.parse_date_code(value);
      if (excelDate) {
        const date = new Date(
          excelDate.y,
          excelDate.m - 1, // JS Date는 0부터 시작
          excelDate.d,
          excelDate.H || 0,
          excelDate.M || 0,
          excelDate.S || 0
        );
        return date.toISOString();
      }
    }

    // 문자열 형식인 경우 (예: "2025-10-16 14:24:29" 또는 "2025-10-16  2:24:29 오후")
    if (typeof value === 'string') {
      const trimmed = value.trim();

      // "YYYY-MM-DD HH:mm:ss" 형식 처리
      if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}$/.test(trimmed)) {
        const date = new Date(trimmed);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      // "YYYY-MM-DD  h:mm:ss 오후/오전" 형식 처리
      const ampmMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(오후|오전|AM|PM)?$/i);
      if (ampmMatch) {
        const [, year, month, day, hour, minute, second, ampm] = ampmMatch;
        let h = parseInt(hour);

        // 오후/PM 처리
        if (ampm && (ampm === '오후' || ampm.toUpperCase() === 'PM')) {
          if (h < 12) h += 12;
        }
        // 오전/AM 처리 (12시는 0시로)
        if (ampm && (ampm === '오전' || ampm.toUpperCase() === 'AM')) {
          if (h === 12) h = 0;
        }

        const date = new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          h,
          parseInt(minute),
          parseInt(second)
        );

        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      // 일반 날짜 문자열 파싱 시도
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    console.warn('날짜 파싱 실패:', value);
    return null;
  } catch (error) {
    console.error('날짜 변환 오류:', value, error);
    return null;
  }
}

// 주문 검사용 엑셀 업로드 및 1688_invoice_deliveryInfo_check 테이블 저장 API
export const POST = async (request: NextRequest) => {
  console.log('주문 검사 엑셀 파일 업로드 API가 호출되었습니다.');

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    console.log('파일 수신:', file?.name, file?.size);

    if (!file) {
      console.log('파일이 업로드되지 않았습니다.');
      return NextResponse.json({ error: '파일이 업로드되지 않았습니다.' }, { status: 400 });
    }

    // 파일 확장자 확인
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
      return NextResponse.json({
        error: '엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.'
      }, { status: 400 });
    }

    // 파일을 버퍼로 변환
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 엑셀 파일 읽기
    console.log('엑셀 파일 파싱 시작...');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    console.log('엑셀 데이터 행 수:', jsonData.length);

    // 첫 번째 행은 헤더이므로 제외
    const dataRows = jsonData.slice(1) as any[][];

    // 컬럼 인덱스 정의
    const COLUMNS = {
      ORDER_ID: 0,       // A열 - 주문ID (병합 구조)
      SHOP: 3,           // D열 - 판매자/상점명
      DELIVERY_STATUS: 9, // J열 - 배송상태
      ORDER_PAYMENT_TIME: 11, // L열 - 주문 결제 시간
      OFFER_ID: 24,      // Y열 - 오퍼ID
      ORDER_INFO: 29,    // AD열 - 주문정보 (줄바꿈으로 분리된 데이터)
      DELIVERY_CODE: 31  // AF열 - 배송코드 (병합 구조 없음)
    };

    // 디버깅: 첫 번째 데이터 행 확인
    if (dataRows.length > 0 && dataRows[0]) {
      console.log('=== 첫 번째 행 컬럼 확인 ===');
      console.log('A열(0번 인덱스):', dataRows[0][0]);
      console.log('L열(11번 인덱스) - 원본:', dataRows[0][11]);
      console.log('L열(11번 인덱스) - 변환:', parseExcelDateTime(dataRows[0][11]));
      console.log('AD열(29번 인덱스):', dataRows[0][29]);
      console.log('AF열(31번 인덱스):', dataRows[0][31]);
      console.log('===========================');
    }

    // 병합된 그룹을 추적하기 위한 구조
    interface MergedGroup {
      orderId: string;
      startRow: number;
      endRow: number;
      shop: string;
      deliveryStatus: string;
      orderPaymentTime: string | null;
      orderInfo: string;
      deliveryCodes: string[]; // 그룹 내 모든 delivery_code 수집
      offerIds: string[]; // 그룹 내 모든 offer_id 수집 (첫번째만 사용)
    }

    const mergedGroups: MergedGroup[] = [];
    let currentGroup: MergedGroup | null = null;

    console.log('데이터 행 처리 시작 - 1단계: 병합 그룹 수집...');

    // 1단계: 병합된 그룹별로 데이터 수집
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];

      if (!row || row.length === 0) {
        continue;
      }

      try {
        const orderIdCell = row[COLUMNS.ORDER_ID];
        const shop = row[COLUMNS.SHOP] || '';
        const deliveryStatus = row[COLUMNS.DELIVERY_STATUS] || '';
        const orderPaymentTimeRaw = row[COLUMNS.ORDER_PAYMENT_TIME];
        const offerId = row[COLUMNS.OFFER_ID] || '';
        const orderInfo = row[COLUMNS.ORDER_INFO] || '';
        const deliveryCode = row[COLUMNS.DELIVERY_CODE] || '';

        // L열 날짜/시간 변환
        const orderPaymentTime = parseExcelDateTime(orderPaymentTimeRaw);

        // A열에 새로운 ORDER_ID가 나타나면 새 그룹 시작
        if (orderIdCell && orderIdCell.toString().trim() !== '') {
          // 이전 그룹이 있으면 저장
          if (currentGroup) {
            mergedGroups.push(currentGroup);
          }

          // 새 그룹 시작
          currentGroup = {
            orderId: orderIdCell.toString().trim(),
            startRow: i,
            endRow: i,
            shop: shop.toString().trim(),
            deliveryStatus: deliveryStatus.toString().trim(),
            orderPaymentTime: orderPaymentTime,
            orderInfo: orderInfo.toString().trim(),
            deliveryCodes: [],
            offerIds: []
          };

          // 첫 행의 데이터 수집
          if (deliveryCode && deliveryCode.toString().trim() !== '') {
            currentGroup.deliveryCodes.push(deliveryCode.toString().trim());
          }
          if (offerId && offerId.toString().trim() !== '') {
            currentGroup.offerIds.push(offerId.toString().trim());
          }

        } else if (currentGroup) {
          // 같은 그룹의 다음 행 - endRow 업데이트 및 데이터 수집
          currentGroup.endRow = i;

          // delivery_code 수집
          if (deliveryCode && deliveryCode.toString().trim() !== '') {
            currentGroup.deliveryCodes.push(deliveryCode.toString().trim());
          }

          // offer_id 수집
          if (offerId && offerId.toString().trim() !== '') {
            currentGroup.offerIds.push(offerId.toString().trim());
          }

          // orderInfo가 비어있지 않으면 업데이트 (병합된 셀의 경우 첫 행에만 값이 있을 수 있음)
          if (orderInfo && orderInfo.toString().trim() !== '') {
            currentGroup.orderInfo = orderInfo.toString().trim();
          }
        }

        // 디버깅: 처음 10개 행
        if (i < 10) {
          console.log(`\n행 ${i + 2}:`);
          console.log('  ORDER_ID:', orderIdCell || '(병합)');
          console.log('  OFFER_ID:', offerId);
          console.log('  DELIVERY_CODE:', deliveryCode);
        }

      } catch (rowError) {
        console.error(`행 ${i + 2} 처리 중 오류:`, rowError);
        continue;
      }
    }

    // 마지막 그룹 저장
    if (currentGroup) {
      mergedGroups.push(currentGroup);
    }

    console.log(`\n총 ${mergedGroups.length}개의 병합 그룹 발견`);

    // 2단계: 각 그룹의 데이터를 개별 레코드로 변환
    const deliveryDataArray: any[] = [];
    console.log('\n2단계: 개별 레코드 생성...');

    mergedGroups.forEach((group, groupIndex) => {
      // 디버깅: 처음 3개 그룹만 상세 로그
      if (groupIndex < 3) {
        console.log(`\n그룹 ${groupIndex + 1}:`);
        console.log('  ORDER_ID:', group.orderId);
        console.log('  ORDER_PAYMENT_TIME:', group.orderPaymentTime);
        console.log('  행 범위:', `${group.startRow + 2} ~ ${group.endRow + 2}`);
        console.log('  DELIVERY_CODEs:', group.deliveryCodes.join(', '));
        console.log('  OFFER_IDs:', group.offerIds.slice(0, 3).join(', '));
        console.log('  ORDER_INFO 길이:', group.orderInfo.length);
      }

      // orderInfo가 없으면 건너뛰기
      if (!group.orderInfo || group.orderInfo.trim() === '') {
        return;
      }

      // AD열의 줄바꿈으로 분리된 데이터를 파싱
      const orderInfoLines = group.orderInfo.split('\n').filter(line => line.trim() !== '');

      // delivery_code들을 줄바꿈으로 연결
      const deliveryCodeJoined = group.deliveryCodes.join('\n');

      // 각 orderInfo 줄을 개별 레코드로 저장
      orderInfoLines.forEach((line, lineIndex) => {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          return;
        }

        // ID 생성: order_id + "-" + 라인번호
        const id = `${group.orderId}-${lineIndex + 1}`;

        // order_info에서 주문번호 추출 (sheet_order_number용)
        const sheetOrderNumber = extractSheetOrderNumber(trimmedLine);

        const deliveryItem = {
          id: id,
          order_id: group.orderId,
          shop: group.shop,
          delivery_status: group.deliveryStatus || null,
          order_payment_time: group.orderPaymentTime || null,
          offer_id: group.offerIds[0] || null, // 첫 번째 offer_id 사용
          order_info: trimmedLine,
          delivery_code: deliveryCodeJoined, // 모든 delivery_code를 줄바꿈으로 연결
          sheet_order_number: sheetOrderNumber // 추출된 주문번호 또는 전체 order_info
        };

        deliveryDataArray.push(deliveryItem);

        // 처음 5개만 상세 로그
        if (deliveryDataArray.length <= 5) {
          console.log(`\n✅ 레코드 ${deliveryDataArray.length}:`);
          console.log('  ID:', id);
          console.log('  ORDER_ID:', group.orderId);
          console.log('  SHEET_ORDER_NUMBER:', sheetOrderNumber);
          console.log('  ORDER_PAYMENT_TIME:', group.orderPaymentTime);
          console.log('  DELIVERY_CODEs:', deliveryCodeJoined);
          console.log('  ORDER_INFO:', trimmedLine.substring(0, 50));
        }
      });
    });

    console.log(`총 ${deliveryDataArray.length}개의 배송정보 데이터를 저장합니다.`);

    // 데이터가 없는 경우
    if (deliveryDataArray.length === 0) {
      return NextResponse.json({
        error: 'AD열과 AF열에 유효한 데이터가 없습니다.'
      }, { status: 400 });
    }

    // Supabase에 데이터 저장
    try {
      console.log('Supabase 1688_invoice_deliveryInfo_check 테이블에 데이터 저장 중...');

      // 1. 먼저 기존 데이터 전체 삭제
      console.log('기존 주문 검사 데이터 전체 삭제 시작...');
      const { error: deleteAllError } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .delete()
        .neq('id', '');

      if (deleteAllError) {
        console.error('기존 데이터 삭제 오류:', deleteAllError);
        return NextResponse.json({
          error: '기존 데이터 삭제 중 오류가 발생했습니다.',
          details: deleteAllError.message
        }, { status: 500 });
      }

      console.log('기존 데이터 전체 삭제 완료');

      // 2. 새 데이터 저장
      let savedCount = 0;
      let errorCount = 0;

      // 데이터 크기에 따라 배치 크기 동적 조정
      const totalCount = deliveryDataArray.length;
      let batchSize = 100; // 기본값: 100개

      if (totalCount > 5000) {
        batchSize = 200; // 5000개 이상: 200개씩
      } else if (totalCount > 1000) {
        batchSize = 150; // 1000개 이상: 150개씩
      }

      const totalBatches = Math.ceil(totalCount / batchSize);
      console.log(`\n총 ${totalCount}개 데이터를 ${totalBatches}개 배치(배치당 ${batchSize}개)로 저장 시작...`);

      const startTime = Date.now();

      for (let i = 0; i < deliveryDataArray.length; i += batchSize) {
        const batch = deliveryDataArray.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const progress = ((i + batch.length) / totalCount * 100).toFixed(1);

        try {
          console.log(`[${batchNum}/${totalBatches}] 배치 처리 중... (${batch.length}개, 진행률: ${progress}%)`);

          const { data, error } = await supabase
            .from('1688_invoice_deliveryInfo_check')
            .insert(batch)
            .select();

          if (error) {
            console.error(`❌ 배치 ${batchNum} 저장 오류:`, error.message);
            errorCount += batch.length;
          } else {
            savedCount += data?.length || 0;
            console.log(`✅ 배치 ${batchNum} 저장 성공: ${data?.length || 0}개`);
          }
        } catch (batchError) {
          console.error(`❌ 배치 ${batchNum} 처리 중 예외:`, batchError);
          errorCount += batch.length;
        }
      }

      const endTime = Date.now();
      const elapsedTime = ((endTime - startTime) / 1000).toFixed(2);
      console.log(`\n✨ 저장 완료 - 성공: ${savedCount}개, 실패: ${errorCount}개, 소요시간: ${elapsedTime}초`);

      if (savedCount === 0 && errorCount > 0) {
        return NextResponse.json({
          error: '모든 데이터 저장에 실패했습니다.',
          details: `총 ${errorCount}개 데이터 저장 실패`
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: '주문 검사 엑셀 파일이 성공적으로 업로드되었습니다.',
        count: deliveryDataArray.length,
        savedCount: savedCount,
        errorCount: errorCount
      });

    } catch (dbError) {
      console.error('데이터베이스 저장 중 예외:', dbError);
      return NextResponse.json({
        error: '데이터 저장 중 예외가 발생했습니다.',
        details: dbError instanceof Error ? dbError.message : 'Unknown database error'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('주문 검사 엑셀 업로드 중 오류:', error);
    return NextResponse.json({
      error: '엑셀 파일 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
