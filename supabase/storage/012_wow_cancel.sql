-- ============================================================
-- 와우출고 — [발주취소] : 박스를 어느 단계에서든(출고 전) 취소한다
--   앞 단계: supabase/storage/010_wow_flow.sql · 011_wow_alloc.sql
--
-- 취소하면
--   · 잡아 둔 선반이 풀린다 (그 재고는 다른 발주서에 다시 배정될 수 있다)
--   · 이미 꺼낸 수량(작업완료한 수량 · 모바일에서 찾았다고 표시한 수량)은 선반으로 되돌리지 않는다.
--     꺼낸 물건을 제자리에 다시 찾아 넣는 것보다 새로 배치하는 편이 쉽다 →
--     재고(보관) [작업중] 의 배치 대기로 돌아간다. 작업자가 어느 선반에든 다시 배치한다.
--       방법: 포장 행(ft_fulfillment_outbounds)만 지우고 꺼낸 기록(PICK)은 남긴다.
--       미배치 = 입고 − 배치 + 꺼냄 − 포장 (ft_storage_pending_lines 의 계산) 이라 그 수량이 미배치로 다시 나타난다.
--       아직 재고에서 빼지 않은 "찾았다고 표시한 수량" 은 먼저 꺼낸 것으로 기록한 뒤 같은 길로 보낸다.
--   · 순서 · 마대 · 마킹번호 · 출고준비도 같이 풀린다 (빈 마킹 상자 · 빈 마대는 지운다)
--   · 박스의 줄 · 선반 배정 · 작업 기록은 지우고, 박스 행만 "취소됨"(cancelled_at) 으로 남긴다.
--
-- 박스 행을 남기는 까닭 — 발주서의 주인은 로켓(immongRK_scan)이다.
--   박스를 그냥 지우면 로켓이 다음에 맞출 때 같은 박스를 다시 보낸다. 그래서
--     1) 취소된 박스의 줄은 발주서 동기화(ft_wow_sync_order)가 다시 넣지 않는다
--     2) 로켓의 끌어오기(pull)가 cancelled_at 을 읽어 그 위해 박스 · 위해 배정을 지운다 (발주서에 부족이 다시 생긴다)
--     3) 로켓이 그 박스를 뺀 상태를 보내면 동기화가 취소된 박스 행을 지운다 (담지 않은 박스 · 원하는 상태에 없음)
--
-- 잠금: 사업자 잠금(ft_wow_pack) → 발주서 잠금 → 상품 잠금(product_id 오름차순)
-- 권한: 1688-invoice(service role) 전용
-- 오류: WOW_INVALID_INPUT / WOW_BOX_NOT_FOUND / WOW_BOX_SHIPPED / WOW_BOX_CANCELLED(이미 취소된 박스 · 취소된 박스를 움직이려 함)
--
-- 적용: 2026-11-24 (운영 DB mkcxpkblohioqboemmah) — 같은 트랜잭션에서 자체 시험(작업완료 박스 · 표시만 한 박스 · 출고준비 박스 취소,
--   취소된 박스 보호, 로켓 동기화)을 돌려 통과한 뒤 확정했다 (시험 변경은 전부 되돌림).
--   마대에 묶인 박스의 취소는 그때 맞는 박스(마킹 상자 없는 서류준비 박스 둘)가 없어 시험하지 못했다
-- ============================================================

-- ============================================================
-- 1) 취소 기록
-- ============================================================
ALTER TABLE public.ft_wow_boxes
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text;

COMMENT ON COLUMN public.ft_wow_boxes.cancelled_at IS
  '[발주취소] 시각. 값이 있으면 줄 · 배정이 없는 "취소됨" 박스 — 로켓이 그 박스를 뺄 때까지 남아 다시 들어오는 것을 막는다';
COMMENT ON COLUMN public.ft_wow_boxes.cancelled_by IS '[발주취소] 를 누른 담당자';

ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_cancel_chk;
ALTER TABLE public.ft_wow_boxes
  ADD CONSTRAINT ft_wow_boxes_cancel_chk
  CHECK (cancelled_at IS NULL
         OR (picked_at IS NULL AND box_info_id IS NULL AND ship_seq IS NULL AND bag_id IS NULL AND ready_at IS NULL));

-- ── 취소된 박스는 얼어 있다 — 작업 · 순서 · 합포장 · 출고준비 어느 길로도 다시 움직이지 않는다 ──
--   박스를 고치는 함수가 여럿이라 한 곳(박스 행 수정 트리거)에서 막는다. 취소를 되돌리는 길도 없다 (로켓에서 다시 배정한다)
--   로켓이 보내는 부가 정보(센터 · 입고예정일 · 서류 경로)는 바뀌어도 된다
CREATE OR REPLACE FUNCTION public.ft_wow_cancelled_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.cancelled_at, NEW.work_started_at, NEW.picked_at, NEW.packed_box_size, NEW.ship_seq, NEW.attached_at,
      NEW.packed_at, NEW.bag_id, NEW.ready_at, NEW.box_info_id)
     IS DISTINCT FROM
     (OLD.cancelled_at, OLD.work_started_at, OLD.picked_at, OLD.packed_box_size, OLD.ship_seq, OLD.attached_at,
      OLD.packed_at, OLD.bag_id, OLD.ready_at, OLD.box_info_id) THEN
    RAISE EXCEPTION 'WOW_BOX_CANCELLED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ft_wow_cancelled_guard ON public.ft_wow_boxes;
CREATE TRIGGER ft_wow_cancelled_guard
  BEFORE UPDATE ON public.ft_wow_boxes
  FOR EACH ROW
  WHEN (OLD.cancelled_at IS NOT NULL)
  EXECUTE FUNCTION public.ft_wow_cancelled_guard();

-- ============================================================
-- 2) [발주취소] — 박스 여러 개를 한 번에 (한 사업자의 박스만. 하나라도 안 맞으면 전부 거절)
--   반환: { count, to_putaway } — to_putaway = 배치 대기로 돌아간 수량 (작업자가 다시 배치할 수량)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_cancel(
  p_wow_box_ids   uuid[],
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids      uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
  v_user     uuid;
  v_products uuid[];
  v_cartons  uuid[];
  v_bags     uuid[];
  v_pid      uuid;
  v_box      record;
  v_line     record;
  v_marks    jsonb;
  v_item_id  uuid;
  v_out_id   uuid;
  v_back     int := 0;
BEGIN
  IF COALESCE(cardinality(v_ids), 0) = 0
     OR (SELECT count(DISTINCT user_id) FROM ft_wow_boxes WHERE id = ANY (v_ids)) <> 1 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  SELECT DISTINCT user_id INTO v_user FROM ft_wow_boxes WHERE id = ANY (v_ids);

  -- ── 잠금: 사업자(마킹 상자 · 마대) → 발주서 · 박스 행 → 상품 ──
  PERFORM pg_advisory_xact_lock(hashtext('ft_wow_pack:' || v_user::text));
  PERFORM ft_wow_lock_boxes(v_ids);   -- 전부 있어야 하고(WOW_BOX_NOT_FOUND) 출고 전이어야 한다(WOW_BOX_SHIPPED)
  -- 잠근 뒤에 본다 — 두 사람이 같은 박스를 동시에 취소해도 한 번만 처리된다
  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'WOW_BOX_CANCELLED';
  END IF;
  v_products := ARRAY(
    SELECT DISTINCT pid FROM (
      SELECT product_id AS pid FROM ft_wow_items WHERE wow_box_id = ANY (v_ids)
      UNION
      SELECT product_id FROM ft_wow_finds WHERE wow_box_id = ANY (v_ids)) u
     ORDER BY pid);
  FOREACH v_pid IN ARRAY v_products LOOP
    PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || v_pid::text));
  END LOOP;

  v_cartons := ARRAY(SELECT DISTINCT box_info_id FROM ft_wow_boxes WHERE id = ANY (v_ids) AND box_info_id IS NOT NULL);
  v_bags    := ARRAY(SELECT DISTINCT bag_id FROM ft_wow_boxes WHERE id = ANY (v_ids) AND bag_id IS NOT NULL);

  PERFORM set_config('ft.wow', 'on', true);

  FOR v_box IN SELECT id, user_id, picked_at FROM ft_wow_boxes WHERE id = ANY (v_ids) ORDER BY id LOOP
    IF v_box.picked_at IS NOT NULL THEN
      -- ── 작업완료한 박스: 포장 행만 지운다 (꺼낸 기록은 남는다 → 그 수량이 배치 대기로 돌아간다) ──
      FOR v_out_id IN
        SELECT outbound_id FROM ft_wow_items WHERE wow_box_id = v_box.id AND outbound_id IS NOT NULL ORDER BY outbound_id
      LOOP
        v_back := v_back + COALESCE((SELECT quantity FROM ft_fulfillment_outbounds WHERE id = v_out_id), 0);
        UPDATE ft_wow_items SET outbound_id = NULL WHERE outbound_id = v_out_id;
        DELETE FROM ft_fulfillment_outbounds WHERE id = v_out_id;
      END LOOP;
      DELETE FROM ft_wow_finds WHERE wow_box_id = v_box.id;
      DELETE FROM ft_wow_items WHERE wow_box_id = v_box.id;
    ELSE
      -- ── 담기 전 박스: 찾았다고 표시한 수량은 이미 선반에서 나와 있다 → 꺼낸 것으로 기록하고 같은 길로 ──
      --   (표시 · 줄을 먼저 지운다 — 그래야 이 박스가 잡아 둔 수량이 풀려, 꺼내는 기록이 "잡힌 수량" 검사에 걸리지 않는다)
      SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', g.product_id, 'picks', g.picks) ORDER BY g.product_id), '[]')
        INTO v_marks
        FROM (SELECT f.product_id, jsonb_agg(jsonb_build_object('location_id', f.location_id, 'qty', f.found_qty)) AS picks
                FROM ft_wow_finds f
               WHERE f.wow_box_id = v_box.id AND f.location_id IS NOT NULL AND f.found_qty > 0
               GROUP BY f.product_id) g;
      DELETE FROM ft_wow_finds WHERE wow_box_id = v_box.id;
      DELETE FROM ft_wow_items WHERE wow_box_id = v_box.id;

      FOR v_line IN
        SELECT (e->>'product_id')::uuid AS product_id, e->'picks' AS picks FROM jsonb_array_elements(v_marks) e
      LOOP
        SELECT id INTO v_item_id FROM ft_order_items
         WHERE user_id = v_box.user_id AND product_id = v_line.product_id
           AND arrival_route = 'STOCK' AND status IS DISTINCT FROM 'DONE'
         ORDER BY set_seq NULLS FIRST, item_no LIMIT 1;
        v_out_id := (ft_storage_pick_core(v_box.user_id, v_line.product_id, v_item_id, v_line.picks, NULL,
                                          p_operator_name, false, 'DIRECT', NULL, NULL)->>'outbound_id')::uuid;
        v_back := v_back + COALESCE((SELECT quantity FROM ft_fulfillment_outbounds WHERE id = v_out_id), 0);
        DELETE FROM ft_fulfillment_outbounds WHERE id = v_out_id;
      END LOOP;
    END IF;

    UPDATE ft_wow_boxes
       SET cancelled_at = now(), cancelled_by = p_operator_name,
           picked_at = NULL, picked_by = NULL, box_info_id = NULL,
           ship_seq = NULL, ship_seq_at = NULL, ship_seq_by = NULL,
           attached_at = NULL, attached_by = NULL,
           packed_at = NULL, packed_by = NULL, bag_id = NULL,
           ready_at = NULL, ready_by = NULL,
           updated_at = now()
     WHERE id = v_box.id;
  END LOOP;

  -- ── 빈 마킹 상자 · 빈 마대 정리 (다른 박스가 쓰고 있으면 남긴다) ──
  DELETE FROM ft_box_info bi
   WHERE bi.id = ANY (v_cartons) AND bi.shipment_id IS NULL AND bi.master_box_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = bi.id)
     AND NOT EXISTS (SELECT 1 FROM ft_fulfillment_outbounds WHERE box_info_id = bi.id)
     AND NOT EXISTS (SELECT 1 FROM ft_box_info c WHERE c.master_box_id = bi.id);
  DELETE FROM ft_wow_bags g
   WHERE g.id = ANY (v_bags) AND NOT EXISTS (SELECT 1 FROM ft_wow_boxes WHERE bag_id = g.id);

  -- ── 풀린 재고로 다른 박스의 "재고 없음" 몫을 다시 잡는다 ──
  FOREACH v_pid IN ARRAY v_products LOOP
    PERFORM ft_wow_alloc(v_user, v_pid);
  END LOOP;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('count', cardinality(v_ids), 'to_putaway', v_back);
END;
$$;

REVOKE ALL ON FUNCTION public.ft_wow_cancel(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_wow_cancel(uuid[], text) TO service_role;

-- ============================================================
-- 3) 발주서 동기화 (로켓 → 구매 DB) — 011 의 9) 와 같고, 취소된 박스의 줄은 다시 넣지 않는다
--   (로켓이 그 박스를 뺀 상태를 보내면 "담지 않았고 원하는 상태에 없는 박스" 로 지워진다)
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
  v_pid    uuid;
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

  -- ── 대상 상품이 없는 바코드 (얼어 있는 박스의 줄은 이미 묶인 상품이라 제외 · 취소된 박스의 줄은 넣지 않으므로 제외) ──
  SELECT string_agg(DISTINCT trim(l.barcode), ',') INTO v_bad
    FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int)
   WHERE NOT EXISTS (SELECT 1 FROM ft_wow_boxes b
                      WHERE b.user_id = p_user_id AND b.order_number = v_order
                        AND b.box_no = l.box_no AND (b.picked_at IS NOT NULL OR b.cancelled_at IS NOT NULL))
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
                          AND b.box_no = l.box_no AND (b.picked_at IS NOT NULL OR b.cancelled_at IS NOT NULL))
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

  -- ── 선반 배정: 이 발주서가 건드린 상품(바뀌기 전 + 바뀐 뒤)의 할 일을 재고에 맞춘다 ──
  FOR v_pid IN
    SELECT DISTINCT u.pid
      FROM (SELECT product_id AS pid FROM ft_wow_items WHERE user_id = p_user_id AND order_number = v_order
            UNION
            SELECT k::uuid FROM jsonb_object_keys(v_before) AS k) u
     ORDER BY u.pid
  LOOP
    PERFORM ft_wow_alloc(p_user_id, v_pid);
  END LOOP;

  RETURN jsonb_build_object(
    'order_number', v_order,
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM ft_wow_order_state(p_user_id, ARRAY[v_order]) s), '[]')
  );
END;
$$;

-- ── 확인 ──
-- SELECT order_number, box_no, cancelled_at, cancelled_by FROM public.ft_wow_boxes WHERE cancelled_at IS NOT NULL;

-- ── 롤백 ── (취소된 박스 행이 없을 때만)
--   DROP FUNCTION IF EXISTS public.ft_wow_cancel(uuid[], text);
--   DROP TRIGGER IF EXISTS ft_wow_cancelled_guard ON public.ft_wow_boxes;
--   DROP FUNCTION IF EXISTS public.ft_wow_cancelled_guard();
--   ft_wow_sync_order 는 011 을 다시 실행
--   ALTER TABLE public.ft_wow_boxes DROP CONSTRAINT IF EXISTS ft_wow_boxes_cancel_chk;
--   ALTER TABLE public.ft_wow_boxes DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS cancelled_by;
