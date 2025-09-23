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
    const COLUMNS = {
      SHOP: 3,           // D열 - 판매자/상점명
      OFFER_ID: 24,      // Y열 - 오퍼ID
      ORDER_INFO: 29,    // AD열 - 주문정보
      DELIVERY_CODE: 31  // AF열 - 배송코드
    };

    const deliveryDataArray: any[] = [];
    const uniqueIds = new Set<string>(); // 중복 ID 체크용

    console.log('데이터 행 처리 시작...');

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];

      // 빈 행 건너뛰기
      if (!row || row.length === 0) {
        continue;
      }

      try {
        // 각 컬럼 값 추출
        const shop = row[COLUMNS.SHOP] || '';
        const offerId = row[COLUMNS.OFFER_ID] || '';
        const orderInfo = row[COLUMNS.ORDER_INFO] || '';
        const deliveryCode = row[COLUMNS.DELIVERY_CODE] || '';

        // AF열(delivery_code)에 데이터가 있는 경우만 처리
        if (deliveryCode && deliveryCode.toString().trim() !== '') {
          // ID 생성: offer_id + "-" + delivery_code
          const id = `${offerId}-${deliveryCode}`;

          // 중복 ID 체크
          if (uniqueIds.has(id)) {
            console.log(`행 ${i + 2}: 중복 ID 건너뛰기 - ${id}`);
            continue;
          }

          uniqueIds.add(id);

          const deliveryItem = {
            id: id,
            shop: shop.toString().trim(),
            offer_id: offerId.toString().trim() || null,
            order_info: orderInfo.toString().trim() || null,
            delivery_code: deliveryCode.toString().trim()
          };

          deliveryDataArray.push(deliveryItem);
          console.log(`행 ${i + 2}: 배송정보 추가 - ID: ${id}, 상점: ${shop}, 배송코드: ${deliveryCode}`);
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
        error: 'AF열에 배송코드가 있는 유효한 데이터가 없습니다.'
      }, { status: 400 });
    }

    // Supabase에 데이터 저장
    try {
      console.log('Supabase 1688_invoice_deliveryInfo 테이블에 데이터 저장 중...');

      // 1. 먼저 기존 데이터 전체 삭제
      console.log('기존 배송정보 데이터 전체 삭제 시작...');
      const { error: deleteAllError } = await supabase
        .from('1688_invoice_deliveryInfo')
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
            .from('1688_invoice_deliveryInfo')
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