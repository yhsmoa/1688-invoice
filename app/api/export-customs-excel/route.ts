import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { data } = await request.json();

    // 워크북 생성
    const workbook = new ExcelJS.Workbook();

    // 품목별 시트 생성
    const itemSheet = workbook.addWorksheet('품목별');

    // 테이블 1: C:D, E:F 병합 (2열 × 5행, 2~6행)
    const table1Labels = ['담당지사', '선적항', '출고일', '컨테이너 번호', '실번호'];
    for (let i = 0; i < 5; i++) {
      const row = i + 2; // 2~6행

      // C:D 병합 (라벨)
      itemSheet.mergeCells(`C${row}:D${row}`);
      const cellCD = itemSheet.getCell(`C${row}`);
      cellCD.value = table1Labels[i];
      cellCD.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cellCD.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };

      // E:F 병합 (값, 연한 노란색)
      itemSheet.mergeCells(`E${row}:F${row}`);
      const cellEF = itemSheet.getCell(`E${row}`);
      cellEF.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cellEF.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };
      cellEF.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFF99' } // 연한 노란색
      };
    }

    // 테이블 2: J:K, L:O 병합 (2열 × 5행, 2~6행)
    const table2Labels = ['컨테이너 이름', '도착항', '선적일', '선명항차', '마스터 비엘 번호'];
    for (let i = 0; i < 5; i++) {
      const row = i + 2; // 2~6행

      // J:K 병합 (라벨)
      itemSheet.mergeCells(`J${row}:K${row}`);
      const cellJK = itemSheet.getCell(`J${row}`);
      cellJK.value = table2Labels[i];
      cellJK.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cellJK.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };

      // L:O 병합 (값, 연한 노란색)
      itemSheet.mergeCells(`L${row}:O${row}`);
      const cellLO = itemSheet.getCell(`L${row}`);
      cellLO.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cellLO.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };
      cellLO.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFF99' } // 연한 노란색
      };
    }

    // 8행에 헤더 추가
    const headerRow = itemSheet.getRow(8);
    const headers = [
      '보내는곳', '받는곳', '품명', '영어품명', 'HS CODE', '마킹', '파레트마킹',
      'C/T', 'KG', 'CBM', '박스별수량', '단위', '총수량', '단위', '단가($)', '합계($)',
      '사업자명', '비고', '재질', '원산지발급', '쉬퍼'
    ];

    headerRow.values = headers;

    // 헤더 스타일 적용
    headerRow.eachCell((cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= 21) { // A~U열
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD3D3D3' } // 회색 배경
        };
        cell.font = {
          bold: true
        };
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle'
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    });

    // 열 너비 설정
    itemSheet.columns = [
      { width: 12 }, // 보내는곳
      { width: 12 }, // 받는곳
      { width: 20 }, // 품명
      { width: 20 }, // 영어품명
      { width: 12 }, // HS CODE
      { width: 10 }, // 마킹
      { width: 12 }, // 파레트마킹
      { width: 8 },  // C/T
      { width: 8 },  // KG
      { width: 8 },  // CBM
      { width: 12 }, // 박스별수량
      { width: 8 },  // 단위
      { width: 10 }, // 총수량
      { width: 8 },  // 단위
      { width: 10 }, // 단가($)
      { width: 10 }, // 합계($)
      { width: 12 }, // 사업자명
      { width: 12 }, // 비고
      { width: 10 }, // 재질
      { width: 12 }, // 원산지발급
      { width: 20 }  // 쉬퍼 (2배로 증가)
    ];

    // 위안-달러 환율 (대략적인 환율, 필요시 API로 실시간 환율 가져오기 가능)
    const CNY_TO_USD = 0.14; // 1 CNY ≈ 0.14 USD

    // 9행부터 품목별 데이터 입력
    if (data && data.length > 0) {
      // 위치별로 그룹화하고 품목별로 집계
      const locationGroups: Record<string, Record<string, any[]>> = {};

      data.forEach((item: any) => {
        const location = item.location || '미지정';
        const itemKey = `${item.item_category || ''}_${item.blend_ratio || ''}`;

        if (!locationGroups[location]) {
          locationGroups[location] = {};
        }

        if (!locationGroups[location][itemKey]) {
          locationGroups[location][itemKey] = [];
        }

        locationGroups[location][itemKey].push(item);
      });

      let currentRow = 9;
      const startRow = 9; // 데이터 시작 행 기록
      const locationMergeRanges: { location: string; startRow: number; endRow: number }[] = [];

      // 각 위치별, 품목별로 데이터 입력
      for (const [location, items] of Object.entries(locationGroups)) {
        const itemEntries = Object.entries(items);
        const locationItemCount = itemEntries.length;
        let locationRowIndex = 0;
        const locationStartRow = currentRow; // 이 위치의 시작 행

        for (const [itemKey, itemList] of itemEntries) {
          const firstItem = itemList[0];
          const totalQuantity = itemList.reduce((sum, item) => sum + (parseInt(item.out_quantity) || 0), 0);

          // 평균 단가 계산 (단가의 합 / 개수) - 위안화
          const validPrices = itemList.filter((item: any) => item.unit_price && !isNaN(parseFloat(item.unit_price)));
          const avgPriceCNY = validPrices.length > 0
            ? validPrices.reduce((sum: number, item: any) => sum + parseFloat(item.unit_price), 0) / validPrices.length
            : 0;

          // 위안화를 달러로 환산
          const avgPriceUSD = avgPriceCNY * CNY_TO_USD;
          const totalPriceUSD = avgPriceUSD * totalQuantity;

          // Supabase에서 품목 정보 조회 (여러 개 있을 경우 첫 번째만 사용)
          const { data: customsDataArray } = await supabase
            .from('invoiceManager-Customs')
            .select('item_name_en, HS_code, CO')
            .eq('item_name_ko', firstItem.item_category)
            .limit(1);

          const customsData = customsDataArray && customsDataArray.length > 0 ? customsDataArray[0] : null;

          const row = itemSheet.getRow(currentRow);
          row.values = [
            'HD무역',                    // A: 보내는곳
            '',                          // B: 받는곳 (비워두기)
            firstItem.item_category,     // C: 품명
            customsData?.item_name_en || '', // D: 영어품명
            customsData?.HS_code || '',  // E: HS CODE
            location,                    // F: 마킹 (위치)
            '',                          // G: 파레트마킹
            '1',                         // H: C/T (위치별로 1)
            '',                          // I: KG
            '',                          // J: CBM
            '',                          // K: 박스별수량
            '',                          // L: 단위
            totalQuantity,               // M: 총수량 (동일품목 개수)
            'EA',                        // N: 단위
            avgPriceUSD.toFixed(2),      // O: 단가 (달러로 환산)
            totalPriceUSD.toFixed(2),    // P: 합계 (달러로 환산)
            '',                          // Q: 사업자명
            '',                          // R: 비고
            '',                          // S: 재질
            customsData?.CO || '',       // T: 원산지발급
            'LINYI FEIDA INTERNATIONAL TRADE CO.,LTD' // U: 쉬퍼
          ];

          // 위치별 마지막 행 여부 확인
          const isLastInLocation = (locationRowIndex === locationItemCount - 1);

          // 데이터 행 스타일 적용
          row.eachCell((cell, colNumber) => {
            if (colNumber >= 1 && colNumber <= 21) {
              cell.alignment = {
                horizontal: 'center',
                vertical: 'middle',
                wrapText: colNumber === 21 // U열(쉬퍼)은 텍스트 줄바꿈 적용
              };
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: isLastInLocation ? 'medium' : 'thin' }, // 위치별 마지막 행은 진한 선
                right: { style: 'thin' }
              };
            }
          });

          currentRow++;
          locationRowIndex++;
        }

        // 위치별 병합 범위 저장
        const locationEndRow = currentRow - 1;
        if (locationEndRow >= locationStartRow) {
          locationMergeRanges.push({
            location,
            startRow: locationStartRow,
            endRow: locationEndRow
          });
        }
      }

      // 셀 병합: A열(보내는곳), B열(받는곳), Q열(사업자명), U열(쉬퍼)은 모든 행이 동일하므로 병합
      const endRow = currentRow - 1; // 마지막 데이터 행
      if (endRow >= startRow) {
        // A열 병합 (보내는곳: HD무역)
        itemSheet.mergeCells(`A${startRow}:A${endRow}`);

        // B열 병합 (받는곳)
        itemSheet.mergeCells(`B${startRow}:B${endRow}`);
        const cellB = itemSheet.getCell(`B${startRow}`);
        cellB.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFF99' } // 연한 노란색
        };

        // Q열 병합 (사업자명)
        itemSheet.mergeCells(`Q${startRow}:Q${endRow}`);
        const cellQ = itemSheet.getCell(`Q${startRow}`);
        cellQ.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFF99' } // 연한 노란색
        };

        // U열 병합 (쉬퍼: LINYI FEIDA INTERNATIONAL TRADE CO.,LTD)
        itemSheet.mergeCells(`U${startRow}:U${endRow}`);
      }

      // 위치별 F열(마킹), H열(C/T), I열(KG), J열(CBM) 병합
      locationMergeRanges.forEach(range => {
        if (range.endRow > range.startRow) {
          // F열 병합 (위치)
          itemSheet.mergeCells(`F${range.startRow}:F${range.endRow}`);

          // H열 병합 (C/T)
          itemSheet.mergeCells(`H${range.startRow}:H${range.endRow}`);

          // I열 병합 (KG)
          itemSheet.mergeCells(`I${range.startRow}:I${range.endRow}`);

          // J열 병합 (CBM)
          itemSheet.mergeCells(`J${range.startRow}:J${range.endRow}`);
        }
      });
    }

    // 상품별 시트 생성
    const productSheet = workbook.addWorksheet('상품별');

    // 상품별 시트 헤더 (1행)
    const productHeaderRow = productSheet.getRow(1);
    const productHeaders = ['위치', '상품명', '옵션명', '출고개수', '품목', '이미지 링크'];
    productHeaderRow.values = productHeaders;

    // 헤더 스타일 적용
    productHeaderRow.eachCell((cell, colNumber) => {
      if (colNumber >= 1 && colNumber <= productHeaders.length) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD3D3D3' } // 회색 배경
        };
        cell.font = {
          bold: true
        };
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle'
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    });

    // 열 너비 설정
    productSheet.columns = [
      { width: 15 }, // 위치
      { width: 60 }, // 상품명 (2배)
      { width: 25 }, // 옵션명
      { width: 12 }, // 출고개수
      { width: 20 }, // 품목
      { width: 33 }  // 이미지 링크 (50의 2/3)
    ];

    // 상품별 데이터 입력 (2행부터)
    if (data && data.length > 0) {
      let productRow = 2;

      data.forEach((item: any) => {
        const row = productSheet.getRow(productRow);
        row.values = [
          item.location || '',
          item.product_name || '',
          item.option_name || '',
          item.out_quantity || '',
          item.item_category || '',
          item.image || ''
        ];

        // 데이터 행 스타일 적용
        row.eachCell((cell, colNumber) => {
          if (colNumber >= 1 && colNumber <= productHeaders.length) {
            // 정렬: 상품명(2), 옵션명(3), 이미지링크(6)는 좌측정렬, 나머지는 중앙정렬
            const isLeftAlign = colNumber === 2 || colNumber === 3 || colNumber === 6;

            const alignment: any = {
              horizontal: isLeftAlign ? 'left' : 'center',
              vertical: 'middle'
            };

            // 이미지링크는 shrinkToFit 적용 (텍스트를 셀 크기에 맞춤)
            if (colNumber === 6) {
              alignment.shrinkToFit = true;
            }

            cell.alignment = alignment;
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          }
        });

        productRow++;
      });
    }

    // 엑셀 버퍼 생성
    const buffer = await workbook.xlsx.writeBuffer();

    // 응답 반환
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="customs_document_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx"`
      }
    });

  } catch (error) {
    console.error('엑셀 생성 오류:', error);
    return NextResponse.json(
      { success: false, error: '엑셀 파일 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
