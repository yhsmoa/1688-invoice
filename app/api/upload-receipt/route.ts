import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const orderNumber = formData.get('orderNumber') as string;

    if (!file || !orderNumber) {
      return NextResponse.json(
        { error: '파일과 주문번호가 필요합니다.' },
        { status: 400 }
      );
    }

    // 파일 확장자 추출
    const fileExtension = file.name.split('.').pop();
    const fileName = `${orderNumber}.${fileExtension}`;
    const s3Key = `receipts/${fileName}`;

    // 파일을 Buffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // S3에 업로드
    const uploadCommand = new PutObjectCommand({
      Bucket: awsBucketName,
      Key: s3Key,
      Body: buffer,
      ContentType: file.type,
    });

    await s3Client.send(uploadCommand);

    // Supabase에서 해당 주문의 img_upload를 true로 업데이트하고 파일 확장자도 저장
    // 모든 관련 행을 업데이트
    const { data, error } = await supabase
      .from('1688_invoice')
      .update({ 
        img_upload: true,
        file_extension: fileExtension
      })
      .eq('order_number', orderNumber)
      .select(); // 업데이트된 행을 반환

    console.log('Supabase 업데이트 결과:', { 
      data, 
      error, 
      orderNumber, 
      img_upload: true,
      updatedRows: data?.length 
    });

    if (error) {
      console.error('Supabase 업데이트 오류:', error);
      return NextResponse.json({ 
        error: 'Supabase 업데이트 중 오류가 발생했습니다.',
        details: error.message
      }, { status: 500 });
    }

    // 업데이트된 행이 있는지 확인
    if (!data || data.length === 0) {
      console.error('업데이트된 행이 없습니다. 주문번호:', orderNumber);
      return NextResponse.json({ 
        error: '해당 주문번호를 찾을 수 없습니다.',
        orderNumber: orderNumber
      }, { status: 404 });
    }

    // 업데이트가 성공했는지 다시 확인
    const { data: checkData, error: checkError } = await supabase
      .from('1688_invoice')
      .select('id, order_number, img_upload, file_extension')
      .eq('order_number', orderNumber);

    console.log('업데이트 후 확인:', { checkData, checkError });

    // Presigned URL 생성 (24시간 유효)
    const getObjectCommand = new GetObjectCommand({
      Bucket: awsBucketName,
      Key: s3Key,
    });

    const presignedUrl = await getSignedUrl(s3Client, getObjectCommand, {
      expiresIn: 86400, // 24시간 (초 단위)
    });

    return NextResponse.json({
      success: true,
      message: '영수증이 성공적으로 업로드되었습니다.',
      fileName: fileName,
      s3Key: s3Key,
      imageUrl: presignedUrl,
      expiresIn: '24시간',
      note: 'Presigned URL 사용 중 (보안)'
    });

  } catch (error) {
    return NextResponse.json(
      { 
        error: '업로드 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 