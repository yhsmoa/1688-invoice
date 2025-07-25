import { NextResponse } from 'next/server';

export async function GET() {
  try {
    console.log('환경변수 확인:', !!process.env.MONGODB_URI);
    console.log('URI 일부:', process.env.MONGODB_URI?.substring(0, 20));
    
    // 간단한 연결 테스트
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    
    await client.connect();
    console.log('MongoDB 연결 성공!');
    
    const db = client.db('invoice');
    const collection = db.collection('invoice_info');
    const count = await collection.countDocuments();
    
    await client.close();
    
    return NextResponse.json({ 
      status: 'success',
      message: '연결 성공',
      documentCount: count
    });
  } catch (error) {
    console.error('연결 테스트 오류:', error);
    return NextResponse.json({ 
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 