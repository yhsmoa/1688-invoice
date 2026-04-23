/**
 * 고아(orphan) ft_cancel_details 정리 스크립트
 *
 * 문제 상황:
 *   철회(DELETE) 시 'fulfillments.id' dot 컬럼 filter 버그로
 *   ft_fulfillments는 삭제됐지만 ft_cancel_details는 남아있는 경우
 *
 * 환경변수 (필수):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   → Railway 또는 로컬 .env 에서 로드
 *
 * 실행:
 *   # Node 20.6+ 내장 env-file 로더 사용
 *   node --env-file=.env cleanup-orphan-cancel-details.js <item_no>
 *
 *   # 또는 쉘에서 직접 export 후 실행
 *   export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
 *   node cleanup-orphan-cancel-details.js <item_no>
 *
 *   예) node --env-file=.env cleanup-orphan-cancel-details.js HI-260227-0007-A01
 *
 * --dry-run 옵션:
 *   node --env-file=.env cleanup-orphan-cancel-details.js HI-260227-0007-A01 --dry-run
 *   (실제 삭제 없이 조회만)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ 환경변수가 설정되지 않았습니다.');
  console.error('   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 를 .env 에 추가하고');
  console.error('   node --env-file=.env cleanup-orphan-cancel-details.js <item_no> 로 실행하세요.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const itemNo  = process.argv[2];
const dryRun  = process.argv.includes('--dry-run');

if (!itemNo) {
  console.error('사용법: node --env-file=.env cleanup-orphan-cancel-details.js <item_no> [--dry-run]');
  process.exit(1);
}

async function main() {
  console.log('='.repeat(60));
  console.log(`대상 item_no : ${itemNo}`);
  console.log(`모드         : ${dryRun ? 'DRY-RUN (조회만)' : '실제 삭제'}`);
  console.log('='.repeat(60));

  // ── 1) ft_cancel_details 조회 (item_no 기준)
  const { data: cdRows, error: cdErr } = await supabase
    .from('ft_cancel_details')
    .select('*')
    .eq('item_no', itemNo)
    .order('created_at', { ascending: true });

  if (cdErr) { console.error('ft_cancel_details 조회 오류:', cdErr); process.exit(1); }

  console.log(`\n[ft_cancel_details] ${cdRows.length}건`);
  cdRows.forEach((r, i) => {
    console.log(`  ${i+1}. id=${r.id}  status=${r.status}  qty=${r.qty}  created_at=${r.created_at}  fulfillments.id=${r['fulfillments.id'] ?? 'NULL'}`);
  });

  if (cdRows.length === 0) {
    console.log('\n정리할 데이터 없음. 종료.');
    return;
  }

  // ── 2) ft_fulfillments 조회 (order_item_id 목록 수집)
  const orderItemIds = [...new Set(cdRows.map(r => r.order_items_id).filter(Boolean))];
  const { data: ffRows, error: ffErr } = await supabase
    .from('ft_fulfillments')
    .select('id, order_item_id, quantity, created_at')
    .in('order_item_id', orderItemIds)
    .eq('type', 'CANCEL');

  if (ffErr) { console.error('ft_fulfillments 조회 오류:', ffErr); process.exit(1); }

  console.log(`\n[ft_fulfillments CANCEL] ${ffRows.length}건`);
  ffRows.forEach((r, i) => {
    console.log(`  ${i+1}. id=${r.id}  qty=${r.quantity}  created_at=${r.created_at}`);
  });

  // ── 3) 고아 cancel_details 찾기
  //   - 'fulfillments.id' 컬럼 값이 NULL이거나
  //   - 'fulfillments.id' 값이 ft_fulfillments에 존재하지 않는 것
  const ffIdSet = new Set(ffRows.map(r => r.id));

  const orphans = cdRows.filter(r => {
    const fid = r['fulfillments.id'];
    return !fid || !ffIdSet.has(fid);
  });

  console.log(`\n[고아 cancel_details] ${orphans.length}건`);
  orphans.forEach((r, i) => {
    console.log(`  ${i+1}. id=${r.id}  fulfillments.id=${r['fulfillments.id'] ?? 'NULL'}  created_at=${r.created_at}`);
  });

  if (orphans.length === 0) {
    console.log('\n고아 데이터 없음. 종료.');
    return;
  }

  // ── 4) 삭제
  if (dryRun) {
    console.log('\n[DRY-RUN] 위 고아 데이터를 삭제할 예정입니다. --dry-run 제거 후 재실행하세요.');
    return;
  }

  const orphanIds = orphans.map(r => r.id);
  const { error: delErr } = await supabase
    .from('ft_cancel_details')
    .delete()
    .in('id', orphanIds);

  if (delErr) {
    console.error('\n삭제 오류:', delErr);
    process.exit(1);
  }

  // ── 5) 검증
  const { data: verify } = await supabase
    .from('ft_cancel_details')
    .select('id')
    .in('id', orphanIds);

  const remaining = verify?.length ?? 0;
  if (remaining === 0) {
    console.log(`\n✅ 고아 데이터 ${orphanIds.length}건 삭제 완료`);
  } else {
    console.error(`\n❌ 삭제 검증 실패: ${remaining}건 남아있음`);
  }
}

main().catch(err => {
  console.error('예외 발생:', err);
  process.exit(1);
});
