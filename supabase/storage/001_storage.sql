-- ============================================================
-- 보관(STOCK) 경로 + 재고 위치 원장 — docs/PLAN_stock-type-S.md
--
-- 두 축 (서로 독립)
--   포장 타입   : shipment_type + coupang_shipment_size → A/B/C/P/X  (변경 없음)
--   입고 후 경로: arrival_route = SHIPMENT(바로 쉽먼트) / STOCK(보관)  ← 신규
--
-- 보관 상품 흐름
--   ARRIVAL(입고) ─▶ [작업중] 미배치 ─ PUTAWAY ─▶ [재고] 위치별 수량 ─ PICK ─▶ PACKED(박스) ─▶ 쉽먼트 V2 이후 동일
--
-- 수량 단위 = 상품(product_id) 단위 — 세트상품은 1세트 = 1
--   입고(ARRIVAL)는 세트 구성품(sibling)마다 따로 기록되지만, 포장(PACKED)·DONE 판정은
--   product_id 하나로 센다 (상품출고 V2 · lib/confirmDone 과 동일). 원장도 같은 단위.
--   · 완성 세트 수   = MIN over sibling (Σ ARRIVAL − Σ RETURN)
--   · 미배치(상품)   = 완성 세트 수 − Σ PUTAWAY − 미연결 PACKED
--       미연결 PACKED = Σ PACKED(product) − (Σ PICK − Σ UNPACK)
--         → 보관 지정 전에 일반 경로로 이미 포장된 수량은 배치 대상이 아니다 (양수)
--         → 재고에서 꺼내 포장했다가 원장 링크 없이 철회된 수량(분할 이동 행 철회)은
--           선반 밖에 나와 있으므로 다시 [작업중]에 나타난다 (음수)
--   · [작업중] 한 줄 = "완성 세트 수를 늘린 입고 건" — 단품이면 입고 건 1건과 같다.
--     미배치는 오래된 줄부터 FIFO 로 소진.
--
-- 원장 ft_storage_movements (append-only, 재고의 단일 진실)
--   PUTAWAY  +  입고분을 위치에 배치
--   PICK     −  위치에서 꺼내 박스에 담음 (outbound_id = 만들어진 PACKED 행)
--   UNPACK   +  재고에서 담은 PACKED 행을 포장 철회 → 꺼냈던 위치로 복귀
--   MOVE_OUT −  / MOVE_IN +  위치 이동 (move_group_id 로 짝)
--   ADJUST      실사 조정 (1차 범위 제외 — 함수 없음)
--
-- 권한
--   · 테이블·뷰: RLS 끔 (다른 ft_* 와 동일, 팀 격리는 user_id 조건) — anon 은 SELECT 만
--   · 쓰기는 함수로만 (service role 전용). arrival_route 가드 트리거는 anon UPDATE 경로도 막는다.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-02)
-- ============================================================

-- ============================================================
-- 1) 입고 후 경로 컬럼
-- ============================================================
-- DEFAULT 상수 컬럼 추가는 PG11+ 메타데이터 변경 → 기존 행 즉시 SHIPMENT
ALTER TABLE public.ft_order_items
  ADD COLUMN IF NOT EXISTS arrival_route text NOT NULL DEFAULT 'SHIPMENT';
ALTER TABLE public.ft_cart_items
  ADD COLUMN IF NOT EXISTS arrival_route text NOT NULL DEFAULT 'SHIPMENT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ft_order_items_arrival_route_check') THEN
    ALTER TABLE public.ft_order_items
      ADD CONSTRAINT ft_order_items_arrival_route_check CHECK (arrival_route IN ('SHIPMENT','STOCK'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ft_cart_items_arrival_route_check') THEN
    ALTER TABLE public.ft_cart_items
      ADD CONSTRAINT ft_cart_items_arrival_route_check CHECK (arrival_route IN ('SHIPMENT','STOCK'));
  END IF;
END $$;

COMMENT ON COLUMN public.ft_order_items.arrival_route IS
  '입고 후 경로 — SHIPMENT: 바로 상품출고 / STOCK: 재고(보관) 위치에 배치. 포장 타입(shipment_type)과 독립';

CREATE INDEX IF NOT EXISTS ft_order_items_route_stock_idx
  ON public.ft_order_items (user_id) WHERE arrival_route = 'STOCK';
-- 세트 sibling 조회 (product_id → 구성품 행)
CREATE INDEX IF NOT EXISTS ft_order_items_product_id_idx
  ON public.ft_order_items (product_id);

-- ============================================================
-- 2) 위치 — 창고 공용, 첫 배치 때 자동 등록
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_storage_locations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE,
  name       text,
  zone       text,
  sort       int,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

COMMENT ON TABLE public.ft_storage_locations IS
  '재고(보관) 위치 — code 는 스캔 값 upper(trim). 쓰기는 ft_storage_* 함수로만';

ALTER TABLE public.ft_storage_locations DISABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ft_storage_locations FROM anon, authenticated;
GRANT SELECT ON public.ft_storage_locations TO anon, authenticated;

-- ============================================================
-- 3) 원장
--   inbound_id / outbound_id 에 FK 를 걸지 않는다 — 입고·포장 행이 철회돼도 이력은 남긴다
--   (ft_move_requests 와 같은 이유)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_storage_movements (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       uuid        NOT NULL,
  product_id    uuid        NOT NULL,
  order_item_id uuid        NOT NULL,
  inbound_id    uuid,
  location_id   uuid        NOT NULL REFERENCES public.ft_storage_locations(id),
  kind          text        NOT NULL
                            CHECK (kind IN ('PUTAWAY','PICK','UNPACK','MOVE_OUT','MOVE_IN','ADJUST')),
  quantity      int         NOT NULL CHECK (quantity > 0),
  delta         int         NOT NULL,
  outbound_id   uuid,
  move_group_id uuid,
  operator_name text,
  note          text,
  -- 부호는 kind 가 정한다 (ADJUST 만 양방향)
  CONSTRAINT ft_storage_movements_delta_sign CHECK (
    (kind IN ('PUTAWAY','UNPACK','MOVE_IN') AND delta = quantity)
    OR (kind IN ('PICK','MOVE_OUT') AND delta = -quantity)
    OR (kind = 'ADJUST' AND abs(delta) = quantity)
  )
);

COMMENT ON TABLE public.ft_storage_movements IS
  '재고(보관) 원장 — append-only. 위치별 재고 = SUM(delta). 쓰기는 ft_storage_* 함수로만';

CREATE INDEX IF NOT EXISTS ft_storage_movements_balance_idx
  ON public.ft_storage_movements (user_id, product_id, location_id);
CREATE INDEX IF NOT EXISTS ft_storage_movements_product_idx
  ON public.ft_storage_movements (product_id);
CREATE INDEX IF NOT EXISTS ft_storage_movements_outbound_idx
  ON public.ft_storage_movements (outbound_id) WHERE outbound_id IS NOT NULL;

ALTER TABLE public.ft_storage_movements DISABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ft_storage_movements FROM anon, authenticated;
GRANT SELECT ON public.ft_storage_movements TO anon, authenticated;

-- ============================================================
-- 4) 위치별 재고 뷰 — 0 이 된 칸은 사라지고, 음수는 그대로 노출 (운영 이상 신호)
-- ============================================================
CREATE OR REPLACE VIEW public.ft_storage_balance
WITH (security_invoker = true) AS
SELECT user_id, product_id, location_id,
       SUM(delta)::int      AS qty,
       MAX(created_at)      AS last_moved_at,
       MIN(created_at) FILTER (WHERE kind = 'PUTAWAY') AS first_putaway_at
  FROM public.ft_storage_movements
 GROUP BY user_id, product_id, location_id
HAVING SUM(delta) <> 0;

GRANT SELECT ON public.ft_storage_balance TO anon, authenticated;

-- ============================================================
-- 5) 상품 사이즈 코드 — lib/sizeCode.ts resolveScanSizeCode 의 SQL 판
--   PERSONAL → P / COUPANG + small·medium·large → A·B·C (p-* → P, direct → X, A~X 그대로)
--   COUPANG 매칭 실패 · DIRECT · 기타 → X
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_item_size_code(p_shipment_type text, p_size text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE upper(trim(COALESCE(p_shipment_type, '')))
    WHEN 'PERSONAL' THEN 'P'
    WHEN 'COUPANG' THEN
      CASE
        WHEN lower(trim(COALESCE(p_size, ''))) = 'small'  THEN 'A'
        WHEN lower(trim(COALESCE(p_size, ''))) = 'medium' THEN 'B'
        WHEN lower(trim(COALESCE(p_size, ''))) = 'large'  THEN 'C'
        WHEN lower(trim(COALESCE(p_size, ''))) LIKE 'p-%' THEN 'P'
        WHEN lower(trim(COALESCE(p_size, ''))) = 'direct' THEN 'X'
        WHEN upper(trim(COALESCE(p_size, ''))) IN ('A','B','C','P','X') THEN upper(trim(p_size))
        ELSE 'X'
      END
    ELSE 'X'
  END;
$$;

-- ============================================================
-- 6) [작업중] 줄 — 미배치 계산의 단일 소스 (API 표시 · putaway 검증 공용)
--
--   반환: 입고 줄 단위 (product_id, inbound_id, order_item_id, arrived_at, operator_name,
--                       line_qty, line_unplaced)
--   대상: arrival_route='STOCK' 이고 DONE 이 아닌 sibling 이 있는 상품
--   p_product_id 를 주면 그 상품만
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_pending_lines(p_user_id uuid, p_product_id uuid DEFAULT NULL)
RETURNS TABLE (
  product_id    uuid,
  inbound_id    uuid,
  order_item_id uuid,
  arrived_at    timestamptz,
  operator_name text,
  line_qty      int,
  line_unplaced int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH products AS (
    SELECT DISTINCT oi.product_id
      FROM ft_order_items oi
     WHERE oi.user_id = p_user_id
       AND oi.arrival_route = 'STOCK'
       AND oi.product_id IS NOT NULL
       AND oi.status IS DISTINCT FROM 'DONE'
       AND (p_product_id IS NULL OR oi.product_id = p_product_id)
  ),
  sib AS (
    SELECT oi.product_id, oi.id AS order_item_id
      FROM ft_order_items oi
      JOIN products p ON p.product_id = oi.product_id
     WHERE oi.user_id = p_user_id
  ),
  arr AS (
    SELECT s.product_id, f.id, f.order_item_id, f.created_at, f.operator_name, f.quantity
      FROM ft_fulfillment_inbounds f
      JOIN sib s ON s.order_item_id = f.order_item_id
     WHERE f.type = 'ARRIVAL'
  ),
  -- ── 상품 단위 합계: 완성 세트 수 (반품 전/후) ──
  per_sib AS (
    SELECT s.product_id, s.order_item_id,
           COALESCE(SUM(f.quantity) FILTER (WHERE f.type = 'ARRIVAL'), 0) AS a,
           COALESCE(SUM(f.quantity) FILTER (WHERE f.type = 'RETURN'), 0)  AS r
      FROM sib s
      LEFT JOIN ft_fulfillment_inbounds f ON f.order_item_id = s.order_item_id
     GROUP BY s.product_id, s.order_item_id
  ),
  sets AS (
    SELECT product_id, MIN(a) AS sets_arrived, MIN(a - r) AS sets_net
      FROM per_sib GROUP BY product_id
  ),
  ledger AS (
    SELECT m.product_id,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.kind = 'PUTAWAY'), 0) AS placed,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.kind = 'PICK'), 0)
             - COALESCE(SUM(m.quantity) FILTER (WHERE m.kind = 'UNPACK'), 0) AS net_picked
      FROM ft_storage_movements m
      JOIN products p ON p.product_id = m.product_id
     WHERE m.user_id = p_user_id
     GROUP BY m.product_id
  ),
  packed AS (
    SELECT o.product_id, COALESCE(SUM(o.quantity), 0) AS packed
      FROM ft_fulfillment_outbounds o
      JOIN products p ON p.product_id = o.product_id
     WHERE o.user_id = p_user_id AND o.type = 'PACKED'
     GROUP BY o.product_id
  ),
  -- ── FIFO 로 먼저 소진되는 수량 ──
  consumed AS (
    SELECT s.product_id,
           COALESCE(l.placed, 0)
           + (COALESCE(pk.packed, 0) - COALESCE(l.net_picked, 0))   -- 미연결 PACKED
           + (s.sets_arrived - s.sets_net)                           -- 반품된 세트
             AS qty
      FROM sets s
      LEFT JOIN ledger l  ON l.product_id  = s.product_id
      LEFT JOIN packed pk ON pk.product_id = s.product_id
  ),
  -- ── 입고 줄: 이 입고로 완성 세트 수가 몇 늘었나 ──
  events AS (
    SELECT a.product_id, a.id, a.order_item_id, a.created_at, a.operator_name,
           (SELECT MIN(cum) FROM (
              SELECT COALESCE(SUM(a2.quantity), 0) AS cum
                FROM sib s2
                LEFT JOIN arr a2
                  ON a2.order_item_id = s2.order_item_id
                 AND (a2.created_at, a2.id) <= (a.created_at, a.id)
               WHERE s2.product_id = a.product_id
               GROUP BY s2.order_item_id
            ) c) AS complete_at
      FROM arr a
  ),
  lines AS (
    SELECT e.*,
           (e.complete_at - COALESCE(LAG(e.complete_at) OVER w, 0))::int AS line_qty
      FROM events e
    WINDOW w AS (PARTITION BY e.product_id ORDER BY e.created_at, e.id)
  ),
  fifo AS (
    SELECT l.*,
           SUM(l.line_qty) OVER (PARTITION BY l.product_id ORDER BY l.created_at, l.id) AS cum_qty
      FROM lines l
     WHERE l.line_qty > 0
  )
  SELECT f.product_id, f.id, f.order_item_id, f.created_at, f.operator_name,
         f.line_qty,
         GREATEST(0, LEAST(f.line_qty, f.cum_qty - c.qty))::int
    FROM fifo f
    JOIN consumed c ON c.product_id = f.product_id
   ORDER BY f.created_at, f.id;
$$;

-- ============================================================
-- 7) 배치 (PUTAWAY)
--   p_inbound_id 는 화면에서 고른 [작업중] 줄 (기록용) — 수량 검증은 상품 단위 미배치 합계
-- 오류: PUTAWAY_NOT_STOCK / PUTAWAY_INVALID_QTY / PUTAWAY_INVALID_LOCATION
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_putaway(
  p_user_id       uuid,
  p_product_id    uuid,
  p_inbound_id    uuid,
  p_location_code text,
  p_qty           int,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_code      text := upper(trim(COALESCE(p_location_code, '')));
  v_item_id   uuid;
  v_unplaced  int;
  v_loc       ft_storage_locations%ROWTYPE;
BEGIN
  IF v_code = '' THEN
    RAISE EXCEPTION 'PUTAWAY_INVALID_LOCATION';
  END IF;

  -- ── 같은 상품의 배치·꺼내기를 직렬화 ──
  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

  -- ── 입고 줄 검증: 같은 사용자 · 같은 상품 · 보관 경로 ──
  SELECT f.order_item_id INTO v_item_id
    FROM ft_fulfillment_inbounds f
    JOIN ft_order_items oi ON oi.id = f.order_item_id
   WHERE f.id = p_inbound_id
     AND f.type = 'ARRIVAL'
     AND oi.user_id = p_user_id
     AND oi.product_id = p_product_id
     AND oi.arrival_route = 'STOCK';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUTAWAY_NOT_STOCK';
  END IF;

  SELECT COALESCE(SUM(line_unplaced), 0) INTO v_unplaced
    FROM ft_storage_pending_lines(p_user_id, p_product_id);
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > v_unplaced THEN
    RAISE EXCEPTION 'PUTAWAY_INVALID_QTY';
  END IF;

  -- ── 위치: 없으면 자동 등록 ──
  INSERT INTO ft_storage_locations (code, created_by)
  VALUES (v_code, p_operator_name)
  ON CONFLICT (code) DO NOTHING;
  SELECT * INTO v_loc FROM ft_storage_locations WHERE code = v_code;

  INSERT INTO ft_storage_movements (
    user_id, product_id, order_item_id, inbound_id, location_id,
    kind, quantity, delta, operator_name
  ) VALUES (
    p_user_id, p_product_id, v_item_id, p_inbound_id, v_loc.id,
    'PUTAWAY', p_qty, p_qty, p_operator_name
  );

  RETURN jsonb_build_object(
    'location_id',   v_loc.id,
    'location_code', v_loc.code,
    'remaining',     v_unplaced - p_qty
  );
END;
$$;

-- ============================================================
-- 8) 재고 → 쉽먼트 (PICK + PACKED 한 트랜잭션)
--   p_picks: [{ "location_id": uuid, "qty": int }, ...]
--   만들어지는 PACKED 행은 상품출고 V2 가 만드는 행과 같은 모양 → 쉽먼트 V2 이후 동일
-- 오류: PICK_ITEM_INVALID / PICK_BOX_NOT_OPEN / PICK_BOX_TYPE_MISMATCH:<박스>:<상품>
--       PICK_INVALID_QTY
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_pick_to_shipment(
  p_user_id       uuid,
  p_product_id    uuid,
  p_order_item_id uuid,
  p_picks         jsonb,
  p_box_info_id   uuid,
  p_operator_name text DEFAULT NULL,
  p_force         boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item      ft_order_items%ROWTYPE;
  v_box       ft_box_info%ROWTYPE;
  v_box_type  text;
  v_item_type text;
  v_pick      record;
  v_total     int := 0;
  v_balance   int;
  v_codes     text[] := '{}';
  v_code      text;
  v_out_id    uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

  -- ── 주문 행 ──
  SELECT * INTO v_item FROM ft_order_items WHERE id = p_order_item_id;
  IF NOT FOUND
     OR v_item.user_id IS DISTINCT FROM p_user_id
     OR v_item.product_id IS DISTINCT FROM p_product_id
     OR v_item.arrival_route <> 'STOCK'
     OR v_item.status = 'DONE' THEN
    RAISE EXCEPTION 'PICK_ITEM_INVALID';
  END IF;

  -- ── 박스: 같은 사용자 · 출고 전 · 포장 중 (ft_move_outbound 와 같은 기준) ──
  SELECT * INTO v_box FROM ft_box_info WHERE id = p_box_info_id FOR SHARE;
  IF NOT FOUND
     OR v_box.user_id IS DISTINCT FROM p_user_id
     OR v_box.shipment_id IS NOT NULL
     OR v_box.status IS DISTINCT FROM 'PACKING' THEN
    RAISE EXCEPTION 'PICK_BOX_NOT_OPEN';
  END IF;

  -- ── 박스 타입 = 상품 사이즈 코드 (허용 모드면 건너뜀) ──
  v_box_type  := ft_box_effective_type(p_box_info_id);
  v_item_type := ft_item_size_code(v_item.shipment_type, v_item.coupang_shipment_size);
  IF NOT p_force AND v_box_type IS DISTINCT FROM v_item_type THEN
    RAISE EXCEPTION 'PICK_BOX_TYPE_MISMATCH:%:%', COALESCE(v_box_type, '-'), v_item_type;
  END IF;

  -- ── 위치별 잔량 검증 ──
  IF p_picks IS NULL OR jsonb_typeof(p_picks) <> 'array' OR jsonb_array_length(p_picks) = 0 THEN
    RAISE EXCEPTION 'PICK_INVALID_QTY';
  END IF;
  FOR v_pick IN
    SELECT (e->>'location_id')::uuid AS location_id, SUM((e->>'qty')::int)::int AS qty
      FROM jsonb_array_elements(p_picks) e
     GROUP BY 1
  LOOP
    IF v_pick.qty IS NULL OR v_pick.qty < 1 THEN
      RAISE EXCEPTION 'PICK_INVALID_QTY';
    END IF;
    SELECT COALESCE(SUM(delta), 0) INTO v_balance
      FROM ft_storage_movements
     WHERE user_id = p_user_id AND product_id = p_product_id AND location_id = v_pick.location_id;
    IF v_pick.qty > v_balance THEN
      RAISE EXCEPTION 'PICK_INVALID_QTY';
    END IF;
    SELECT code INTO v_code FROM ft_storage_locations WHERE id = v_pick.location_id;
    v_codes := v_codes || v_code;
    v_total := v_total + v_pick.qty;
  END LOOP;

  -- ── PACKED 1행 ──
  INSERT INTO ft_fulfillment_outbounds (
    order_item_id, type, quantity, note,
    order_no, product_no, product_id,
    box_code, box_info_id,
    operator_name, user_id
  ) VALUES (
    v_item.id, 'PACKED', v_total, 'STOCK ' || array_to_string(v_codes, ','),
    array_to_string((string_to_array(v_item.order_no, '-'))[1:3], '-'),
    v_item.product_no, v_item.product_id,
    v_box.box_code, v_box.id,
    p_operator_name, p_user_id
  )
  RETURNING id INTO v_out_id;

  -- ── PICK 원장 (위치마다) ──
  INSERT INTO ft_storage_movements (
    user_id, product_id, order_item_id, location_id,
    kind, quantity, delta, outbound_id, operator_name
  )
  SELECT p_user_id, p_product_id, v_item.id, (e->>'location_id')::uuid,
         'PICK', SUM((e->>'qty')::int), -SUM((e->>'qty')::int), v_out_id, p_operator_name
    FROM jsonb_array_elements(p_picks) e
   GROUP BY (e->>'location_id')::uuid;

  RETURN jsonb_build_object('outbound_id', v_out_id, 'box_code', v_box.box_code, 'picked', v_total);
END;
$$;

-- ============================================================
-- 9) 포장 철회 (재고에서 담은 PACKED 행) — 행 삭제 + 꺼냈던 위치로 UNPACK
--   현재 행 수량만큼만 되돌린다 (분할 이동으로 줄었으면 남은 수량만, PICK 순서대로 배분)
--   분할로 생긴 새 행(링크 없음)은 이 함수 대상이 아니다 → 미연결 PACKED 가 줄어
--   [작업중]에 다시 나타난다.
-- 반환: { returned, locations } / 링크된 PICK 이 없으면 { returned: 0 } (삭제하지 않음)
-- 오류: UNPICK_ROW_NOT_FOUND / UNPICK_ROW_SHIPPED
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_unpick_outbound(
  p_outbound_id   uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_out    ft_fulfillment_outbounds%ROWTYPE;
  v_left   int;
  v_pick   record;
  v_take   int;
  v_codes  text[] := '{}';
BEGIN
  SELECT * INTO v_out FROM ft_fulfillment_outbounds WHERE id = p_outbound_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNPICK_ROW_NOT_FOUND';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ft_storage_movements WHERE outbound_id = p_outbound_id AND kind = 'PICK') THEN
    RETURN jsonb_build_object('returned', 0);
  END IF;
  IF v_out.shipment_id IS NOT NULL THEN
    RAISE EXCEPTION 'UNPICK_ROW_SHIPPED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || v_out.product_id::text));

  v_left := COALESCE(v_out.quantity, 0);
  FOR v_pick IN
    SELECT m.location_id, m.order_item_id, m.user_id, m.product_id, SUM(m.quantity)::int AS qty, MIN(m.created_at) AS at
      FROM ft_storage_movements m
     WHERE m.outbound_id = p_outbound_id AND m.kind = 'PICK'
     GROUP BY m.location_id, m.order_item_id, m.user_id, m.product_id
     ORDER BY MIN(m.created_at), m.location_id
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, v_pick.qty);
    INSERT INTO ft_storage_movements (
      user_id, product_id, order_item_id, location_id,
      kind, quantity, delta, outbound_id, operator_name, note
    ) VALUES (
      v_pick.user_id, v_pick.product_id, v_pick.order_item_id, v_pick.location_id,
      'UNPACK', v_take, v_take, p_outbound_id, p_operator_name, 'unpack'
    );
    v_codes := v_codes || (SELECT code FROM ft_storage_locations WHERE id = v_pick.location_id);
    v_left := v_left - v_take;
  END LOOP;

  DELETE FROM ft_fulfillment_outbounds WHERE id = p_outbound_id;

  RETURN jsonb_build_object(
    'returned',  COALESCE(v_out.quantity, 0) - v_left,
    'locations', to_jsonb(v_codes)
  );
END;
$$;

-- ============================================================
-- 10) 위치 이동 (MOVE_OUT / MOVE_IN 짝)
-- 오류: MOVE_INVALID_LOCATION / MOVE_SAME_LOCATION / MOVE_INVALID_QTY
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_move(
  p_user_id          uuid,
  p_product_id       uuid,
  p_from_location_id uuid,
  p_to_location_code text,
  p_qty              int,
  p_operator_name    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_code    text := upper(trim(COALESCE(p_to_location_code, '')));
  v_to      ft_storage_locations%ROWTYPE;
  v_balance int;
  v_item_id uuid;
  v_group   uuid := gen_random_uuid();
BEGIN
  IF v_code = '' THEN
    RAISE EXCEPTION 'MOVE_INVALID_LOCATION';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

  SELECT COALESCE(SUM(delta), 0) INTO v_balance
    FROM ft_storage_movements
   WHERE user_id = p_user_id AND product_id = p_product_id AND location_id = p_from_location_id;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > v_balance THEN
    RAISE EXCEPTION 'MOVE_INVALID_QTY';
  END IF;

  INSERT INTO ft_storage_locations (code, created_by)
  VALUES (v_code, p_operator_name)
  ON CONFLICT (code) DO NOTHING;
  SELECT * INTO v_to FROM ft_storage_locations WHERE code = v_code;
  IF v_to.id = p_from_location_id THEN
    RAISE EXCEPTION 'MOVE_SAME_LOCATION';
  END IF;

  -- 원장 행의 order_item_id — 그 위치에 마지막으로 들어온 기록과 같은 주문 행
  SELECT order_item_id INTO v_item_id
    FROM ft_storage_movements
   WHERE user_id = p_user_id AND product_id = p_product_id AND location_id = p_from_location_id
   ORDER BY created_at DESC LIMIT 1;

  INSERT INTO ft_storage_movements (
    user_id, product_id, order_item_id, location_id, kind, quantity, delta, move_group_id, operator_name
  ) VALUES
    (p_user_id, p_product_id, v_item_id, p_from_location_id, 'MOVE_OUT', p_qty, -p_qty, v_group, p_operator_name),
    (p_user_id, p_product_id, v_item_id, v_to.id,            'MOVE_IN',  p_qty,  p_qty, v_group, p_operator_name);

  RETURN jsonb_build_object('to_location_id', v_to.id, 'to_location_code', v_to.code, 'moved', p_qty);
END;
$$;

-- ============================================================
-- 11) 보관 해제 가드 — 위치에 재고가 남은 상품은 STOCK → SHIPMENT 불가
--   고객 화면(purchase-agent, anon)이 직접 UPDATE 하는 경로까지 막는 최종 방어선
--   (ft_cancel_details_settled_guard 선례)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_order_items_route_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_left int;
BEGIN
  IF OLD.arrival_route = 'STOCK' AND NEW.arrival_route = 'SHIPMENT' AND NEW.product_id IS NOT NULL THEN
    SELECT COALESCE(SUM(delta), 0) INTO v_left
      FROM ft_storage_movements
     WHERE user_id = NEW.user_id AND product_id = NEW.product_id;
    IF v_left > 0 THEN
      RAISE EXCEPTION 'ROUTE_STOCK_REMAINING:%', v_left;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ft_order_items_route_guard ON public.ft_order_items;
CREATE TRIGGER ft_order_items_route_guard
  BEFORE UPDATE OF arrival_route ON public.ft_order_items
  FOR EACH ROW
  WHEN (OLD.arrival_route IS DISTINCT FROM NEW.arrival_route)
  EXECUTE FUNCTION public.ft_order_items_route_guard();

-- ============================================================
-- 12) 권한 — 함수는 service role 전용
-- ============================================================
REVOKE ALL ON FUNCTION public.ft_item_size_code(text, text)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_storage_pending_lines(uuid, uuid)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_storage_putaway(uuid, uuid, uuid, text, int, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_storage_pick_to_shipment(uuid, uuid, uuid, jsonb, uuid, text, boolean)
                                                                                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_storage_unpick_outbound(uuid, text)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_storage_move(uuid, uuid, uuid, text, int, text)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_item_size_code(text, text)                         TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_storage_pending_lines(uuid, uuid)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_storage_putaway(uuid, uuid, uuid, text, int, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_storage_pick_to_shipment(uuid, uuid, uuid, jsonb, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_storage_unpick_outbound(uuid, text)                TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_storage_move(uuid, uuid, uuid, text, int, text)    TO service_role;
-- 트리거 함수는 anon UPDATE 에서도 실행돼야 하므로 EXECUTE 회수하지 않는다 (트리거는 호출 권한을 보지 않음)
