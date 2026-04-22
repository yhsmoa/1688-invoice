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
// ============================================================

import { createClient } from '@supabase/supabase-js'

if (!process.env.STOCK_SUPABASE_URL) {
  throw new Error('STOCK_SUPABASE_URL 환경변수가 설정되지 않았습니다.')
}

if (!process.env.STOCK_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('STOCK_SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.')
}

const stockSupabaseUrl = process.env.STOCK_SUPABASE_URL
const stockSupabaseKey = process.env.STOCK_SUPABASE_SERVICE_ROLE_KEY

export const stockSupabase = createClient(stockSupabaseUrl, stockSupabaseKey, {
  db: {
    schema: 'public',
  },
  auth: {
    persistSession: false,
  },
})

// ── 상수: Storage 버킷명 (하드코딩 방지) ──
export const PERSONAL_INVOICE_BUCKET = 'personal-order-invoices'
