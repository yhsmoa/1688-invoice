// ============================================================
// stock_management 프로젝트 전용 Supabase Service Role Client
//
// 본 클라이언트는 별도 Supabase 프로젝트(stock_management)에 접근하기 위해
// 1688-invoice 프로젝트의 기본 supabase client (lib/supabase.ts)와 분리한다.
//
// - 서버 전용 (service_role 키 포함 → 절대 클라이언트로 import 금지)
// - 주요 용도:
//     1. si_users.order_user_id → si_users.id 매핑 조회
//     2. Storage 버킷 personal-order-invoices 접근 (PDF 송장 파일)
//
// ⚠️ 초기화는 lazy 로 처리 (getStockSupabase()) — 모듈 import 시점에 env var
//    미설정 시 throw 되면 Next.js build 의 "Collecting page data" 단계가 실패함.
//    env var 은 런타임 요청 처리 시점에만 검증되도록 함수 내부로 이동.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ── 상수: Storage 버킷명 (하드코딩 방지) ──
export const PERSONAL_INVOICE_BUCKET = 'personal-order-invoices'

// ── lazy singleton ──
let cached: SupabaseClient | null = null

/**
 * stock_management 프로젝트 Supabase client 를 반환.
 * env var 미설정 시 호출 시점에 throw (모듈 로드 시점 X → build 안전).
 */
export function getStockSupabase(): SupabaseClient {
  if (cached) return cached

  const url = process.env.STOCK_SUPABASE_URL
  const key = process.env.STOCK_SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('STOCK_SUPABASE_URL 환경변수가 설정되지 않았습니다.')
  }
  if (!key) {
    throw new Error('STOCK_SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.')
  }

  cached = createClient(url, key, {
    db: { schema: 'public' },
    auth: { persistSession: false },
  })
  return cached
}
