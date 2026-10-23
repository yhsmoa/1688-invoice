import { createClient } from '@supabase/supabase-js'

// ============================================================
// Supabase 서버 클라이언트 (service role) — manage-item
// ============================================================

if (!process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_URL 환경변수가 설정되지 않았습니다.')
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.')
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// ── DB 조회는 항상 새로 — Next.js 데이터 캐시에 저장하지 않는다 ──
//   Next.js 14 App Router 는 서버에서 나가는 GET fetch 를 데이터 캐시에 저장한다.
//   supabase-js 의 select 도 GET fetch 라서, 라우트에 dynamic = 'force-dynamic' 이 있어도
//   첫 응답이 저장돼 이후 요청에 그대로 재사용됐다.
//   (2026-10-24 급여장부: 배포 직후 빈 지급 목록이 저장돼 [급여지급완료] 표시가 안 보임 —
//    .next/cache/fetch-cache 에 직원·출근기록·지급항목 조회가 저장된 것을 확인)
//   DB 는 항상 최신 값을 읽어야 하므로 클라이언트의 모든 요청을 no-store 로 보낸다.
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' })

export const supabase = createClient(supabaseUrl, supabaseKey, {
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'x-my-custom-header': 'my-app-name'
    },
    fetch: noStoreFetch,
  },
  // 기본 페이지 크기 제한 해제
  auth: {
    persistSession: false,
  },
})
