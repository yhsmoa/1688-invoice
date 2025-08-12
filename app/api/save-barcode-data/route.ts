import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { barcodeData, fileName } = body;

    if (!barcodeData || barcodeData.length === 0) {
      return NextResponse.json({ 
        error: '바코드 데이터가 없습니다.' 
      }, { status: 400 });
    }

    // Windows의 Documents 폴더 경로 가져오기
    const documentsPath = path.join(os.homedir(), 'Documents');
    const barcodeDirPath = path.join(documentsPath, 'BarcodeDB');

    // BarcodeDB 폴더가 없으면 생성
    if (!fs.existsSync(barcodeDirPath)) {
      fs.mkdirSync(barcodeDirPath, { recursive: true });
      console.log('BarcodeDB 폴더 생성:', barcodeDirPath);
    }

    // 파일명은 항상 barcode.json으로 고정
    const jsonFileName = 'barcode.json';
    const filePath = path.join(barcodeDirPath, jsonFileName);

    // JSON 파일로 저장 (바코드 데이터 배열만 저장)
    fs.writeFileSync(filePath, JSON.stringify(barcodeData, null, 2), 'utf-8');

    console.log(`바코드 데이터 저장 완료: ${filePath}`);

    return NextResponse.json({ 
      success: true,
      message: `바코드 데이터가 저장되었습니다.`,
      filePath: filePath,
      itemCount: barcodeData.length
    });

  } catch (error) {
    console.error('바코드 데이터 저장 오류:', error);
    return NextResponse.json({ 
      error: '바코드 데이터 저장 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}