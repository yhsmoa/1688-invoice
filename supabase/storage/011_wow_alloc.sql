-- ============================================================
-- 와우출고 — 선반까지 잡아 두기 (로켓 immongRK_scan 의 배정과 같은 방식)
--   앞 단계: supabase/storage/010_wow_flow.sql
--
-- 지금까지: 배정할 때 상품별 수량만 잡았다 (ft_storage_available.reserved). 어느 선반에서 꺼낼지는
--   화면을 열 때마다 "먼저 넣은 선반부터" 로 계산했고, 재고는 작업완료 때 빠졌다
--   → 같은 상품을 담는 두 박스가 같은 선반을 안내받을 수 있었다.
-- 이제부터: 박스가 들어올 때 "박스 × 상품 × 선반 × 수량" 을 저장해 잡아 둔다 (ft_wow_finds 의 표시 전 줄 = 할 일).
--   · 선반마다 잡힌 수량(담지 않은 박스들의 할 일 + 찾았다고 표시한 수량)은 그 선반 재고를 넘지 않는다
--   · 모바일 카드 = 저장된 할 일 그대로 (화면에서 다시 계산하지 않는다)
--   · 다시 잡는 것은 재고가 실제로 달라졌을 때뿐이다:
--       - 그 선반에서 덜 나왔다고 표시함        → 모자란 몫만 잡히지 않은 다른 선반에 (없으면 "재고 없음" 몫)
--       - 위치 이동 · 수량 수정 · 배치 · 포장 철회 → 넘치게 잡힌 선반은 늦은 박스부터 줄이고, 모자란 몫을 다시 채운다
--       - 로켓이 줄을 바꾸거나 박스를 뺌         → 그 상품만 다시 맞춘다
--   · 재고 화면의 [쉽먼트](와우가 아닌 꺼내기)는 와우출고에 잡힌 선반 수량을 꺼낼 수 없다 (STOCK_RESERVED_WOW)
--     어떤 변화든 "찾았다고 표시하고 아직 작업완료하지 않은 수량" 밑으로는 줄일 수 없다 (같은 오류)
--
-- ft_wow_finds 의 뜻 (한 줄 = 카드 하나)
--     found_qty NULL                  할 일 — plan_qty 만큼 그 선반에서 꺼낸다 (잡아 둔 수량)
--     found_qty 있음 · 선반 있음       꺼냄 — plan_qty = found_qty (0 이면 "여기엔 없음" — 그 선반은 이 박스에 다시 잡지 않는다)
--     found_qty 있음 · 선반 없음       부족 확인 — plan_qty = 부족 수량
--     found_qty NULL · 선반 없음       재고 없음 — 잡을 재고가 없는 몫 (재고가 생기면 다시 잡힌다)
--   줄마다 Σ plan_qty = 요청 수량(ft_wow_items.qty)
--
-- 배정 순서: 입고예정일 → 발주번호 → 박스번호가 빠른 박스부터, 선반은 먼저 넣은 순 (지금까지의 화면 계산과 같은 순서)
-- 잠금: 상품 잠금(ft_storage:<product_id>) 하나로 그 상품의 할 일을 지킨다 — 재고를 바꾸는 함수는 모두 이 잠금을 잡는다
-- 오류 추가: STOCK_RESERVED_WOW
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-24) — 적용할 때 자체 시험(옛 박스 하나로 배정 · 재배정 · 거절 → 전부 되돌림)을 같이 돌렸다
-- ============================================================

-- ============================================================
-- 1) 할 일도 같은 표에 — "찾음 또는 메모가 있어야 한다" 는 조건을 없앤다
-- ============================================================
ALTER TABLE public.ft_wow_finds DROP CONSTRAINT IF EXISTS ft_wow_finds_any_chk;

COMMENT ON TABLE public.ft_wow_finds IS
  '와우출고 선반 배정 · 모바일 작업 기록 — 한 줄 = 카드(박스 × 상품 × 선반). found_qty NULL = 할 일(plan_qty 만큼 잡아 둠), 있음 = 표시함. location_id NULL = 잡을 재고가 없는 몫. 배정은 ft_wow_alloc 만 한다';

CREATE INDEX IF NOT EXISTS ft_wow_finds_product_idx ON public.ft_wow_finds (product_id);

-- ============================================================
-- 2) 선반 배정 — 그 상품의 할 일을 재고에 맞춘다 (몇 번을 불러도 결과가 같다)
--   부르는 쪽이 상품 잠금을 잡고 있어야 한다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_alloc(p_user_id uuid, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_loc  record;
  v_task record;
  v_line record;
  v_over int;
  v_cut  int;
  v_need int;
  v_take int;
BEGIN
  -- 담지 않은 박스에 이 상품의 줄도 할 일도 없으면 할 것이 없다 (와우와 무관한 상품의 재고 변화가 대부분이다)
  IF NOT EXISTS (SELECT 1 FROM ft_wow_items i JOIN ft_wow_boxes b ON b.id = i.wow_box_id
                  WHERE b.user_id = p_user_id AND b.picked_at IS NULL AND i.product_id = p_product_id)
     AND NOT EXISTS (SELECT 1 FROM ft_wow_finds f JOIN ft_wow_boxes b ON b.id = f.wow_box_id
                      WHERE b.user_id = p_user_id AND b.picked_at IS NULL AND f.product_id = p_product_id) THEN
    RETURN;
  END IF;

  -- ── 1) 줄이 없어진 박스의 할 일 · 기록을 지운다 ──
  DELETE FROM ft_wow_finds f
   USING ft_wow_boxes b
   WHERE f.wow_box_id = b.id AND b.user_id = p_user_id AND b.picked_at IS NULL AND f.product_id = p_product_id
     AND NOT EXISTS (SELECT 1 FROM ft_wow_items i WHERE i.wow_box_id = b.id AND i.product_id = p_product_id);

  -- ── 2) 표시 전 "재고 없음" 몫은 비운다 (아래에서 지금 재고로 다시 계산한다) ──
  UPDATE ft_wow_finds f
     SET plan_qty = 0, updated_at = now()
    FROM ft_wow_boxes b
   WHERE f.wow_box_id = b.id AND b.user_id = p_user_id AND b.picked_at IS NULL AND f.product_id = p_product_id
     AND f.location_id IS NULL AND f.found_qty IS NULL AND f.plan_qty <> 0;

  -- ── 3) 선반 재고보다 많이 잡힌 선반: 표시 전 할 일을 늦은 박스부터 줄인다 (표시한 수량은 건드리지 않는다) ──
  FOR v_loc IN
    SELECT f.location_id,
           (SUM(COALESCE(f.found_qty, f.plan_qty))
            - COALESCE((SELECT SUM(m.delta) FROM ft_storage_movements m
                         WHERE m.user_id = p_user_id AND m.product_id = p_product_id AND m.location_id = f.location_id), 0))::int AS over
      FROM ft_wow_finds f
      JOIN ft_wow_boxes b ON b.id = f.wow_box_id
     WHERE b.user_id = p_user_id AND b.picked_at IS NULL AND f.product_id = p_product_id AND f.location_id IS NOT NULL
     GROUP BY f.location_id
  LOOP
    v_over := v_loc.over;
    CONTINUE WHEN v_over <= 0;
    FOR v_task IN
      SELECT f.id, f.plan_qty
        FROM ft_wow_finds f
        JOIN ft_wow_boxes b ON b.id = f.wow_box_id
       WHERE b.user_id = p_user_id AND b.picked_at IS NULL AND f.product_id = p_product_id
         AND f.location_id = v_loc.location_id AND f.found_qty IS NULL AND f.plan_qty > 0
       ORDER BY b.arrival_date DESC NULLS FIRST, b.order_number DESC, b.box_no DESC
    LOOP
      EXIT WHEN v_over <= 0;
      v_cut := LEAST(v_task.plan_qty, v_over);
      UPDATE ft_wow_finds SET plan_qty = plan_qty - v_cut, updated_at = now() WHERE id = v_task.id;
      v_over := v_over - v_cut;
    END LOOP;
  END LOOP;

  -- ── 4) 줄마다 몫의 합을 요청 수량에 맞춘다 — 입고예정일 · 발주번호 · 박스번호가 빠른 박스부터 ──
  FOR v_line IN
    SELECT b.id AS box_id, i.qty,
           COALESCE((SELECT SUM(f.plan_qty) FROM ft_wow_finds f
                      WHERE f.wow_box_id = b.id AND f.product_id = p_product_id), 0)::int AS planned
      FROM ft_wow_items i
      JOIN ft_wow_boxes b ON b.id = i.wow_box_id
     WHERE b.user_id = p_user_id AND b.picked_at IS NULL AND i.product_id = p_product_id
     ORDER BY b.arrival_date NULLS LAST, b.order_number, b.box_no
  LOOP
    v_need := v_line.qty - v_line.planned;

    -- 4-a) 요청이 줄었다: 표시 전 할 일을 나중에 잡은 것부터 줄인다 (표시한 수량이 요청보다 많으면 작업완료가 WOW_PICK_OVER 로 알린다)
    IF v_need < 0 THEN
      FOR v_task IN
        SELECT f.id, f.plan_qty
          FROM ft_wow_finds f
         WHERE f.wow_box_id = v_line.box_id AND f.product_id = p_product_id AND f.found_qty IS NULL AND f.plan_qty > 0
         ORDER BY f.created_at DESC, f.id DESC
      LOOP
        EXIT WHEN v_need >= 0;
        v_cut := LEAST(v_task.plan_qty, -v_need);
        UPDATE ft_wow_finds SET plan_qty = plan_qty - v_cut, updated_at = now() WHERE id = v_task.id;
        v_need := v_need + v_cut;
      END LOOP;
    END IF;

    -- 4-b) 모자란 몫: 잡히지 않은 재고가 있는 선반에, 먼저 넣은 순으로
    --      (이 박스가 이미 표시한 선반은 다시 잡지 않는다 — 거기서 꺼낼 만큼 꺼냈다)
    IF v_need > 0 THEN
      FOR v_loc IN
        SELECT s.location_id,
               (s.qty - COALESCE((SELECT SUM(COALESCE(f.found_qty, f.plan_qty))
                                    FROM ft_wow_finds f
                                    JOIN ft_wow_boxes ob ON ob.id = f.wow_box_id
                                   WHERE ob.user_id = p_user_id AND ob.picked_at IS NULL
                                     AND f.product_id = p_product_id AND f.location_id = s.location_id), 0))::int AS free
          FROM ft_storage_balance s
         WHERE s.user_id = p_user_id AND s.product_id = p_product_id AND s.qty > 0
           AND NOT EXISTS (SELECT 1 FROM ft_wow_finds f
                            WHERE f.wow_box_id = v_line.box_id AND f.product_id = p_product_id
                              AND f.location_id = s.location_id AND f.found_qty IS NOT NULL)
         ORDER BY s.first_putaway_at NULLS LAST, s.location_id
      LOOP
        EXIT WHEN v_need <= 0;
        CONTINUE WHEN v_loc.free <= 0;
        v_take := LEAST(v_loc.free, v_need);
        INSERT INTO ft_wow_finds AS f (wow_box_id, product_id, location_id, plan_qty)
        VALUES (v_line.box_id, p_product_id, v_loc.location_id, v_take)
        ON CONFLICT ON CONSTRAINT ft_wow_finds_card_uniq DO UPDATE
           SET plan_qty = f.plan_qty + EXCLUDED.plan_qty, updated_at = now();
        v_need := v_need - v_take;
      END LOOP;

      -- 잡을 재고가 없는 몫 — "재고 없음". 부족으로 확인해 둔 줄이 있으면 늘어난 만큼 다시 확인받는다
      IF v_need > 0 THEN
        INSERT INTO ft_wow_finds AS f (wow_box_id, product_id, location_id, plan_qty)
        VALUES (v_line.box_id, p_product_id, NULL, v_need)
        ON CONFLICT ON CONSTRAINT ft_wow_finds_card_uniq DO UPDATE
           SET plan_qty = f.plan_qty + EXCLUDED.plan_qty,
               found_qty = NULL, found_by = NULL, found_at = NULL, updated_at = now();
      END IF;
    END IF;
  END LOOP;

  -- ── 5) 몫이 0 이 된 표시 전 할 일을 치운다 (메모가 적힌 줄은 남긴다) ──
  DELETE FROM ft_wow_finds f
   USING ft_wow_boxes b
   WHERE f.wow_box_id = b.id AND b.user_id = p_user_id AND b.picked_at IS NULL AND f.product_id = p_product_id
     AND f.found_qty IS NULL AND f.plan_qty = 0 AND f.memo IS NULL;
END;
$$;

-- ============================================================
-- 3) 재고가 바뀔 때마다 — 원장(ft_storage_movements)에 줄이 들어가면 그 상품의 배정을 맞춘다
--   배치 · 꺼내기 · 포장 철회 · 위치 이동 · 수량 수정 어느 길로 바뀌든 여기 한 곳을 지난다
--   줄어드는 변화는 먼저 검사한다:
--     · 찾았다고 표시하고 아직 작업완료하지 않은 수량 밑으로는 줄일 수 없다
--     · 와우가 아닌 꺼내기(PICK)는 잡힌 수량을 꺼낼 수 없다 (와우 함수는 ft.wow = 'on' 으로 지나간다)
--     위치 이동 · 수량 수정은 실물이 먼저다 — 막지 않고 배정을 다시 맞춘다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_alloc_on_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_balance  int;
  v_marked   int;
  v_reserved int;
BEGIN
  IF NEW.delta < 0 THEN
    SELECT COALESCE(SUM(f.found_qty), 0), COALESCE(SUM(COALESCE(f.found_qty, f.plan_qty)), 0)
      INTO v_marked, v_reserved
      FROM ft_wow_finds f
      JOIN ft_wow_boxes b ON b.id = f.wow_box_id
     WHERE b.user_id = NEW.user_id AND b.picked_at IS NULL
       AND f.product_id = NEW.product_id AND f.location_id = NEW.location_id;
    IF v_reserved > 0 THEN
      SELECT COALESCE(SUM(delta), 0) INTO v_balance
        FROM ft_storage_movements
       WHERE user_id = NEW.user_id AND product_id = NEW.product_id AND location_id = NEW.location_id;
      IF v_balance < v_marked
         OR (NEW.kind = 'PICK' AND current_setting('ft.wow', true) IS DISTINCT FROM 'on' AND v_balance < v_reserved) THEN
        RAISE EXCEPTION 'STOCK_RESERVED_WOW';
      END IF;
    END IF;
  END IF;

  PERFORM ft_wow_alloc(NEW.user_id, NEW.product_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ft_wow_alloc_on_movement ON public.ft_storage_movements;
CREATE TRIGGER ft_wow_alloc_on_movement
  AFTER INSERT ON public.ft_storage_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.ft_wow_alloc_on_movement();

-- ============================================================
-- 4) 모바일 카드 표시 — 010 의 6) 을 바꾼다: 카드는 저장된 할 일이다
--   p_plan_qty = 화면에 보인 그 카드의 몫 — 저장된 값과 다르면 그 사이 배정이 바뀐 것이다 (WOW_INVALID_INPUT → 새로고침)
--   p_found_qty NULL = 표시 취소 (할 일로 돌아가고, 모자란 몫은 다시 잡는다)
--   선반 카드: 찾은 수량 ≤ 몫. 적게 찾으면 몫 = 찾은 수량으로 줄고 나머지는 다른 선반에 다시 잡힌다 (없으면 "재고 없음" 몫)
--   선반 없는 카드: 찾은 수량은 0 뿐 (부족 확인)
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
  v_box     ft_wow_boxes%ROWTYPE;
  v_task    ft_wow_finds%ROWTYPE;
  v_balance int;
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

  SELECT * INTO v_task FROM ft_wow_finds
   WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id AND location_id IS NOT DISTINCT FROM p_location_id
     FOR UPDATE;
  IF NOT FOUND OR v_task.plan_qty IS DISTINCT FROM p_plan_qty THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  -- ── 표시 취소: 할 일로 되돌리고 모자란 몫을 다시 잡는다 ──
  IF p_found_qty IS NULL THEN
    UPDATE ft_wow_finds
       SET found_qty = NULL, found_by = NULL, found_at = NULL, updated_at = now()
     WHERE id = v_task.id;
    PERFORM ft_wow_alloc(v_box.user_id, p_product_id);
    RETURN jsonb_build_object('cleared', true);
  END IF;

  IF p_found_qty < 0 OR (p_location_id IS NULL AND p_found_qty > 0) THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  IF p_location_id IS NULL THEN
    UPDATE ft_wow_finds
       SET found_qty = 0, found_by = p_operator_name, found_at = now(), updated_at = now()
     WHERE id = v_task.id;
  ELSE
    IF p_found_qty > v_task.plan_qty THEN
      RAISE EXCEPTION 'WOW_FIND_OVER';
    END IF;
    SELECT COALESCE(SUM(delta), 0) INTO v_balance
      FROM ft_storage_movements
     WHERE user_id = v_box.user_id AND product_id = p_product_id AND location_id = p_location_id;
    IF p_found_qty > v_balance THEN
      RAISE EXCEPTION 'WOW_FIND_OVER_STOCK';
    END IF;
    UPDATE ft_wow_finds
       SET plan_qty = p_found_qty, found_qty = p_found_qty, found_by = p_operator_name, found_at = now(), updated_at = now()
     WHERE id = v_task.id;
    -- 덜 나온 만큼은 다른 선반에 다시 잡는다
    IF p_found_qty < v_task.plan_qty THEN
      PERFORM ft_wow_alloc(v_box.user_id, p_product_id);
    END IF;
  END IF;

  IF v_box.work_started_at IS NULL THEN
    UPDATE ft_wow_boxes
       SET work_started_at = now(), work_started_by = p_operator_name, updated_at = now()
     WHERE id = p_wow_box_id;
  END IF;

  RETURN jsonb_build_object('found', p_found_qty);
END;
$$;

-- ── 카드 메모 — 010 의 7) 을 바꾼다: 저장된 카드에만 적는다 (p_plan_qty 는 쓰지 않는다 — 서명 유지) ──
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
  PERFORM ft_wow_lock(v_box.user_id, v_box.order_number, ARRAY[p_product_id]);

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.picked_at IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;
  IF char_length(COALESCE(v_memo, '')) > 500 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  UPDATE ft_wow_finds
     SET memo = v_memo,
         memo_by = CASE WHEN v_memo IS NULL THEN NULL ELSE p_operator_name END,
         memo_at = CASE WHEN v_memo IS NULL THEN NULL ELSE now() END,
         updated_at = now()
   WHERE wow_box_id = p_wow_box_id AND product_id = p_product_id AND location_id IS NOT DISTINCT FROM p_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  RETURN jsonb_build_object('memo', v_memo);
END;
$$;

-- ============================================================
-- 5) 모바일 [작업완료] — 010 의 8) 을 바꾼다
--   · 표시 전 할 일이 남아 있으면 거절 (WOW_FIND_INCOMPLETE)
--   · 박스를 먼저 "담음" 으로 바꾼 뒤 재고를 꺼낸다 — 그래야 이 박스가 잡아 둔 수량이 풀리고
--     재고 변화 트리거(3))가 이 박스 몫을 다른 박스의 몫으로 세지 않는다
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
  IF EXISTS (SELECT 1 FROM ft_wow_finds WHERE wow_box_id = p_wow_box_id AND found_qty IS NULL AND plan_qty > 0) THEN
    RAISE EXCEPTION 'WOW_FIND_INCOMPLETE';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  UPDATE ft_wow_boxes
     SET picked_at = now(), picked_by = p_operator_name,
         work_started_at = COALESCE(work_started_at, now()),
         work_started_by = COALESCE(work_started_by, p_operator_name),
         updated_at = now()
   WHERE id = p_wow_box_id;

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

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('picked', v_total);
END;
$$;

-- ============================================================
-- 6) [작업 취소] — 010 의 5) 를 바꾼다: 표시를 지우고 그 박스의 할 일을 처음부터 다시 잡는다
-- ============================================================
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
  v_pid uuid;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;

  PERFORM ft_wow_lock(p_user_id, v_box.order_number,
                      ARRAY(SELECT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id
                            UNION SELECT product_id FROM ft_wow_finds WHERE wow_box_id = p_wow_box_id));

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

  FOR v_pid IN SELECT DISTINCT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id ORDER BY product_id LOOP
    PERFORM ft_wow_alloc(p_user_id, v_pid);
  END LOOP;

  RETURN jsonb_build_object('cancelled', true);
END;
$$;

-- ============================================================
-- 7) [작업완료 취소] — 010 의 9) 와 같고, 끝에 그 박스 상품들의 배정을 다시 맞춘다
--   (재고가 꺼냈던 선반으로 돌아오고, 박스는 표시해 둔 카드를 그대로 가진 채 작업중으로 돌아간다)
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
  v_pid  uuid;
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

  -- 다시 담지 않은 박스가 됐다 → 이 박스의 카드(표시해 둔 것 포함)가 다시 재고를 잡는다
  FOR v_pid IN SELECT DISTINCT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id ORDER BY product_id LOOP
    PERFORM ft_wow_alloc(p_user_id, v_pid);
  END LOOP;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('returned', v_back);
END;
$$;

-- ============================================================
-- 8) 권한 — 배정 함수 · 트리거 함수는 service role 전용 (다른 함수 안에서만 불린다)
-- ============================================================
REVOKE ALL ON FUNCTION public.ft_wow_alloc(uuid, uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_alloc_on_movement()     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_wow_alloc(uuid, uuid)    TO service_role;

-- ============================================================
-- 9) 발주서 동기화 (로켓 → 구매 DB) — 010 의 16) 과 같고, 끝에서 이 발주서가 건드린 상품들의 배정을 맞춘다
--   (로켓이 박스를 보내는 순간 선반이 잡힌다. 줄이 바뀌거나 박스가 빠지면 그 상품만 다시 맞춘다)
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

-- ============================================================
-- 10) 첫 배정 — 지금 담지 않은 박스들의 선반을 잡는다
-- ============================================================
DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT DISTINCT b.user_id, i.product_id
      FROM ft_wow_items i
      JOIN ft_wow_boxes b ON b.id = i.wow_box_id
     WHERE b.picked_at IS NULL
     ORDER BY i.product_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || v_row.product_id::text));
    PERFORM ft_wow_alloc(v_row.user_id, v_row.product_id);
  END LOOP;
END;
$$;

-- ── 확인 ── 줄마다 몫의 합 = 요청 수량 · 선반마다 잡힌 수량 ≤ 재고 (둘 다 0행이어야 한다)
-- SELECT b.order_number, b.box_no, i.product_id, i.qty, COALESCE(SUM(f.plan_qty), 0) AS planned
--   FROM ft_wow_items i JOIN ft_wow_boxes b ON b.id = i.wow_box_id
--   LEFT JOIN ft_wow_finds f ON f.wow_box_id = b.id AND f.product_id = i.product_id
--  WHERE b.picked_at IS NULL GROUP BY 1, 2, 3, 4 HAVING COALESCE(SUM(f.plan_qty), 0) <> i.qty;
-- SELECT f.product_id, f.location_id, SUM(COALESCE(f.found_qty, f.plan_qty)) AS reserved, s.qty
--   FROM ft_wow_finds f JOIN ft_wow_boxes b ON b.id = f.wow_box_id
--   LEFT JOIN ft_storage_balance s ON s.user_id = b.user_id AND s.product_id = f.product_id AND s.location_id = f.location_id
--  WHERE b.picked_at IS NULL AND f.location_id IS NOT NULL GROUP BY 1, 2, s.qty HAVING SUM(COALESCE(f.found_qty, f.plan_qty)) > COALESCE(s.qty, 0);

-- ── 롤백 ──
--   DROP TRIGGER IF EXISTS ft_wow_alloc_on_movement ON public.ft_storage_movements;
--   DROP FUNCTION IF EXISTS public.ft_wow_alloc_on_movement(), public.ft_wow_alloc(uuid, uuid);
--   ft_wow_find_set · ft_wow_find_memo · ft_wow_pick_found · ft_wow_work_cancel · ft_wow_unpack · ft_wow_sync_order 는 010 을 다시 실행
--   DELETE FROM public.ft_wow_finds WHERE found_qty IS NULL AND memo IS NULL;   -- 표시 전 할 일
--   ALTER TABLE public.ft_wow_finds ADD CONSTRAINT ft_wow_finds_any_chk CHECK (found_qty IS NOT NULL OR memo IS NOT NULL);
