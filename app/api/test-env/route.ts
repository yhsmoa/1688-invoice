import { NextResponse } from 'next/server';

export async function GET() {
  console.log('=== 환경변수 테스트 시작 ===');
  
  const envVars = {
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME,
    MONGODB_URI: process.env.MONGODB_URI
  };

  console.log('환경변수 확인:', {
    AWS_REGION: !!envVars.AWS_REGION,
    AWS_ACCESS_KEY_ID: !!envVars.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: !!envVars.AWS_SECRET_ACCESS_KEY,
    AWS_BUCKET_NAME: !!envVars.AWS_BUCKET_NAME,
    MONGODB_URI: !!envVars.MONGODB_URI
  });

  console.log('실제 값 (일부):', {
    AWS_REGION: envVars.AWS_REGION,
    AWS_ACCESS_KEY_ID: envVars.AWS_ACCESS_KEY_ID?.substring(0, 10) + '...',
    AWS_BUCKET_NAME: envVars.AWS_BUCKET_NAME
  });

  return NextResponse.json({
    success: true,
    envStatus: {
      AWS_REGION: !!envVars.AWS_REGION,
      AWS_ACCESS_KEY_ID: !!envVars.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: !!envVars.AWS_SECRET_ACCESS_KEY,
      AWS_BUCKET_NAME: !!envVars.AWS_BUCKET_NAME,
      MONGODB_URI: !!envVars.MONGODB_URI
    },
    values: {
      AWS_REGION: envVars.AWS_REGION,
      AWS_BUCKET_NAME: envVars.AWS_BUCKET_NAME
    }
  });
} 