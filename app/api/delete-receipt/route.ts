import { NextRequest, NextResponse } from 'next/server';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    // 환경변수 확인
    const awsRegion = process.env.AWS_REGION;
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const awsBucketName = process.env.AWS_BUCKET_NAME;

    if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey || !awsBucketName) {
      return NextResponse.json(
        { error: 'AWS 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const s3Client = new S3Client({
      region: awsRegion,
      credentials: {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      },
    });

    const { orderNumber } = await request.json();

    if (!orderNumber) {
      return NextResponse.json(
        { error: '주문번호가 필요합니다.' },
        { status: 400 }
      );
    }

    // S3에서 해당 주문번호의 파일들 삭제 시도 (PDF를 먼저 확인)
    const extensions = ['pdf', 'jpg', 'jpeg', 'png', 'gif'];
    let deletedFile = false;

    for (const ext of extensions) {
      const s3Key = `receipts/${orderNumber}.${ext}`;
      
      try {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: awsBucketName,
          Key: s3Key,
        });

        await s3Client.send(deleteCommand);
        deletedFile = true;
        break; // 하나라도 삭제되면 성공
      } catch (error) {
        // 파일이 없으면 다음 확장자 시도
        continue;
      }
    }

    // Supabase에서 img_upload를 false로 업데이트
    const { data, error } = await supabase
      .from('1688_invoice')
      .update({ 
        img_upload: false,
        file_extension: null 
      })
      .eq('order_number', orderNumber)
      .select(); // 업데이트된 행을 반환

    console.log('영수증 삭제 업데이트 결과:', { data, error, orderNumber, updatedRows: data?.length });

    if (error) {
      console.error('Supabase 업데이트 오류:', error);
      return NextResponse.json({ 
        error: 'Supabase 업데이트 중 오류가 발생했습니다.',
        details: error.message
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: '영수증이 성공적으로 삭제되었습니다.',
      deletedFromS3: deletedFile,
      updatedInDB: true
    });

  } catch (error) {
    return NextResponse.json(
      { 
        error: '영수증 삭제 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 