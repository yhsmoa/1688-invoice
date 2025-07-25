import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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

    const { orderNumber } = await request.json();

    if (!orderNumber) {
      return NextResponse.json(
        { error: '주문번호가 필요합니다.' },
        { status: 400 }
      );
    }

    // 먼저 Supabase에서 파일 확장자 정보 조회
    const { data: orderData, error } = await supabase
      .from('1688_invoice')
      .select('file_extension')
      .eq('order_number', orderNumber)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116은 "not found" 에러
      console.error('Supabase 조회 오류:', error);
      return NextResponse.json({ 
        error: 'Supabase 조회 중 오류가 발생했습니다.',
        details: error.message
      }, { status: 500 });
    }
    
    let extensions = ['pdf', 'jpg', 'jpeg', 'png', 'gif'];
    
    // DB에 확장자 정보가 있으면 해당 확장자를 먼저 시도
    if (orderData?.file_extension) {
      const savedExtension = orderData.file_extension;
      extensions = [savedExtension, ...extensions.filter(ext => ext !== savedExtension)];
    }

    let presignedUrl = null;
    let foundExtension = null;

    // 여러 확장자를 시도해서 존재하는 파일 찾기
    for (const ext of extensions) {
      const s3Key = `receipts/${orderNumber}.${ext}`;
      
      try {
        // 먼저 파일이 실제로 존재하는지 확인
        const headCommand = new HeadObjectCommand({
          Bucket: awsBucketName,
          Key: s3Key,
        });

        await s3Client.send(headCommand);

        // 파일이 존재하면 Presigned URL 생성
        const getObjectCommand = new GetObjectCommand({
          Bucket: awsBucketName,
          Key: s3Key,
        });

        const url = await getSignedUrl(s3Client, getObjectCommand, {
          expiresIn: 3600, // 1시간 유효
        });

        presignedUrl = url;
        foundExtension = ext;
        break;
      } catch (error) {
        // 파일이 없으면 다음 확장자 시도
        continue;
      }
    }

    if (!presignedUrl) {
      return NextResponse.json(
        { error: '해당 주문번호의 영수증 파일을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      imageUrl: presignedUrl,
      extension: foundExtension,
      expiresIn: '1시간'
    });

  } catch (error) {
    return NextResponse.json(
      { 
        error: '파일 URL 조회 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 