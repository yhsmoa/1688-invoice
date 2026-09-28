-- ============================================================
-- 1688 배송 이력 — im_1688_delivery_history
--
-- 배경:
--   im_1688_orders_delivery_status 는 배송상황 CSV 업로드마다 전체 삭제 후
--   재삽입되는 스냅샷이다. 배송완료 후 수령확인이 끝난 주문은 1688 목록
--   (待收货 탭)에서 빠져 다음 CSV 에 나오지 않으므로, 스냅샷만으로는
--   "언제 배송완료 됐는지" 가 남지 않는다.
--   → 업로드 때마다 주문별 전환 시각을 이 테이블에 누적한다 (삭제 없음).
--
-- 시각은 "구간" 으로 저장한다 (CSV 에 실제 서명 시각이 없음):
--   *_seen_at   : 그 단계로 처음 관찰된 업로드 시각 (상한)
--   *_after_at  : 그 직전 업로드 시각 = 아직 그 단계가 아니었던 마지막 관찰 (하한)
--                 첫 등장부터 그 단계였으면 NULL (상한만 있음 = upper_only)
--   추정 시각   : 하한이 있으면 (하한+상한)/2, 없으면 상한
--
-- 규칙:
--   · 이미 기록된 *_seen_at 은 절대 덮어쓰지 않는다 (같은 파일 재업로드·환불 전환에도 유지)
--   · last_status / last_seen_at / courier / tracking_no 는 매 업로드 갱신
--   · 업로드 시각은 함수 안에서 advisory lock 획득 후 clock_timestamp() 로 정한다
--     → 동시 업로드가 직렬화되고, 하한 < 상한 이 항상 성립한다
--
-- 호출: POST /api/upload-delivery-status-csv — 검증 통과 후, 스냅샷 삭제 전.
--   실패하면 업로드를 중단해 스냅샷을 보존한다.
--
-- 권한: RLS 켜고 정책 없음 → service role(서버)만 접근.
--   purchase-agent 가 같은 프로젝트를 anon/authenticated 로 쓰므로 함수 실행 권한도 회수.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-09-28)
-- ============================================================


-- ============================================================
-- 1) 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS public.im_1688_delivery_history (
  order_no            text PRIMARY KEY,           -- 1688 주문번호 (스냅샷 "1688_order_no" 와 동일)
  ordered_at          timestamptz,                -- 주문일시 (CSV 중국시간 → UTC). 최초 값 유지
  shipped_seen_at     timestamptz,                -- 집하대기/운송중으로 처음 관찰된 업로드 시각 (상한)
  shipped_after_at    timestamptz,                -- 그 직전 업로드 시각 (하한)
  delivered_seen_at   timestamptz,                -- 배송완료로 처음 관찰된 업로드 시각 (상한)
  delivered_after_at  timestamptz,                -- 그 직전 업로드 시각 (하한)
  delivered_status    text,                       -- 관찰 당시 원문 상태 (已签收 / 已收货未到账)
  last_status         text,                       -- 마지막 관찰 원문 상태
  last_seen_at        timestamptz NOT NULL,       -- 마지막으로 CSV 에 등장한 업로드 시각
  courier             text,
  tracking_no         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_im_1688_delivery_history_delivered_seen_at
  ON public.im_1688_delivery_history (delivered_seen_at);

ALTER TABLE public.im_1688_delivery_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.im_1688_delivery_history IS
  '1688 주문 배송 전환 이력 (배송상황 CSV 업로드마다 누적, 삭제 없음). 처리속도 통계용.';


-- ============================================================
-- 2) 추정 배송완료 시각 — 하한 있으면 중간값, 없으면 상한
-- ============================================================
CREATE OR REPLACE FUNCTION public.im_1688_delivered_estimate(
  p_after_at timestamptz,
  p_seen_at  timestamptz
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_seen_at IS NULL  THEN NULL
    WHEN p_after_at IS NULL THEN p_seen_at
    ELSE p_after_at + (p_seen_at - p_after_at) / 2
  END
$$;


-- ============================================================
-- 3) 업로드 1회분 반영
--   p_rows: [{ order_no, ordered_at, phase, status, courier, tracking_no }]
--     phase = lib/deliveryPhase 결과 ('pending'|'pickup'|'transit'|'delivered'|'abnormal'|null)
--     주문당 1행 (서버에서 lib/deliveryRowPick 로 대표 행 선택 후 전달)
--   반환: 업로드 시각, 반영 건수, 신규 발송/배송완료 건수
-- ============================================================
CREATE OR REPLACE FUNCTION public.im_1688_delivery_history_apply(p_rows jsonb)
RETURNS TABLE (upload_at timestamptz, applied int, newly_shipped int, newly_delivered int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_now timestamptz;
BEGIN
  -- ── 동시 업로드 직렬화 — 업로드 시각은 잠금 획득 "후" 에 정한다 ──
  PERFORM pg_advisory_xact_lock(hashtext('im_1688_delivery_history_apply'));
  v_now := clock_timestamp();

  RETURN QUERY
  WITH src AS (
    -- 방어: 같은 주문이 두 번 오면 ON CONFLICT 가 실패하므로 1행만 남긴다
    SELECT DISTINCT ON (btrim(r.order_no))
      btrim(r.order_no) AS order_no,
      r.ordered_at,
      r.phase,
      r.status,
      NULLIF(btrim(r.courier), '')     AS courier,
      NULLIF(btrim(r.tracking_no), '') AS tracking_no
    FROM jsonb_to_recordset(p_rows) AS r(
      order_no text, ordered_at timestamptz, phase text, status text,
      courier text, tracking_no text
    )
    WHERE r.order_no IS NOT NULL AND btrim(r.order_no) <> ''
    ORDER BY btrim(r.order_no)
  ),
  up AS (
    INSERT INTO im_1688_delivery_history AS h (
      order_no, ordered_at,
      shipped_seen_at, delivered_seen_at, delivered_status,
      last_status, last_seen_at, courier, tracking_no
    )
    SELECT
      s.order_no,
      s.ordered_at,
      CASE WHEN s.phase IN ('pickup', 'transit') THEN v_now END,
      CASE WHEN s.phase = 'delivered'            THEN v_now END,
      CASE WHEN s.phase = 'delivered'            THEN s.status END,
      s.status,
      v_now,
      s.courier,
      s.tracking_no
    FROM src s
    ON CONFLICT (order_no) DO UPDATE SET
      -- ※ SET 절의 h.* 는 "갱신 전" 기존 행 값이다.
      --    따라서 h.last_seen_at = 직전 업로드 시각 → 새 전환의 하한으로 쓴다.
      ordered_at = COALESCE(h.ordered_at, EXCLUDED.ordered_at),

      shipped_after_at = CASE
        WHEN h.shipped_seen_at IS NULL AND EXCLUDED.shipped_seen_at IS NOT NULL THEN h.last_seen_at
        ELSE h.shipped_after_at END,
      shipped_seen_at = COALESCE(h.shipped_seen_at, EXCLUDED.shipped_seen_at),

      delivered_after_at = CASE
        WHEN h.delivered_seen_at IS NULL AND EXCLUDED.delivered_seen_at IS NOT NULL THEN h.last_seen_at
        ELSE h.delivered_after_at END,
      delivered_status = CASE
        WHEN h.delivered_seen_at IS NULL THEN EXCLUDED.delivered_status
        ELSE h.delivered_status END,
      delivered_seen_at = COALESCE(h.delivered_seen_at, EXCLUDED.delivered_seen_at),

      last_status  = EXCLUDED.last_status,
      last_seen_at = EXCLUDED.last_seen_at,
      courier      = COALESCE(EXCLUDED.courier, h.courier),
      tracking_no  = COALESCE(EXCLUDED.tracking_no, h.tracking_no),
      updated_at   = v_now
    RETURNING h.shipped_seen_at, h.delivered_seen_at
  )
  SELECT
    v_now,
    count(*)::int,
    -- v_now 는 이번 호출에만 쓰이는 값 → 이번에 처음 기록된 전환만 센다
    count(*) FILTER (WHERE up.shipped_seen_at   = v_now)::int,
    count(*) FILTER (WHERE up.delivered_seen_at = v_now)::int
  FROM up;
END;
$$;

REVOKE ALL ON FUNCTION public.im_1688_delivery_history_apply(jsonb)
  FROM PUBLIC, anon, authenticated;
