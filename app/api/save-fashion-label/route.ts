import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import pool from '../../../lib/postgres';

export async function POST(request: NextRequest) {
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { items, user_id } = body;

    // ============================================================
    // 1. 입력 데이터 검증
    // ============================================================
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '저장할 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    if (!user_id) {
      return NextResponse.json(
        { success: false, error: '담당자(user_id)가 선택되지 않았습니다.' },
        { status: 400 }
      );
    }

    console.log(`invoice_fashion_label 저장 시작: ${items.length}개 아이템, user_id: ${user_id}`);

    // ============================================================
    // 2. 다건 상품 수량 확장 (LABEL 시트 룰과 동일)
    //    - 1개 상품: qty 그대로 유지
    //    - 2개 이상 상품: 각 상품을 qty만큼 개별 행으로 확장 (qty=1)
    // ============================================================
    const expandedItems = items.length >= 2
      ? items.flatMap((item: any) =>
          Array.from({ length: item.qty || 1 }, () => ({ ...item, qty: 1 }))
        )
      : items;

    // ============================================================
    // 3. 트랜잭션 시작: 기존 user_id 데이터 삭제 후 신규 INSERT
    // ============================================================
    await client.query('BEGIN');

    // 동일 user_id 기존 데이터 삭제
    const deleteResult = await client.query(
      'DELETE FROM invoice_fashion_label WHERE user_id = $1',
      [user_id]
    );
    console.log(`기존 데이터 ${deleteResult.rowCount}개 삭제 (user_id: ${user_id})`);

    // ============================================================
    // 4. 배치 INSERT (id: uuid, seq: 순번)
    // ============================================================
    const columns = ['id', 'seq', 'brand', 'item_name', 'barcode', 'qty', 'order_no', 'composition', 'recommanded_age', 'shipment_size', 'user_id'];
    const valuePlaceholders: string[] = [];
    const values: any[] = [];

    expandedItems.forEach((item: any, idx: number) => {
      const offset = idx * columns.length;
      const placeholders = columns.map((_, i) => `$${offset + i + 1}`);
      valuePlaceholders.push(`(${placeholders.join(', ')})`);

      values.push(
        randomUUID(),           // id: UUID 랜덤 생성
        idx + 1,                // seq: 순번 (1, 2, 3...)
        item.brand || null,
        item.item_name || null,
        item.barcode || null,
        item.qty || 0,
        item.order_no || null,
        item.composition || null,
        item.recommanded_age || null,
        item.shipment_size || null,
        item.user_id || null
      );
    });

    const query = `
      INSERT INTO invoice_fashion_label (${columns.join(', ')})
      VALUES ${valuePlaceholders.join(', ')}
      RETURNING id
    `;

    const result = await client.query(query, values);

    // 트랜잭션 커밋
    await client.query('COMMIT');

    console.log(`invoice_fashion_label 저장 완료: ${result.rowCount}개`);

    return NextResponse.json({
      success: true,
      count: result.rowCount,
      message: `${result.rowCount}개 데이터가 저장되었습니다.`
    });

  } catch (error) {
    // 트랜잭션 롤백
    await client.query('ROLLBACK');
    console.error('invoice_fashion_label 저장 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'invoice_fashion_label 저장 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
