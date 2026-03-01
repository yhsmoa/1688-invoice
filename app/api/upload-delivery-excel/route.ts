import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';

// 엑셀 업로드 및 1688_invoice_deliveryInfo 테이블 저장 API
export const POST = async (request: NextRequest) => {
  console.log('배송정보 엑셀 파일 업로드 API가 호출되었습니다.');

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
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    console.log('엑셀 데이터 행 수:', jsonData.length);

    // 첫 번째 행은 헤더이므로 제외
    const dataRows = jsonData.slice(1) as any[][];

    // 컬럼 인덱스 정의 (엑셀 컬럼을 0부터 시작하는 인덱스로 변환)
    // A=0, B=1, ..., Z=25, AA=26, AB=27, AC=28, AD=29, AE=30, AF=31
    const COLUMNS = {
      ORDER_ID: 0,       // A열 - 주문ID
      SHOP: 3,           // D열 - 판매자/상점명
      DELIVERY_STATUS: 9, // J열 - 배송상태
      OFFER_ID: 24,      // Y열 - 오퍼ID
      ORDER_INFO: 29,    // AD열 - 주문정보
      DELIVERY_CODE: 31  // AF열 - 배송코드
    };

    // ============================================================
    // 병합 셀 처리: worksheet['!merges']에서 병합 범위 추출
    // 병합된 셀인 경우에만 상위 값을 상속 (빈값과 병합을 구분)
    // ============================================================
    const merges: XLSX.Range[] = worksheet['!merges'] || [];

    // 특정 셀(dataRow 기준 인덱스, 컬럼 인덱스)이 병합 범위에 포함되는지 확인
    // 포함되면 병합 시작 셀의 값을 반환, 아니면 null
    const getMergedValue = (dataRowIndex: number, colIndex: number): any => {
      const actualRow = dataRowIndex + 1; // 헤더 1행 제외 → 실제 시트 행 (0-based)
      for (const merge of merges) {
        if (
          actualRow >= merge.s.r && actualRow <= merge.e.r &&
          colIndex >= merge.s.c && colIndex <= merge.e.c
        ) {
          // 병합 시작 행의 데이터 반환 (헤더 제외 보정)
          const startDataRowIndex = merge.s.r - 1; // 시트 행 → dataRows 인덱스
          if (startDataRowIndex >= 0 && dataRows[startDataRowIndex]) {
            return dataRows[startDataRowIndex][colIndex];
          }
        }
      }
      return null; // 병합 범위가 아님
    };

    // 셀 값을 가져오되, 빈값이면 병합 여부 확인
    const getCellValue = (dataRowIndex: number, colIndex: number, rawValue: any): any => {
      if (rawValue !== undefined && rawValue !== null && rawValue.toString().trim() !== '') {
        return rawValue; // 값이 있으면 그대로 사용
      }
      // 값이 없으면 → 병합 범위인지 확인 후 병합 시작 셀 값 반환
      return getMergedValue(dataRowIndex, colIndex);
    };

    console.log(`병합 셀 범위 ${merges.length}개 감지됨`);

    // 디버깅: 첫 번째 데이터 행의 AD열(29)과 AF열(31) 값 출력
    if (dataRows.length > 0 && dataRows[0]) {
      console.log('=== 첫 번째 행 컬럼 확인 ===');
      console.log('AD열(29번 인덱스):', dataRows[0][29]);
      console.log('AF열(31번 인덱스):', dataRows[0][31]);
      console.log('===========================');
    }

    const deliveryDataArray: any[] = [];
    let itemCounter = 0;

    console.log('데이터 행 처리 시작...');

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];

      // 빈 행 건너뛰기
      if (!row || row.length === 0) {
        continue;
      }

      try {
        // 각 컬럼 값 추출 (병합 셀 고려)
        const orderId = getCellValue(i, COLUMNS.ORDER_ID, row[COLUMNS.ORDER_ID]) || '';
        const shop = getCellValue(i, COLUMNS.SHOP, row[COLUMNS.SHOP]) || '';
        const deliveryStatus = getCellValue(i, COLUMNS.DELIVERY_STATUS, row[COLUMNS.DELIVERY_STATUS]) || '';
        const offerId = getCellValue(i, COLUMNS.OFFER_ID, row[COLUMNS.OFFER_ID]) || '';
        const orderInfo = getCellValue(i, COLUMNS.ORDER_INFO, row[COLUMNS.ORDER_INFO]) || '';
        const deliveryCode = getCellValue(i, COLUMNS.DELIVERY_CODE, row[COLUMNS.DELIVERY_CODE]) || '';

        // 디버깅: 처음 5개 행의 모든 값 출력
        if (i < 5) {
          console.log(`\n행 ${i + 2} 디버깅:`);
          console.log('  ORDER_ID(0):', orderId);
          console.log('  SHOP(3):', shop);
          console.log('  DELIVERY_STATUS(9):', deliveryStatus);
          console.log('  OFFER_ID(24):', offerId);
          console.log('  ORDER_INFO(29):', orderInfo?.toString().substring(0, 50) + '...');
          console.log('  DELIVERY_CODE(31):', deliveryCode);
        }

        // AD열 또는 AF열에 데이터가 있는 경우 처리
        const hasOrderInfo = orderInfo && orderInfo.toString().trim() !== '';
        const hasDeliveryCode = deliveryCode && deliveryCode.toString().trim() !== '';

        // AD열과 AF열이 모두 비어있으면 건너뛰기
        if (!hasOrderInfo && !hasDeliveryCode) {
          continue;
        }

        // order_info를 줄바꿈으로 분리
        const orderInfoLines = hasOrderInfo
          ? orderInfo.toString().split('\n').filter((line: string) => line.trim())
          : [''];

        // 각 줄마다 별도 레코드 생성
        for (const orderInfoLine of orderInfoLines) {
          const trimmedLine = orderInfoLine.trim();

          // 데이터 형식 판별 및 파싱
          let sheetOrderCode: string | null = null;
          let sheetOrderNumber: string | null = null;

          if (trimmedLine) {
            if (trimmedLine.includes('//')) {
              // "//" 구분자 형식 (새 형식 또는 기존 형식)
              const parts = trimmedLine.split('//').map((p: string) => p.trim());

              if (parts.length >= 5) {
                // 새 형식: order_code // order_number // 옵션 // 바코드 // 수량
                sheetOrderCode = parts[0] || null;
                sheetOrderNumber = parts[1] || null;
              } else {
                // 기존 형식: order_number // 옵션 // 바코드 // 수량
                sheetOrderCode = null;
                sheetOrderNumber = parts[0] || null;
              }
            } else if (trimmedLine.includes(' - ')) {
              // 레거시 형식: MMDD - 옵션 - 바코드 - 수량
              const parts = trimmedLine.split(' - ').map((p: string) => p.trim());
              sheetOrderCode = null;
              sheetOrderNumber = parts[0] || null; // MMDD 날짜
            }
          }

          itemCounter++;
          const id = hasDeliveryCode
            ? `${deliveryCode.toString().trim()}-${itemCounter}`
            : `no-code-${itemCounter}`;

          const deliveryItem = {
            id: id,
            order_id: orderId.toString().trim() || null,
            shop: shop.toString().trim(),
            delivery_status: deliveryStatus.toString().trim() || null,
            offer_id: offerId.toString().trim() || null,
            order_info: trimmedLine || null, // 한 줄만 (빈 경우 null)
            delivery_code: hasDeliveryCode ? deliveryCode.toString().trim() : null,
            sheet_order_code: sheetOrderCode,
            sheet_order_number: sheetOrderNumber
          };

          deliveryDataArray.push(deliveryItem);

          // 처음 3개만 상세 로그
          if (deliveryDataArray.length <= 3) {
            console.log(`✅ 행 ${i + 2}: 배송정보 추가`);
            console.log('  ID:', id);
            console.log('  상점:', shop);
            console.log('  배송코드:', hasDeliveryCode ? deliveryCode : '(없음)');
            console.log('  주문정보:', trimmedLine || '(없음)');
            console.log('  sheet_order_code:', sheetOrderCode);
            console.log('  sheet_order_number:', sheetOrderNumber);
          }
        }
      } catch (rowError) {
        console.error(`행 ${i + 2} 처리 중 오류:`, rowError);
        // 개별 행 오류는 로그만 남기고 계속 진행
        continue;
      }
    }

    console.log(`총 ${deliveryDataArray.length}개의 배송정보 데이터를 저장합니다.`);

    // 데이터가 없는 경우
    if (deliveryDataArray.length === 0) {
      return NextResponse.json({
        error: 'AD열(주문정보) 또는 AF열(배송코드)에 데이터가 있는 유효한 행이 없습니다.'
      }, { status: 400 });
    }

    // Supabase에 데이터 저장
    try {
      console.log('Supabase 1688_invoice_deliveryInfo_check 테이블에 데이터 저장 중...');

      // 1. 먼저 기존 데이터 전체 삭제
      console.log('기존 배송정보 데이터 전체 삭제 시작...');
      const { error: deleteAllError } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .delete()
        .neq('id', ''); // 모든 데이터 삭제 (빈 문자열이 아닌 모든 ID)

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

      // 배치 크기를 작게 하여 순차적으로 처리
      const batchSize = 50;

      for (let i = 0; i < deliveryDataArray.length; i += batchSize) {
        const batch = deliveryDataArray.slice(i, i + batchSize);

        try {
          console.log(`배치 ${Math.floor(i/batchSize) + 1} 처리 중... (${batch.length}개)`);

          // 새 데이터 삽입
          const { data, error } = await supabase
            .from('1688_invoice_deliveryInfo_check')
            .insert(batch)
            .select();

          if (error) {
            console.error(`배치 ${Math.floor(i/batchSize) + 1} 저장 오류:`, error);
            errorCount += batch.length;
          } else {
            savedCount += data?.length || 0;
            console.log(`배치 ${Math.floor(i/batchSize) + 1} 저장 성공: ${data?.length || 0}개`);
          }
        } catch (batchError) {
          console.error(`배치 ${Math.floor(i/batchSize) + 1} 처리 중 예외:`, batchError);
          errorCount += batch.length;
        }
      }

      console.log(`저장 완료 - 성공: ${savedCount}개, 실패: ${errorCount}개`);

      if (savedCount === 0 && errorCount > 0) {
        return NextResponse.json({
          error: '모든 데이터 저장에 실패했습니다.',
          details: `총 ${errorCount}개 데이터 저장 실패`
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: '배송정보 엑셀 파일이 성공적으로 업로드되었습니다.',
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
    console.error('배송정보 엑셀 업로드 중 오류:', error);
    return NextResponse.json({
      error: '엑셀 파일 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};