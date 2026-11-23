-- ============================================================
-- 와우출고 — 라벨출력 · 모바일 스캔 작업 · 순서지정 · 합포장 · 마킹번호(출고준비 때 부여)
--   화면: /storage/wow (PC) · /m/wow (모바일) · 앞 단계: supabase/storage/005 ~ 009
--
-- 단계 (판정은 한 곳: app/storage/utils/wowStage.ts — 저장하는 단계 값은 없다)
--   신규      작업 시작 기록 없음                          PC [라벨출력] 로 박스 라벨(발주번호-박스번호)을 뽑는다
--   작업중    모바일에서 박스 라벨을 찍음 (work_started_at)   카드(상품 × 위치)마다 [찾음] · [부족] → ft_wow_finds
--   작업완료  모바일 [작업완료] (picked_at)                  찾은 수량만큼 재고에서 빠진다. 마킹 상자는 아직 없다
--   서류준비  작업완료 + 부착문서 · 동봉문서 도착
--   순서지정  ship_seq 있음                                박스 라벨을 실을 순서대로 스캔 — 그 순서로 서류 · 택배엑셀을 붙인다
--   합포장    attached_at 있음 ([부착완료])                 마대에 담거나(bag_id) 그대로 출고로 정한다(packed_at)
--   출고준비  ready_at 있음                                이때 마킹 상자(ft_box_info)를 만들고 마킹번호를 붙인다
--   출고      포장 행이 전부 출고됨                          쉽먼트 V2
--
-- 바뀌는 원칙 — "담았다" 와 "마킹 상자에 넣었다" 를 나눈다
--   · 지금까지: 담을 때 1688 박스(BR-X-NN)를 골라 1:1 로 묶었다 (box_info_id 있음 = 담음)
--   · 이제부터: 담음 = ft_wow_boxes.picked_at. 포장 행(ft_fulfillment_outbounds)은 상자 없이 만들어 두고,
--     [출고준비완료] 때 실제로 나가는 상자 · 마대 하나에 마킹번호 하나를 순서대로 붙여 그 상자에 묶는다.
--     → 와우 박스 여러 개가 마대 하나(ft_box_info 하나)에 들어갈 수 있다 (box_info_id 의 UNIQUE 를 없앤다)
--     → 쉽먼트 V2 · 통관서류는 지금처럼 "상자 하나에 상품 여러 줄" 로만 본다 (고칠 것이 없다)
--   · 이미 1:1 로 묶인 박스(2026-11-24 까지 담은 51개)는 그대로 둔다 — 붙어 있는 마킹번호를 계속 쓴다.
--
-- 마킹번호 규칙 (BoxCreateModal 과 같다): 그 사업자의 출고 전 X 박스 중 가장 큰 번호 + 1.
--   출고가 끝나 출고 전 박스가 없어지면 다시 1번부터.
--
-- 배포 순서: 이 스크립트 → 1688-invoice 새 화면. 스크립트만 먼저 넣어도 옛 화면은 그대로 동작한다
--   (옛 ft_wow_pick · ft_wow_ready_set 은 남겨 둔다. 새 화면은 ft_wow_pick_found · ft_wow_ready_pack 을 쓴다)
--
-- 잠금: 발주서 잠금(ft_wow_lock) → 상품 잠금. 합포장 · 마킹번호는 사업자 잠금 ft_wow_pack:<user> 을 먼저 잡는다.
-- 권한: 새 함수는 1688-invoice(service role) 전용
-- 오류 추가: WOW_FIND_OVER / WOW_FIND_OVER_STOCK / WOW_FIND_INCOMPLETE / WOW_SIZE_LOCKED / WOW_BOX_SEQUENCED / WOW_SEQ_NOT_READY
--            WOW_SEQ_NOT_SET / WOW_NOT_ATTACHED / WOW_PACK_NOT_ATTACHED / WOW_PACK_HAS_CARTON / WOW_BAG_NOT_OPEN / WOW_BAG_PARTIAL / WOW_NOT_PACKED
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-24) — 적용할 때 자체 시험(옛 박스 둘로 전 단계 → 전부 되돌림)을 같이 돌렸다
-- ============================================================

-- ============================================================
-- 1) 테이블 · 칼럼
-- ============================================================

-- ── 마대 (합포장 묶음) — 마대 번호는 출고 전 마대 중 가장 큰 번호 + 1 ──
CREATE TABLE IF NOT EXISTS public.ft_wow_bags (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,
  bag_no     int         NOT NULL CHECK (bag_no > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

COMMENT ON TABLE public.ft_wow_bags IS
  '와우출고 마대 — 택배봉투로 준비된 와우 박스 여러 개를 한 마대에 담는다 (ft_wow_boxes.bag_id). 비면 지운다';

CREATE INDEX IF NOT EXISTS ft_wow_bags_user_idx ON public.ft_wow_bags (user_id);

-- ── 박스: 라벨출력 · 순서지정 · 합포장 기록 ──
ALTER TABLE public.ft_wow_boxes
  ADD COLUMN IF NOT EXISTS label_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS label_printed_by text,
  ADD COLUMN IF NOT EXISTS ship_seq         int CHECK (ship_seq > 0),
  ADD COLUMN IF NOT EXISTS ship_seq_at      timestamptz,
  ADD COLUMN IF NOT EXISTS ship_seq_by      text,
  ADD COLUMN IF NOT EXISTS attached_at      timestamptz,
  ADD COLUMN IF NOT EXISTS attached_by      text,
  ADD COLUMN IF NOT EXISTS packed_box_size  text,
  ADD COLUMN IF NOT EXISTS bag_id           uuid REFERENCES public.ft_wow_bags(id),
  ADD COLUMN IF NOT EXISTS packed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS packed_by        text;

COMMENT ON COLUMN public.ft_wow_boxes.box_info_id IS
  '마킹 상자(ft_box_info) — [출고준비완료] 때 묶는다. 마대면 여러 와우 박스가 같은 값. (2026-11-24 까지는 담을 때 1:1 로 묶었다)';
COMMENT ON COLUMN public.ft_wow_boxes.picked_at IS '[작업완료] 시각 = 담음. NULL = 아직 담지 않음';
COMMENT ON COLUMN public.ft_wow_boxes.label_printed_at IS '박스 라벨(발주번호-박스번호)을 뽑은 시각. NULL = 아직 안 뽑음';
COMMENT ON COLUMN public.ft_wow_boxes.ship_seq IS '[순서지정] 으로 찍은 순서. 부착완료로 넘어간 출고 전 박스의 가장 큰 번호 다음부터 이어진다. NULL = 아직 순서 없음';
COMMENT ON COLUMN public.ft_wow_boxes.attached_at IS '[부착완료] 시각 — 서류 · 운송장을 다 붙여 합포장 단계로 넘어감. NULL = 아직';
COMMENT ON COLUMN public.ft_wow_boxes.packed_box_size IS '작업자가 모바일에서 바꾼 박스 크기. NULL = 로켓이 준 크기(box_size) 그대로. 화면 · 라벨 · 택배엑셀은 이 값이 있으면 이 값을 쓴다';
COMMENT ON COLUMN public.ft_wow_boxes.bag_id IS '담긴 마대. NULL = 마대에 담지 않음 (packed_at 이 있으면 "그대로 출고")';
COMMENT ON COLUMN public.ft_wow_boxes.packed_at IS '합포장을 정한 시각 (마대에 담음 또는 그대로 출고). NULL = 아직 정하지 않음';

CREATE INDEX IF NOT EXISTS ft_wow_boxes_bag_idx ON public.ft_wow_boxes (bag_id) WHERE bag_id IS NOT NULL;

-- ── 모바일 작업 기록 — 카드 = (박스, 상품, 위치). 줄(ft_wow_items)은 로켓 동기화 때 다시 만들어져 id 가 바뀌므로 상품으로 잇는다 ──
CREATE TABLE IF NOT EXISTS public.ft_wow_finds (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wow_box_id  uuid        NOT NULL REFERENCES public.ft_wow_boxes(id) ON DELETE CASCADE,
  product_id  uuid        NOT NULL,
  location_id uuid        REFERENCES public.ft_storage_locations(id),
  plan_qty    int         NOT NULL CHECK (plan_qty >= 0),
  found_qty   int,
  found_by    text,
  found_at    timestamptz,
  memo        text,
  memo_by     text,
  memo_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ft_wow_finds_card_uniq UNIQUE NULLS NOT DISTINCT (wow_box_id, product_id, location_id),
  CONSTRAINT ft_wow_finds_found_chk CHECK (found_qty IS NULL OR (found_qty >= 0 AND found_qty <= plan_qty)),
  CONSTRAINT ft_wow_finds_noloc_chk CHECK (location_id IS NOT NULL OR COALESCE(found_qty, 0) = 0),
  CONSTRAINT ft_wow_finds_any_chk   CHECK (found_qty IS NOT NULL OR memo IS NOT NULL)
);

COMMENT ON TABLE public.ft_wow_finds IS
  '와우출고 모바일 작업 기록 — 카드(박스 × 상품 × 위치)의 몫(plan_qty) · 찾은 수량(found_qty, NULL = 메모만) · 메모. 위치 카드는 표시하면 몫 = 그 위치에서 꺼낸 수량. location_id NULL = 재고 위치가 없는 몫(부족)';

ALTER TABLE public.ft_wow_bags  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_wow_finds DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ft_wow_bags, public.ft_wow_finds FROM anon, authenticated;

-- ── 포장 행 → 와우 줄 찾기 (보호 트리거 · 출고준비 묶기) ──
CREATE INDEX IF NOT EXISTS ft_wow_items_outbound_idx ON public.ft_wow_items (outbound_id) WHERE outbound_id IS NOT NULL;

-- ============================================================
-- 2) 묶음 규칙 바꾸기 — 와우 박스 여러 개가 마킹 상자 하나에
-- ============================================================
ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_box_info_id_key;
CREATE INDEX IF NOT EXISTS ft_wow_boxes_box_info_idx ON public.ft_wow_boxes (box_info_id) WHERE box_info_id IS NOT NULL;

-- 이미 묶인 박스는 전부 담은 박스다 (옛 ft_wow_pick 이 picked_at 을 같이 적었다) — 빠진 값이 있으면 채운다
UPDATE public.ft_wow_boxes
   SET picked_at = COALESCE(work_started_at, updated_at)
 WHERE box_info_id IS NOT NULL AND picked_at IS NULL;

ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_picked_started_chk;
ALTER TABLE public.ft_wow_boxes
  ADD CONSTRAINT ft_wow_boxes_picked_started_chk
  CHECK ((picked_at IS NULL OR work_started_at IS NOT NULL) AND (box_info_id IS NULL OR picked_at IS NOT NULL));

ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_seq_chk;
ALTER TABLE public.ft_wow_boxes
  ADD CONSTRAINT ft_wow_boxes_seq_chk
  CHECK (ship_seq IS NULL OR (picked_at IS NOT NULL AND label_path IS NOT NULL AND manifest_path IS NOT NULL));

ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_pack_chk;
ALTER TABLE public.ft_wow_boxes
  ADD CONSTRAINT ft_wow_boxes_pack_chk
  CHECK ((attached_at IS NULL OR ship_seq IS NOT NULL) AND (packed_at IS NULL OR attached_at IS NOT NULL)
         AND (bag_id IS NULL OR packed_at IS NOT NULL));

-- ============================================================
-- 3) 꺼내기 핵심 — 상자 없이도 꺼낼 수 있다 (p_box_info_id NULL = 포장 행을 상자 없이 만든다)
--   005 의 4) 와 같고, 상자 검사 · 타입 검사를 상자가 있을 때만 한다
--   상자 없는 꺼내기는 ft_wow_pick_found 만 쓴다 — 재고 [쉽먼트](ft_storage_pick_to_shipment)는 상자가 꼭 있어야 한다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_pick_core(
  p_user_id           uuid,
  p_product_id        uuid,
  p_order_item_id     uuid,
  p_picks             jsonb,
  p_box_info_id       uuid,
  p_operator_name     text,
  p_force             boolean,
  p_shipment_type     text,
  p_size              text,
  p_personal_order_no text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item      ft_order_items%ROWTYPE;
  v_box       ft_box_info%ROWTYPE;
  v_type      jsonb;
  v_box_type  text;
  v_item_type text;
  v_pick      record;
  v_total     int := 0;
  v_balance   int;
  v_codes     text[] := '{}';
  v_code      text;
  v_out_id    uuid;
BEGIN
  SELECT * INTO v_item FROM ft_order_items WHERE id = p_order_item_id;
  IF NOT FOUND
     OR v_item.user_id IS DISTINCT FROM p_user_id
     OR v_item.product_id IS DISTINCT FROM p_product_id
     OR v_item.arrival_route <> 'STOCK'
     OR v_item.status = 'DONE' THEN
    RAISE EXCEPTION 'PICK_ITEM_INVALID';
  END IF;

  IF p_box_info_id IS NOT NULL THEN
    SELECT * INTO v_box FROM ft_box_info WHERE id = p_box_info_id FOR SHARE;
    IF NOT FOUND
       OR v_box.user_id IS DISTINCT FROM p_user_id
       OR v_box.shipment_id IS NOT NULL
       OR v_box.status IS DISTINCT FROM 'PACKING' THEN
      RAISE EXCEPTION 'PICK_BOX_NOT_OPEN';
    END IF;
  END IF;

  -- ── 타입 확정 (상품 전체 행 기록) ──
  v_type := ft_storage_resolve_type(p_user_id, p_product_id, p_shipment_type, p_size, p_personal_order_no, true);

  -- ── 박스 타입 = 상품 타입 (허용 모드 · 상자 없는 꺼내기면 건너뜀) ──
  IF p_box_info_id IS NOT NULL THEN
    v_box_type  := ft_box_effective_type(p_box_info_id);
    v_item_type := ft_item_size_code(v_type->>'shipment_type', v_type->>'coupang_shipment_size');
    IF NOT p_force AND v_box_type IS DISTINCT FROM v_item_type THEN
      RAISE EXCEPTION 'PICK_BOX_TYPE_MISMATCH:%:%', COALESCE(v_box_type, '-'), v_item_type;
    END IF;
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

  -- ── PACKED 1행 (상품출고 V2 가 만드는 행과 같은 모양 — 상자가 없으면 box_code · box_info_id 는 NULL) ──
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

  RETURN jsonb_build_object('outbound_id', v_out_id, 'box_code', v_box.box_code, 'picked', v_total) || v_type;
END;
$$;

-- ── 재고 → 쉽먼트 — 005 의 5) 와 같고, 상자가 없으면 거절하는 것만 다르다 ──
CREATE OR REPLACE FUNCTION public.ft_storage_pick_to_shipment(
  p_user_id           uuid,
  p_product_id        uuid,
  p_order_item_id     uuid,
  p_picks             jsonb,
  p_box_info_id       uuid,
  p_operator_name     text DEFAULT NULL,
  p_force             boolean DEFAULT false,
  p_shipment_type     text DEFAULT NULL,
  p_size              text DEFAULT NULL,
  p_personal_order_no text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_box_info_id IS NULL THEN
    RAISE EXCEPTION 'PICK_BOX_NOT_OPEN';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = p_box_info_id) THEN
    RAISE EXCEPTION 'PICK_BOX_WOW';
  END IF;

  -- ── 타입 인자가 없으면 미처리 고객 요청의 타입을 쓴다 ──
  IF NULLIF(trim(COALESCE(p_shipment_type, '')), '') IS NULL THEN
    SELECT shipment_type, coupang_shipment_size, personal_order_no
      INTO p_shipment_type, p_size, p_personal_order_no
      FROM ft_storage_requests
     WHERE user_id = p_user_id AND product_id = p_product_id AND status = 'REQUESTED'
     LIMIT 1;
  END IF;

  v_result := ft_storage_pick_core(p_user_id, p_product_id, p_order_item_id, p_picks, p_box_info_id,
                                   p_operator_name, p_force, p_shipment_type, p_size, p_personal_order_no);

  IF (SELECT COALESCE(SUM(delta), 0) FROM ft_storage_movements
       WHERE user_id = p_user_id AND product_id = p_product_id)
     < (SELECT COALESCE(SUM(qty), 0) FROM ft_wow_items
         WHERE user_id = p_user_id AND product_id = p_product_id AND picked_at IS NULL) THEN
    RAISE EXCEPTION 'PICK_OVER_AVAILABLE';
  END IF;

  -- ── 고객 요청 처리완료 ──
  UPDATE ft_storage_requests
     SET status = 'DONE', done_by = p_operator_name, done_at = now(), done_outbound_id = (v_result->>'outbound_id')::uuid
   WHERE user_id = p_user_id AND product_id = p_product_id AND status = 'REQUESTED';

  RETURN v_result;
END;
$$;

-- ============================================================
-- 4) 와우 포장 행 보호 — 마킹 상자에 묶인 행 + 아직 상자가 없는 와우 포장 행(와우 줄이 가리키는 행)
--   005 의 8) 와 같고, "와우 줄이 가리키는 행" 조건이 늘었다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_outbound_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('ft.wow', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF (TG_OP <> 'INSERT' AND (EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = OLD.box_info_id)
                             OR EXISTS (SELECT 1 FROM ft_wow_items WHERE outbound_id = OLD.id)))
     OR (TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = NEW.box_info_id)) THEN
    RAISE EXCEPTION 'WOW_BOX_LOCKED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 고객 이동요청 생성 — 005 의 7) 과 같고, 아직 상자가 없는 와우 포장 행도 건너뛴다 (skipped_closed) ──
CREATE OR REPLACE FUNCTION public.ft_move_request_create(
  p_user_id      uuid,
  p_outbound_ids uuid[],
  p_target_type  text,
  p_requested_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   uuid := gen_random_uuid();
  v_id      uuid;
  v_row     ft_fulfillment_outbounds%ROWTYPE;
  v_type    text;
  v_created int := 0;
  v_dup     int := 0;
  v_same    int := 0;
  v_closed  int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'request: 로그인 정보가 없습니다.';
  END IF;
  IF p_target_type IS NULL OR p_target_type NOT IN ('A','B','C','P','X') THEN
    RAISE EXCEPTION 'request: 이동할 박스 타입이 올바르지 않습니다. (A / B / C / P / X)';
  END IF;
  IF p_outbound_ids IS NULL OR cardinality(p_outbound_ids) = 0 THEN
    RAISE EXCEPTION 'request: 이동요청할 항목을 선택해 주세요.';
  END IF;
  IF cardinality(p_outbound_ids) > 2000 THEN
    RAISE EXCEPTION 'request: 한 번에 2000건까지 요청할 수 있습니다.';
  END IF;

  FOR v_id IN SELECT DISTINCT unnest(p_outbound_ids) LOOP
    SELECT * INTO v_row FROM ft_fulfillment_outbounds WHERE id = v_id FOR SHARE;

    -- 포장이 철회되어 행이 없음
    IF NOT FOUND THEN
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    IF v_row.user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'request: 다른 팀의 항목은 요청할 수 없습니다.';
    END IF;

    -- 이미 출고되었거나 포장 행이 아님 · 와우 포장 행(마킹 상자에 묶였든 아직 상자가 없든 옮길 수 없다)
    IF v_row.type IS DISTINCT FROM 'PACKED' OR v_row.shipment_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = v_row.box_info_id)
       OR EXISTS (SELECT 1 FROM ft_wow_items WHERE outbound_id = v_row.id) THEN
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    v_type := ft_box_effective_type(v_row.box_info_id);
    IF v_type = p_target_type THEN
      v_same := v_same + 1;
      CONTINUE;
    END IF;

    INSERT INTO ft_move_requests (
      user_id, outbound_id, request_group_id, target_type, from_box_code, requested_by
    ) VALUES (
      p_user_id, v_id, v_group, p_target_type, v_row.box_code,
      NULLIF(btrim(COALESCE(p_requested_by, '')), '')
    )
    ON CONFLICT (outbound_id) WHERE status = 'REQUESTED' DO NOTHING;

    IF FOUND THEN
      v_created := v_created + 1;
    ELSE
      v_dup := v_dup + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'group_id',          v_group,
    'created',           v_created,
    'skipped_duplicate', v_dup,
    'skipped_same_type', v_same,
    'skipped_closed',    v_closed
  );
END;
$$;

-- ============================================================
-- 5) [작업] · [작업 취소] — 006 의 2) 3) 과 같고, "담았는가" 를 picked_at 으로 본다
--   작업 취소는 모바일 작업 기록(ft_wow_finds)도 지운다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_work_start(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box ft_wow_boxes%ROWTYPE;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;

  PERFORM ft_wow_lock(p_user_id, v_box.order_number, '{}'::uuid[]);

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.picked_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;
  IF v_box.work_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_WORK_ALREADY_STARTED';
  END IF;

  UPDATE ft_wow_boxes
     SET work_started_at = now(), work_started_by = p_operator_name, updated_at = now()
   WHERE id = p_wow_box_id;

  RETURN jsonb_build_object('work_started_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.ft_wow_work_cancel(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box ft_wow_boxes%ROWTYPE;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;

  PERFORM ft_wow_lock(p_user_id, v_box.order_number, '{}'::uuid[]);

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.picked_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;
  IF v_box.work_started_at IS NULL THEN
    RAISE EXCEPTION 'WOW_WORK_NOT_STARTED';
  END IF;

  DELETE FROM ft_wow_finds WHERE wow_box_id = p_wow_box_id;
  UPDATE ft_wow_boxes
     SET work_started_at = NULL, work_started_by = NULL, updated_at = now()
   WHERE id = p_wow_box_id;

  RETURN jsonb_build_object('cancelled', true);
END;
$$;

-- ============================================================
-- 6) 모바일 카드 — [찾음] · [부족] · 취소 (p_found_qty NULL = 표시 취소)
--   카드 = (박스, 상품, 위치). p_plan_qty = 화면에 보인 그 카드의 몫, p_found_qty = 찾은 수량
--   · 위치 카드: 저장하는 몫 = 그 위치에서 실제로 꺼낸 수량. 몫보다 적게 찾으면 나머지는 다른 위치의 카드로 다시 나온다
--     (그 위치는 다시 권하지 않는다 — 0 개도 "여기엔 없음" 으로 남는다)
--   · 위치 없는 카드(재고 위치가 더 없는 몫): 찾은 수량은 0 뿐 — 이 몫이 곧 부족 수량이다
--   처음 표시하면 작업 시작 기록도 남긴다 (신규 → 작업중)
--   오류: WOW_BOX_NOT_FOUND / WOW_BOX_ALREADY_PICKED / WOW_INVALID_INPUT
--         WOW_FIND_OVER (몫의 합이 요청 수량을 넘음)
--         WOW_FIND_OVER_STOCK (그 위치 재고 − 다른 박스가 표시해 둔 수량보다 많이 찾음)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_find_set(
  p_wow_box_id    uuid,
  p_product_id    uuid,
  p_location_id   uuid,
  p_plan_qty      int,
  p_found_qty     int,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box      ft_wow_boxes%ROWTYPE;
  v_line_qty int;
  v_plan     int;
  v_others   int;
  v_balance  int;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(v_box.user_id, v_box.order_number, ARRAY[p_product_id]);

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.picked_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;

  -- ── 표시 취소: 찾은 기록만 지운다 (메모가 있으면 메모는 남긴다) ──
  IF p_found_qty IS NULL THEN
    DELETE FROM ft_wow_finds
     WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id
       AND location_id IS NOT DISTINCT FROM p_location_id AND memo IS NULL;
    UPDATE ft_wow_finds
       SET found_qty = NULL, found_by = NULL, found_at = NULL, updated_at = now()
     WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id
       AND location_id IS NOT DISTINCT FROM p_location_id;
    RETURN jsonb_build_object('cleared', true);
  END IF;

  SELECT qty INTO v_line_qty FROM ft_wow_items WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id;
  IF NOT FOUND
     OR p_plan_qty IS NULL OR p_plan_qty < 0 OR p_found_qty < 0
     OR (p_location_id IS NULL AND (p_found_qty > 0 OR p_plan_qty < 1)) THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  v_plan := CASE WHEN p_location_id IS NULL THEN p_plan_qty ELSE p_found_qty END;

  SELECT COALESCE(SUM(plan_qty), 0) INTO v_others
    FROM ft_wow_finds
   WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id AND found_qty IS NOT NULL
     AND location_id IS DISTINCT FROM p_location_id;
  IF v_others + v_plan > v_line_qty THEN
    RAISE EXCEPTION 'WOW_FIND_OVER';
  END IF;

  IF p_location_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM ft_storage_locations WHERE id = p_location_id) THEN
      RAISE EXCEPTION 'WOW_INVALID_INPUT';
    END IF;
    -- 그 위치의 재고 − 다른 박스가 이미 찾았다고 표시하고 아직 작업완료하지 않은 수량
    --   (재고는 작업완료 때 빠진다 — 두 박스가 같은 선반의 같은 상품을 겹쳐 표시하면 늦은 쪽 작업완료가 실패하므로 표시할 때 막는다)
    SELECT COALESCE(SUM(delta), 0) INTO v_balance
      FROM ft_storage_movements
     WHERE user_id = v_box.user_id AND product_id = p_product_id AND location_id = p_location_id;
    v_balance := v_balance - COALESCE((
      SELECT SUM(f.found_qty)
        FROM ft_wow_finds f
        JOIN ft_wow_boxes ob ON ob.id = f.wow_box_id
       WHERE f.product_id = p_product_id AND f.location_id = p_location_id AND f.wow_box_id <> p_wow_box_id
         AND ob.user_id = v_box.user_id AND ob.picked_at IS NULL), 0);
    IF p_found_qty > v_balance THEN
      RAISE EXCEPTION 'WOW_FIND_OVER_STOCK';
    END IF;
  END IF;

  INSERT INTO ft_wow_finds AS f (wow_box_id, product_id, location_id, plan_qty, found_qty, found_by, found_at)
  VALUES (p_wow_box_id, p_product_id, p_location_id, v_plan, p_found_qty, p_operator_name, now())
  ON CONFLICT ON CONSTRAINT ft_wow_finds_card_uniq DO UPDATE
     SET plan_qty = EXCLUDED.plan_qty, found_qty = EXCLUDED.found_qty,
         found_by = EXCLUDED.found_by, found_at = EXCLUDED.found_at, updated_at = now();

  IF v_box.work_started_at IS NULL THEN
    UPDATE ft_wow_boxes
       SET work_started_at = now(), work_started_by = p_operator_name, updated_at = now()
     WHERE id = p_wow_box_id;
  END IF;

  RETURN jsonb_build_object('found', p_found_qty, 'plan', v_plan);
END;
$$;

-- ============================================================
-- 7) 모바일 카드 메모 (p_memo 빈 값 = 메모 지움) — 찾음 · 부족 표시와 따로 저장된다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_find_memo(
  p_wow_box_id    uuid,
  p_product_id    uuid,
  p_location_id   uuid,
  p_plan_qty      int,
  p_memo          text,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box  ft_wow_boxes%ROWTYPE;
  v_memo text := NULLIF(trim(COALESCE(p_memo, '')), '');
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(v_box.user_id, v_box.order_number, '{}'::uuid[]);

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.picked_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;

  IF v_memo IS NULL THEN
    DELETE FROM ft_wow_finds
     WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id
       AND location_id IS NOT DISTINCT FROM p_location_id AND found_qty IS NULL;
    UPDATE ft_wow_finds
       SET memo = NULL, memo_by = NULL, memo_at = NULL, updated_at = now()
     WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id
       AND location_id IS NOT DISTINCT FROM p_location_id;
    RETURN jsonb_build_object('memo', NULL);
  END IF;

  IF p_plan_qty IS NULL OR p_plan_qty < 0 OR char_length(v_memo) > 500
     OR NOT EXISTS (SELECT 1 FROM ft_wow_items WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id) THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  INSERT INTO ft_wow_finds AS f (wow_box_id, product_id, location_id, plan_qty, memo, memo_by, memo_at)
  VALUES (p_wow_box_id, p_product_id, p_location_id, p_plan_qty, v_memo, p_operator_name, now())
  ON CONFLICT ON CONSTRAINT ft_wow_finds_card_uniq DO UPDATE
     SET memo = EXCLUDED.memo, memo_by = EXCLUDED.memo_by, memo_at = EXCLUDED.memo_at, updated_at = now();

  RETURN jsonb_build_object('memo', v_memo);
END;
$$;

-- ============================================================
-- 8) 모바일 [작업완료] — 카드에 적힌 찾은 수량만큼 재고에서 꺼낸다 (마킹 상자는 아직 없다)
--   줄마다 카드 몫의 합 = 요청 수량이어야 한다 (남은 카드가 있으면 WOW_FIND_INCOMPLETE)
--   적게 찾은 줄은 그만큼만 담긴다 — 나머지 예약은 풀리고, 로켓이 담은 수량으로 맞춘다 (옛 ft_wow_pick 과 같다)
--   하나도 찾지 못한 박스도 작업완료할 수 있다 (옛 ft_wow_pick 은 거절했다) — 담은 것이 없는 박스로 끝나고,
--     로켓이 그 박스를 빼면 다음 동기화 때 박스 기록도 지워진다 (16) 발주서 동기화)
--   오류: WOW_BOX_NOT_FOUND / WOW_BOX_ALREADY_PICKED / WOW_FIND_INCOMPLETE / WOW_PICK_OVER / PICK_* / STOCK_*
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_pick_found(
  p_wow_box_id    uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box     ft_wow_boxes%ROWTYPE;
  v_line    record;
  v_picks   jsonb;
  v_plan    int;
  v_qty     int;
  v_total   int := 0;
  v_item_id uuid;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(v_box.user_id, v_box.order_number,
                      ARRAY(SELECT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id));

  -- ── 잠금 뒤 다시 읽기 (로켓 동기화 · 다른 폰의 표시 · 작업완료와 겨룬다) ──
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.picked_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  FOR v_line IN
    SELECT i.id, i.product_id, i.qty FROM ft_wow_items i WHERE i.wow_box_id = p_wow_box_id ORDER BY i.product_id
  LOOP
    SELECT COALESCE(SUM(f.plan_qty), 0), COALESCE(SUM(f.found_qty), 0),
           COALESCE(jsonb_agg(jsonb_build_object('location_id', f.location_id, 'qty', f.found_qty))
                      FILTER (WHERE f.found_qty > 0), '[]')
      INTO v_plan, v_qty, v_picks
      FROM ft_wow_finds f
     WHERE f.wow_box_id = p_wow_box_id AND f.product_id = v_line.product_id AND f.found_qty IS NOT NULL;
    IF v_plan < v_line.qty THEN
      RAISE EXCEPTION 'WOW_FIND_INCOMPLETE';
    END IF;
    IF v_plan > v_line.qty THEN
      RAISE EXCEPTION 'WOW_PICK_OVER';
    END IF;

    v_result := NULL;
    IF v_qty > 0 THEN
      SELECT id INTO v_item_id FROM ft_order_items
       WHERE user_id = v_box.user_id AND product_id = v_line.product_id
         AND arrival_route = 'STOCK' AND status IS DISTINCT FROM 'DONE'
       ORDER BY set_seq NULLS FIRST, item_no LIMIT 1;
      v_result := ft_storage_pick_core(v_box.user_id, v_line.product_id, v_item_id, v_picks, NULL,
                                       p_operator_name, false, 'DIRECT', NULL, NULL);
    END IF;

    UPDATE ft_wow_items
       SET picked_qty = v_qty, outbound_id = (v_result->>'outbound_id')::uuid, picked_at = now()
     WHERE id = v_line.id;
    v_total := v_total + v_qty;
  END LOOP;

  UPDATE ft_wow_boxes
     SET picked_at = now(), picked_by = p_operator_name,
         work_started_at = COALESCE(work_started_at, now()),
         work_started_by = COALESCE(work_started_by, p_operator_name),
         updated_at = now()
   WHERE id = p_wow_box_id;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('picked', v_total);
END;
$$;

-- ============================================================
-- 8-b) 모바일 [박스 크기 변경] — 작업자가 실제로 담은 박스 크기 (로켓의 크기 목록 중 하나 — 목록 검사는 API 가 한다)
--   로켓이 준 크기(box_size)는 그대로 두고 packed_box_size 에 적는다 (동기화가 덮어쓰지 않는다). 로켓 크기와 같으면 NULL 로 되돌린다
--   크기가 바뀌면 박스 라벨을 다시 뽑아야 한다 → 라벨 출력 기록을 지운다
--   순서지정 전까지만 바꿀 수 있다 (그 뒤에는 택배엑셀 · 서류가 그 크기로 나갔다) — WOW_SIZE_LOCKED
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_box_size_set(
  p_wow_box_id    uuid,
  p_size          text,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box  ft_wow_boxes%ROWTYPE;
  v_size text := NULLIF(trim(COALESCE(p_size, '')), '');
  v_prev text;
BEGIN
  IF v_size IS NULL THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(v_box.user_id, v_box.order_number, '{}'::uuid[]);

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.ship_seq IS NOT NULL OR v_box.ready_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_SIZE_LOCKED';
  END IF;

  v_prev := COALESCE(v_box.packed_box_size, v_box.box_size);
  IF v_prev IS DISTINCT FROM v_size THEN
    UPDATE ft_wow_boxes
       SET packed_box_size  = CASE WHEN v_size IS NOT DISTINCT FROM box_size THEN NULL ELSE v_size END,
           label_printed_at = NULL, label_printed_by = NULL, updated_at = now()
     WHERE id = p_wow_box_id;
  END IF;

  RETURN jsonb_build_object('prev', v_prev, 'size', v_size, 'changed', v_prev IS DISTINCT FROM v_size);
END;
$$;

-- ============================================================
-- 9) [작업완료 취소] — 008 의 3) 을 바꾼다: 포장 행을 "와우 줄이 가리키는 행" 으로 찾는다 (상자가 없어도, 마대여도 그 박스 것만)
--   순서지정 · 합포장 · 출고준비를 먼저 되돌려야 한다 (WOW_BOX_SEQUENCED / WOW_BOX_READY)
--   모바일 작업 기록은 남는다 → 작업중으로 돌아가 카드를 고친 뒤 다시 [작업완료]
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_unpack(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box  ft_wow_boxes%ROWTYPE;
  v_out  uuid;
  v_back int := 0;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(p_user_id, v_box.order_number,
                      ARRAY(SELECT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id));

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.picked_at IS NULL THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_PICKED';
  END IF;
  IF v_box.ready_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_READY';
  END IF;
  IF v_box.ship_seq IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_SEQUENCED';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_wow_items i JOIN ft_fulfillment_outbounds o ON o.id = i.outbound_id
              WHERE i.wow_box_id = p_wow_box_id AND o.shipment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'WOW_BOX_SHIPPED';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  FOR v_out IN
    SELECT outbound_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id AND outbound_id IS NOT NULL ORDER BY outbound_id
  LOOP
    v_back := v_back + COALESCE((ft_storage_unpick_outbound(v_out, p_operator_name)->>'returned')::int, 0);
  END LOOP;
  -- 꺼내기 핵심이 만든 행은 전부 PICK 링크가 있다 — 남았다면 재고로 못 돌린 행
  IF EXISTS (SELECT 1 FROM ft_wow_items i JOIN ft_fulfillment_outbounds o ON o.id = i.outbound_id
              WHERE i.wow_box_id = p_wow_box_id) THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_EMPTY';
  END IF;

  UPDATE ft_wow_items SET picked_qty = NULL, outbound_id = NULL, picked_at = NULL WHERE wow_box_id = p_wow_box_id;
  UPDATE ft_wow_boxes SET box_info_id = NULL, picked_at = NULL, picked_by = NULL, updated_at = now() WHERE id = p_wow_box_id;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('returned', v_back);
END;
$$;

-- ============================================================
-- 10) 여러 박스 잠그기 — 발주서 잠금을 (사업자, 발주번호) 순으로 잡고 박스 행을 잠근다
--   전부 있어야 하고(WOW_BOX_NOT_FOUND) 출고 전이어야 한다(WOW_BOX_SHIPPED). 순서지정 · 합포장 · 출고준비가 같이 쓴다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_lock_boxes(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order record;
BEGIN
  IF COALESCE(cardinality(p_ids), 0) = 0 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  FOR v_order IN
    SELECT DISTINCT user_id, order_number FROM ft_wow_boxes WHERE id = ANY (p_ids) ORDER BY user_id, order_number
  LOOP
    PERFORM ft_wow_lock(v_order.user_id, v_order.order_number, '{}'::uuid[]);
  END LOOP;

  PERFORM 1 FROM ft_wow_boxes WHERE id = ANY (p_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM ft_wow_boxes WHERE id = ANY (p_ids)) <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_wow_items i JOIN ft_fulfillment_outbounds o ON o.id = i.outbound_id
              WHERE i.wow_box_id = ANY (p_ids) AND o.shipment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'WOW_BOX_SHIPPED';
  END IF;
END;
$$;

-- ============================================================
-- 11) [순서지정] 저장 — 스캔한 순서대로 번호를 붙인다 (저장 = 순서지정 단계 전체 교체)
--   대상: 서류준비 박스(담았고 서류 2종 도착, 부착완료 전) — 이미 순서가 있는 박스를 다시 찍어도 된다
--   번호는 이어진다: 그 사업자의 "부착완료로 넘어간(합포장 · 출고준비) 출고 전 박스" 중 가장 큰 번호 다음부터.
--     합포장에 1 ~ 4 가 있으면 이번에 찍은 박스는 5, 6, 7 … 그 박스들이 다 출고되면 다시 1 부터
--   같은 사업자의 "순서만 있고 아직 부착완료 전" 박스 중 이번에 찍지 않은 것은 순서를 지운다 (서류준비로 돌아간다)
--   오류: WOW_INVALID_INPUT / WOW_BOX_NOT_FOUND / WOW_BOX_SHIPPED / WOW_SEQ_NOT_READY
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_seq_set(
  p_wow_box_ids   uuid[],
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids     uuid[];
  v_user    uuid;
  v_cleared int;
BEGIN
  -- 두 번 찍은 박스는 처음 순서를 쓴다
  SELECT array_agg(id ORDER BY ord) INTO v_ids
    FROM (SELECT u.id, MIN(u.ord) AS ord FROM unnest(p_wow_box_ids) WITH ORDINALITY AS u(id, ord)
           WHERE u.id IS NOT NULL GROUP BY u.id) s;

  -- 번호가 겹치지 않게 사업자 잠금을 먼저 (합포장 · 출고준비와 같은 잠금)
  FOR v_user IN SELECT DISTINCT user_id FROM ft_wow_boxes WHERE id = ANY (v_ids) ORDER BY user_id LOOP
    PERFORM pg_advisory_xact_lock(hashtext('ft_wow_pack:' || v_user::text));
  END LOOP;
  PERFORM ft_wow_lock_boxes(v_ids);

  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids)
              AND (picked_at IS NULL OR label_path IS NULL OR manifest_path IS NULL
                   OR attached_at IS NOT NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_SEQ_NOT_READY';
  END IF;

  UPDATE ft_wow_boxes
     SET ship_seq = NULL, ship_seq_at = NULL, ship_seq_by = NULL, updated_at = now()
   WHERE user_id IN (SELECT user_id FROM ft_wow_boxes WHERE id = ANY (v_ids))
     AND ship_seq IS NOT NULL AND attached_at IS NULL AND ready_at IS NULL
     AND id <> ALL (v_ids);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  UPDATE ft_wow_boxes b
     SET ship_seq = r.base + r.rn, ship_seq_at = now(), ship_seq_by = p_operator_name, updated_at = now()
    FROM (
      SELECT x.id,
             row_number() OVER (PARTITION BY bb.user_id ORDER BY x.ord) AS rn,
             (SELECT COALESCE(MAX(a.ship_seq), 0)
                FROM ft_wow_boxes a
               WHERE a.user_id = bb.user_id AND a.attached_at IS NOT NULL AND a.ship_seq IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM ft_wow_items i JOIN ft_fulfillment_outbounds o ON o.id = i.outbound_id
                                  WHERE i.wow_box_id = a.id AND o.shipment_id IS NOT NULL)) AS base
        FROM unnest(v_ids) WITH ORDINALITY AS x(id, ord)
        JOIN ft_wow_boxes bb ON bb.id = x.id
    ) r
   WHERE b.id = r.id;

  RETURN jsonb_build_object('count', cardinality(v_ids), 'cleared', v_cleared,
                            'first', (SELECT MIN(ship_seq) FROM ft_wow_boxes WHERE id = ANY (v_ids)));
END;
$$;

-- ── [초기화] — 순서를 지운다 (순서지정 → 서류준비). 부착완료한 박스는 부착완료부터 취소한다 ──
CREATE OR REPLACE FUNCTION public.ft_wow_seq_clear(
  p_wow_box_ids   uuid[],
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
BEGIN
  PERFORM ft_wow_lock_boxes(v_ids);

  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids)
              AND (ship_seq IS NULL OR attached_at IS NOT NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_SEQ_NOT_SET';
  END IF;

  UPDATE ft_wow_boxes
     SET ship_seq = NULL, ship_seq_at = NULL, ship_seq_by = NULL, updated_at = now()
   WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('count', cardinality(v_ids));
END;
$$;

-- ── [부착완료] · [부착완료 취소] — 순서지정 ↔ 합포장 (순서 번호는 그대로 들고 간다) ──
--   p_attached true  : 순서지정 → 합포장 (서류 · 운송장을 다 붙임)
--   p_attached false : 합포장 → 순서지정 (아직 마대 · 그대로 출고를 정하지 않은 박스만 — 정했으면 [합포장 취소] 부터)
--   오류: WOW_INVALID_INPUT / WOW_BOX_NOT_FOUND / WOW_BOX_SHIPPED / WOW_SEQ_NOT_SET / WOW_NOT_ATTACHED
CREATE OR REPLACE FUNCTION public.ft_wow_attach_set(
  p_wow_box_ids   uuid[],
  p_attached      boolean,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
BEGIN
  IF p_attached IS NULL THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  PERFORM ft_wow_lock_boxes(v_ids);

  IF p_attached AND EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids)
                             AND (ship_seq IS NULL OR attached_at IS NOT NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_SEQ_NOT_SET';
  END IF;
  IF NOT p_attached AND EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids)
                                 AND (attached_at IS NULL OR packed_at IS NOT NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_NOT_ATTACHED';
  END IF;

  UPDATE ft_wow_boxes
     SET attached_at = CASE WHEN p_attached THEN now() END,
         attached_by = CASE WHEN p_attached THEN p_operator_name END,
         updated_at  = now()
   WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('count', cardinality(v_ids));
END;
$$;

-- ============================================================
-- 12) [합포장] — 부착완료한 박스를 마대에 담거나(새 마대 · 있던 마대) 그대로 출고로 정한다
--   p_new_bag true     : 새 마대를 만들어 담는다 (마대 번호 = 출고 전 마대 중 가장 큰 번호 + 1)
--   p_bag_id 있음      : 그 마대에 더 담는다 (출고준비 전 마대만 — WOW_BAG_NOT_OPEN)
--   둘 다 아님         : 그대로 출고 (큰 박스 — 박스 하나가 마킹 상자 하나)
--   한 번에 한 사업자의 박스만. 이미 마킹 상자가 있는 박스(옛 방식으로 담은 박스)는 마대에 담지 못한다 (WOW_PACK_HAS_CARTON)
--   오류: WOW_INVALID_INPUT / WOW_BOX_NOT_FOUND / WOW_BOX_SHIPPED / WOW_PACK_NOT_ATTACHED / WOW_PACK_HAS_CARTON / WOW_BAG_NOT_OPEN
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_pack_set(
  p_wow_box_ids   uuid[],
  p_bag_id        uuid,
  p_new_bag       boolean,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids    uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
  v_user   uuid;
  v_bag_id uuid := p_bag_id;
  v_bag_no int;
BEGIN
  IF COALESCE(cardinality(v_ids), 0) = 0 OR (p_bag_id IS NOT NULL AND COALESCE(p_new_bag, false))
     OR (SELECT count(DISTINCT user_id) FROM ft_wow_boxes WHERE id = ANY (v_ids)) <> 1 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  SELECT DISTINCT user_id INTO v_user FROM ft_wow_boxes WHERE id = ANY (v_ids);

  PERFORM pg_advisory_xact_lock(hashtext('ft_wow_pack:' || v_user::text));
  PERFORM ft_wow_lock_boxes(v_ids);

  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids)
              AND (attached_at IS NULL OR packed_at IS NOT NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_PACK_NOT_ATTACHED';
  END IF;

  IF COALESCE(p_new_bag, false) OR v_bag_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) AND box_info_id IS NOT NULL) THEN
      RAISE EXCEPTION 'WOW_PACK_HAS_CARTON';
    END IF;
  END IF;

  IF COALESCE(p_new_bag, false) THEN
    -- 출고 전 마대 = 담긴 박스 중 아직 출고되지 않은 것이 있는 마대
    SELECT COALESCE(MAX(g.bag_no), 0) + 1 INTO v_bag_no
      FROM ft_wow_bags g
     WHERE g.user_id = v_user
       AND EXISTS (SELECT 1 FROM ft_wow_boxes b
                    WHERE b.bag_id = g.id
                      AND NOT EXISTS (SELECT 1 FROM ft_wow_items i JOIN ft_fulfillment_outbounds o ON o.id = i.outbound_id
                                       WHERE i.wow_box_id = b.id AND o.shipment_id IS NOT NULL));
    INSERT INTO ft_wow_bags (user_id, bag_no, created_by) VALUES (v_user, v_bag_no, p_operator_name)
    RETURNING id INTO v_bag_id;
  ELSIF v_bag_id IS NOT NULL THEN
    SELECT bag_no INTO v_bag_no FROM ft_wow_bags WHERE id = v_bag_id AND user_id = v_user FOR UPDATE;
    IF NOT FOUND
       OR NOT EXISTS (SELECT 1 FROM ft_wow_boxes WHERE bag_id = v_bag_id)
       OR EXISTS (SELECT 1 FROM ft_wow_boxes WHERE bag_id = v_bag_id AND ready_at IS NOT NULL) THEN
      RAISE EXCEPTION 'WOW_BAG_NOT_OPEN';
    END IF;
  END IF;

  UPDATE ft_wow_boxes
     SET bag_id = v_bag_id, packed_at = now(), packed_by = p_operator_name, updated_at = now()
   WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('count', cardinality(v_ids), 'bag_id', v_bag_id, 'bag_no', v_bag_no);
END;
$$;

-- ============================================================
-- 13) [합포장 취소] — 정한 마대 · 그대로 출고를 푼다 (합포장 단계에 남는다). 마킹 상자에 묶여 있었으면 그 박스의 포장 행만 상자에서 뺀다
--   (출고준비를 했다가 취소한 박스 · 옛 방식으로 담은 박스). 빈 마킹 상자 · 빈 마대는 지운다
--   오류: WOW_INVALID_INPUT / WOW_BOX_NOT_FOUND / WOW_BOX_SHIPPED / WOW_NOT_PACKED (합포장 전이거나 출고준비된 박스)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_pack_clear(
  p_wow_box_ids   uuid[],
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids     uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
  v_user    uuid;
  v_cartons uuid[];
  v_bags    uuid[];
BEGIN
  IF COALESCE(cardinality(v_ids), 0) = 0
     OR (SELECT count(DISTINCT user_id) FROM ft_wow_boxes WHERE id = ANY (v_ids)) <> 1 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  SELECT DISTINCT user_id INTO v_user FROM ft_wow_boxes WHERE id = ANY (v_ids);

  PERFORM pg_advisory_xact_lock(hashtext('ft_wow_pack:' || v_user::text));
  PERFORM ft_wow_lock_boxes(v_ids);

  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) AND (packed_at IS NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_NOT_PACKED';
  END IF;

  v_cartons := ARRAY(SELECT DISTINCT box_info_id FROM ft_wow_boxes WHERE id = ANY (v_ids) AND box_info_id IS NOT NULL);
  v_bags    := ARRAY(SELECT DISTINCT bag_id FROM ft_wow_boxes WHERE id = ANY (v_ids) AND bag_id IS NOT NULL);

  PERFORM set_config('ft.wow', 'on', true);

  UPDATE ft_fulfillment_outbounds
     SET box_info_id = NULL, box_code = NULL
   WHERE id IN (SELECT outbound_id FROM ft_wow_items WHERE wow_box_id = ANY (v_ids) AND outbound_id IS NOT NULL)
     AND box_info_id IS NOT NULL;

  UPDATE ft_wow_boxes
     SET box_info_id = NULL, bag_id = NULL, packed_at = NULL, packed_by = NULL, updated_at = now()
   WHERE id = ANY (v_ids);

  -- ── 빈 마킹 상자 · 빈 마대 정리 (다른 것이 하나라도 걸려 있으면 남긴다) ──
  DELETE FROM ft_box_info bi
   WHERE bi.id = ANY (v_cartons) AND bi.shipment_id IS NULL AND bi.master_box_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = bi.id)
     AND NOT EXISTS (SELECT 1 FROM ft_fulfillment_outbounds WHERE box_info_id = bi.id)
     AND NOT EXISTS (SELECT 1 FROM ft_box_info c WHERE c.master_box_id = bi.id);
  DELETE FROM ft_wow_bags g
   WHERE g.id = ANY (v_bags) AND NOT EXISTS (SELECT 1 FROM ft_wow_boxes WHERE bag_id = g.id);

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('count', cardinality(v_ids));
END;
$$;

-- ============================================================
-- 14) [출고준비완료] — 합포장 → 출고준비. 마킹 상자를 정하고 포장 행을 그 상자에 묶는다
--   묶음 = 마대 하나(그 마대의 출고준비 전 박스 전부 — 일부만 고르면 WOW_BAG_PARTIAL) 또는 그대로 출고하는 박스 하나
--   묶음마다 마킹 상자 하나: 이미 있으면(출고준비를 취소했던 묶음 · 옛 방식으로 담은 박스) 그 상자를 그대로 쓰고,
--   없으면 순서지정 순서가 빠른 묶음부터 새 번호를 붙인다 (출고 전 X 박스 중 가장 큰 번호 + 1)
--   이때부터 쉽먼트 V2 출고 대기 목록에 보인다
--   오류: WOW_INVALID_INPUT / WOW_BOX_NOT_FOUND / WOW_BOX_SHIPPED / WOW_NOT_PACKED / WOW_BAG_PARTIAL
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_ready_pack(
  p_wow_box_ids   uuid[],
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids       uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
  v_user      uuid;
  v_user_code text;
  v_group     record;
  v_cartons   uuid[];
  v_carton    uuid;
  v_code      text;
  v_no        int;
  v_out       jsonb := '[]';
BEGIN
  IF COALESCE(cardinality(v_ids), 0) = 0
     OR (SELECT count(DISTINCT user_id) FROM ft_wow_boxes WHERE id = ANY (v_ids)) <> 1 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  SELECT DISTINCT user_id INTO v_user FROM ft_wow_boxes WHERE id = ANY (v_ids);
  SELECT NULLIF(trim(user_code), '') INTO v_user_code FROM ft_users WHERE id = v_user;
  IF v_user_code IS NULL THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ft_wow_pack:' || v_user::text));
  PERFORM ft_wow_lock_boxes(v_ids);

  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) AND (packed_at IS NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_NOT_PACKED';
  END IF;
  -- 마대는 통째로: 같은 마대에 아직 출고준비 전인 박스가 남으면 거절 (먼저 출고준비된 박스는 이미 그 마대 상자에 묶여 있다)
  IF EXISTS (SELECT 1 FROM ft_wow_boxes b
              WHERE b.bag_id IN (SELECT bag_id FROM ft_wow_boxes WHERE id = ANY (v_ids) AND bag_id IS NOT NULL)
                AND b.ready_at IS NULL AND b.id <> ALL (v_ids)) THEN
    RAISE EXCEPTION 'WOW_BAG_PARTIAL';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  FOR v_group IN
    SELECT array_agg(b.id) AS ids, MIN(b.bag_id::text)::uuid AS bag_id
      FROM ft_wow_boxes b
     WHERE b.id = ANY (v_ids)
     GROUP BY COALESCE(b.bag_id, b.id)
     ORDER BY MIN(b.ship_seq), MIN(b.id::text)
  LOOP
    -- 이미 있는 마킹 상자 = 묶음 안 박스의 상자 + 같은 마대에서 먼저 출고준비된 박스의 상자
    v_cartons := ARRAY(SELECT DISTINCT m.box_info_id FROM ft_wow_boxes m
                        WHERE m.box_info_id IS NOT NULL
                          AND (m.id = ANY (v_group.ids) OR m.bag_id = v_group.bag_id));
    IF cardinality(v_cartons) > 1 THEN
      RAISE EXCEPTION 'WOW_INVALID_INPUT';
    END IF;

    IF cardinality(v_cartons) = 1 THEN
      v_carton := v_cartons[1];
      SELECT box_code INTO v_code FROM ft_box_info WHERE id = v_carton;
    ELSE
      -- 번호 칸(no)은 글자다 — 숫자만 읽는다. 같은 코드의 출고 전 박스가 있으면 건너뛴다
      SELECT COALESCE(MAX(NULLIF(regexp_replace(COALESCE(no, ''), '\D', '', 'g'), '')::int), 0) INTO v_no
        FROM ft_box_info
       WHERE user_id = v_user AND type = 'X' AND shipment_id IS NULL;
      LOOP
        v_no   := v_no + 1;
        v_code := v_user_code || '-X-' || lpad(v_no::text, 2, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM ft_box_info WHERE user_id = v_user AND box_code = v_code AND shipment_id IS NULL);
      END LOOP;
      INSERT INTO ft_box_info (user_code, box_code, type, no, status, user_id)
      VALUES (v_user_code, v_code, 'X', lpad(v_no::text, 2, '0'), 'PACKING', v_user)
      RETURNING id INTO v_carton;
    END IF;

    UPDATE ft_fulfillment_outbounds
       SET box_info_id = v_carton, box_code = v_code
     WHERE id IN (SELECT outbound_id FROM ft_wow_items WHERE wow_box_id = ANY (v_group.ids) AND outbound_id IS NOT NULL)
       AND box_info_id IS DISTINCT FROM v_carton;

    UPDATE ft_wow_boxes
       SET box_info_id = v_carton, ready_at = now(), ready_by = p_operator_name, updated_at = now()
     WHERE id = ANY (v_group.ids);

    v_out := v_out || jsonb_build_object('box_code', v_code, 'boxes', cardinality(v_group.ids));
  END LOOP;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('count', cardinality(v_ids), 'cartons', v_out);
END;
$$;

-- ============================================================
-- 15) 권한 — 새 함수는 service role 전용. 다시 만든 함수는 권한이 유지된다 (CREATE OR REPLACE)
-- ============================================================
REVOKE ALL ON FUNCTION public.ft_wow_find_set(uuid, uuid, uuid, int, int, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_find_memo(uuid, uuid, uuid, int, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_pick_found(uuid, text)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_lock_boxes(uuid[])                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_seq_set(uuid[], text)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_seq_clear(uuid[], text)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_attach_set(uuid[], boolean, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_box_size_set(uuid, text, text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_pack_set(uuid[], uuid, boolean, text)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_pack_clear(uuid[], text)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_ready_pack(uuid[], text)                     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_wow_find_set(uuid, uuid, uuid, int, int, text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_find_memo(uuid, uuid, uuid, int, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_pick_found(uuid, text)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_lock_boxes(uuid[])                           TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_seq_set(uuid[], text)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_seq_clear(uuid[], text)                      TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_attach_set(uuid[], boolean, text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_box_size_set(uuid, text, text)               TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_pack_set(uuid[], uuid, boolean, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_pack_clear(uuid[], text)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_ready_pack(uuid[], text)                     TO service_role;

-- ============================================================
-- 16) 발주서 동기화 (로켓 → 구매 DB) — 009 의 정의와 같고, "담은 박스" 를 picked_at 으로 본다
--   (상자를 출고준비 때 묶게 되어, 담았지만 box_info_id 가 아직 없는 박스가 생긴다)
--   + 하나도 담지 못하고 작업완료한 박스: 줄이 다 지워졌고 로켓도 그 박스를 뺐으면 박스 기록을 지운다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_sync_order(
  p_user_id      uuid,
  p_order_number text,
  p_center       text,
  p_lines        jsonb,
  p_boxes        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  text := NULLIF(trim(COALESCE(p_order_number, '')), '');
  v_ok     boolean;
  v_bad    text;
  v_before jsonb;
  v_line   record;
  v_cand   record;
  v_box_id uuid;
  v_left   int;
  v_take   int;
BEGIN
  -- ── 입력 검증 (형 변환 실패도 같은 코드) ──
  IF p_user_id IS NULL OR v_order IS NULL
     OR jsonb_typeof(COALESCE(p_lines, 'null')) <> 'array'
     OR jsonb_typeof(COALESCE(p_boxes, 'null')) <> 'array' THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  BEGIN
    SELECT COALESCE(bool_and(NULLIF(trim(l.barcode), '') IS NOT NULL AND l.qty > 0 AND (l.box_no IS NULL OR l.box_no > 0)), true)
           AND count(*) = count(DISTINCT (trim(l.barcode), l.box_no))
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(box_no int)
              WHERE x.box_no IS NOT NULL
                AND x.box_no NOT IN (SELECT y.box_no FROM jsonb_to_recordset(p_boxes) AS y(box_no int) WHERE y.box_no IS NOT NULL))
           AND (SELECT count(*) = count(DISTINCT y.box_no) AND count(*) = count(y.box_no)
                  FROM jsonb_to_recordset(p_boxes) AS y(box_no int, arrival_date date, box_total int))
      INTO v_ok
      FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  -- ── 잠금: 지금 이 발주서의 상품 + 원하는 바코드의 대상 상품 ──
  PERFORM ft_wow_lock(p_user_id, v_order, ARRAY(
    SELECT product_id FROM ft_wow_items WHERE user_id = p_user_id AND order_number = v_order
    UNION
    SELECT c.product_id FROM ft_wow_candidates(p_user_id) c
     WHERE c.barcode IN (SELECT trim(l.barcode) FROM jsonb_to_recordset(p_lines) AS l(barcode text))
  ));

  -- ── 얼어 있는 박스: 빠졌거나 줄이 담은 수량과 다르면 거절 ──
  SELECT string_agg(b.box_no::text, ',' ORDER BY b.box_no) INTO v_bad
    FROM ft_wow_boxes b
   WHERE b.user_id = p_user_id AND b.order_number = v_order AND b.picked_at IS NOT NULL
     AND EXISTS (
       (SELECT i.barcode, SUM(i.picked_qty)::int FROM ft_wow_items i
         WHERE i.wow_box_id = b.id GROUP BY i.barcode HAVING SUM(i.picked_qty) > 0)
       EXCEPT ALL
       (SELECT trim(l.barcode), l.qty FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int)
         WHERE l.box_no = b.box_no)
       UNION ALL
       ((SELECT trim(l.barcode), l.qty FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int)
          WHERE l.box_no = b.box_no)
        EXCEPT ALL
        (SELECT i.barcode, SUM(i.picked_qty)::int FROM ft_wow_items i
          WHERE i.wow_box_id = b.id GROUP BY i.barcode HAVING SUM(i.picked_qty) > 0))
     );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_PICKED:%', v_bad;
  END IF;

  -- ── 대상 상품이 없는 바코드 (얼어 있는 박스의 줄은 이미 묶인 상품이라 제외) ──
  SELECT string_agg(DISTINCT trim(l.barcode), ',') INTO v_bad
    FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int)
   WHERE NOT EXISTS (SELECT 1 FROM ft_wow_boxes b
                      WHERE b.user_id = p_user_id AND b.order_number = v_order
                        AND b.box_no = l.box_no AND b.picked_at IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM ft_wow_candidates(p_user_id) c WHERE c.barcode = trim(l.barcode));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BARCODE_NOT_FOUND:%', v_bad;
  END IF;

  -- ── 얼어 있는 줄: qty := 담은 수량 (0 으로 담은 줄은 지운다) ──
  DELETE FROM ft_wow_items
   WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NOT NULL AND picked_qty = 0;
  UPDATE ft_wow_items SET qty = picked_qty
   WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NOT NULL AND qty <> picked_qty;

  -- ── 안 담은 줄 · 박스를 원하는 상태로 (전후 예약 비교용으로 먼저 기록) ──
  SELECT COALESCE(jsonb_object_agg(product_id, q), '{}') INTO v_before
    FROM (SELECT product_id, SUM(qty) AS q FROM ft_wow_items
           WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NULL
           GROUP BY product_id) s;

  DELETE FROM ft_wow_items WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NULL;
  DELETE FROM ft_wow_boxes b
   WHERE b.user_id = p_user_id AND b.order_number = v_order AND b.picked_at IS NULL
     AND b.box_no NOT IN (SELECT l.box_no FROM jsonb_to_recordset(p_lines) AS l(box_no int) WHERE l.box_no IS NOT NULL);
  -- 하나도 담지 못하고 작업완료한 박스 (줄 없음 · 마킹 상자 없음) — 로켓이 뺐으면 지운다
  DELETE FROM ft_wow_boxes b
   WHERE b.user_id = p_user_id AND b.order_number = v_order AND b.picked_at IS NOT NULL AND b.box_info_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM ft_wow_items i WHERE i.wow_box_id = b.id)
     AND b.box_no NOT IN (SELECT l.box_no FROM jsonb_to_recordset(p_lines) AS l(box_no int) WHERE l.box_no IS NOT NULL);

  INSERT INTO ft_wow_boxes AS b (user_id, order_number, box_no, center, box_size, arrival_date,
                                 order_box_total, center_phone, center_address)
  SELECT p_user_id, v_order, y.box_no, NULLIF(trim(COALESCE(p_center, '')), ''), NULLIF(trim(COALESCE(y.box_size, '')), ''), y.arrival_date,
         y.box_total, NULLIF(trim(COALESCE(y.center_phone, '')), ''), NULLIF(trim(COALESCE(y.center_address, '')), '')
    FROM jsonb_to_recordset(p_boxes) AS y(box_no int, box_size text, arrival_date date,
                                          box_total int, center_phone text, center_address text)
   WHERE y.box_no IN (SELECT l.box_no FROM jsonb_to_recordset(p_lines) AS l(box_no int))
  ON CONFLICT (user_id, order_number, box_no) DO UPDATE
     SET center     = EXCLUDED.center,
         arrival_date = COALESCE(EXCLUDED.arrival_date, b.arrival_date),
         order_box_total = COALESCE(EXCLUDED.order_box_total, b.order_box_total),
         center_phone    = COALESCE(EXCLUDED.center_phone, b.center_phone),
         center_address  = COALESCE(EXCLUDED.center_address, b.center_address),
         box_size   = CASE WHEN b.picked_at IS NULL THEN EXCLUDED.box_size ELSE b.box_size END,
         updated_at = now();

  FOR v_line IN
    SELECT trim(l.barcode) AS barcode, l.box_no, l.qty
      FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int)
     WHERE NOT EXISTS (SELECT 1 FROM ft_wow_boxes b
                        WHERE b.user_id = p_user_id AND b.order_number = v_order
                          AND b.box_no = l.box_no AND b.picked_at IS NOT NULL)
     ORDER BY l.box_no NULLS FIRST, 1
  LOOP
    -- box_no NULL 이면 행이 없어 v_box_id 도 NULL (박스 미정)
    SELECT id INTO v_box_id FROM ft_wow_boxes
     WHERE user_id = p_user_id AND order_number = v_order AND box_no = v_line.box_no;
    v_left := v_line.qty;
    -- 앞에서 넣은 줄도 예약에 들어가므로 뷰의 잔여수량이 곧 남은 자리다
    FOR v_cand IN
      SELECT c.product_id, c.rank_no, count(*) OVER () AS n,
             GREATEST(COALESCE(a.available, 0), 0) AS cap
        FROM ft_wow_candidates(p_user_id) c
        LEFT JOIN ft_storage_available a ON a.user_id = p_user_id AND a.product_id = c.product_id
       WHERE c.barcode = v_line.barcode
       ORDER BY c.rank_no
    LOOP
      v_take := CASE WHEN v_cand.rank_no = v_cand.n THEN v_left ELSE LEAST(v_left, v_cand.cap) END;
      IF v_take > 0 THEN
        INSERT INTO ft_wow_items (user_id, order_number, wow_box_id, barcode, product_id, qty)
        VALUES (p_user_id, v_order, v_box_id, v_line.barcode, v_cand.product_id, v_take);
        v_left := v_left - v_take;
      END IF;
      EXIT WHEN v_left = 0;
    END LOOP;
  END LOOP;

  -- ── 예약이 늘어난 상품만 잔여수량 검사 ──
  SELECT string_agg(DISTINCT i.barcode, ',') INTO v_bad
    FROM (SELECT product_id, MAX(barcode) AS barcode, SUM(qty) AS q FROM ft_wow_items
           WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NULL
           GROUP BY product_id) i
    JOIN ft_storage_available a ON a.user_id = p_user_id AND a.product_id = i.product_id
   WHERE i.q > COALESCE((v_before->>i.product_id::text)::int, 0)
     AND a.available < 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_SHORT:%', v_bad;
  END IF;

  RETURN jsonb_build_object(
    'order_number', v_order,
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM ft_wow_order_state(p_user_id, ARRAY[v_order]) s), '[]')
  );
END;
$$;

-- ── 확인 ──
-- SELECT count(*) FILTER (WHERE picked_at IS NULL AND work_started_at IS NULL)      AS new,
--        count(*) FILTER (WHERE picked_at IS NULL AND work_started_at IS NOT NULL)  AS working,
--        count(*) FILTER (WHERE picked_at IS NOT NULL AND ship_seq IS NULL AND ready_at IS NULL) AS picked,
--        count(*) FILTER (WHERE ship_seq IS NOT NULL AND attached_at IS NULL)       AS seq,
--        count(*) FILTER (WHERE attached_at IS NOT NULL AND ready_at IS NULL)       AS pack,
--        count(*) FILTER (WHERE ready_at IS NOT NULL)                               AS ready
--   FROM public.ft_wow_boxes;

-- ── 롤백 ── (새 방식으로 담은 박스 — 포장 행에 상자가 없는 박스 — 가 없을 때만)
--   1) 함수: ft_storage_pick_core · ft_storage_pick_to_shipment · ft_wow_outbound_guard · ft_move_request_create 는 005,
--            ft_wow_work_start · ft_wow_work_cancel 은 006, ft_wow_unpack 은 008, ft_wow_sync_order 는 009 를 다시 실행
--   2) DROP FUNCTION IF EXISTS public.ft_wow_find_set(uuid, uuid, uuid, int, int, text), public.ft_wow_find_memo(uuid, uuid, uuid, int, text, text),
--        public.ft_wow_pick_found(uuid, text), public.ft_wow_lock_boxes(uuid[]), public.ft_wow_seq_set(uuid[], text), public.ft_wow_seq_clear(uuid[], text), public.ft_wow_attach_set(uuid[], boolean, text), public.ft_wow_box_size_set(uuid, text, text),
--        public.ft_wow_pack_set(uuid[], uuid, boolean, text), public.ft_wow_pack_clear(uuid[], text), public.ft_wow_ready_pack(uuid[], text);
--   3) ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_seq_chk, DROP CONSTRAINT IF EXISTS ft_wow_boxes_pack_chk;
--      ALTER TABLE public.ft_wow_boxes DROP COLUMN IF EXISTS label_printed_at, DROP COLUMN IF EXISTS label_printed_by, DROP COLUMN IF EXISTS ship_seq,
--        DROP COLUMN IF EXISTS ship_seq_at, DROP COLUMN IF EXISTS ship_seq_by, DROP COLUMN IF EXISTS attached_at, DROP COLUMN IF EXISTS attached_by, DROP COLUMN IF EXISTS packed_box_size, DROP COLUMN IF EXISTS bag_id, DROP COLUMN IF EXISTS packed_at, DROP COLUMN IF EXISTS packed_by;
--      DROP TABLE IF EXISTS public.ft_wow_finds, public.ft_wow_bags;
--   4) 묶음 규칙: DROP INDEX IF EXISTS public.ft_wow_boxes_box_info_idx; ALTER TABLE public.ft_wow_boxes ADD CONSTRAINT ft_wow_boxes_box_info_id_key UNIQUE (box_info_id);
--      ft_wow_boxes_picked_started_chk 는 006 의 6) 을 다시 실행
