-- ============================================================
-- 와우출고 — [택배엑셀] 에 들어갈 박스 정보 (화면: /storage/wow [서류준비] 탭)
--   앞 단계: supabase/storage/005_wow.sql · 007_wow_arrival.sql
--
-- 택배 접수 엑셀 한 행 = 박스 하나:
--   받는사람(센터) · 전화번호 · 주소 · 상품명 "[크기] 센터 - 발주번호 - N번 (총 M박스) - 수량개"
--   센터 연락처 · 주소와 "총 M박스"(그 발주서의 박스 전체 — 한국에서 보내는 박스 포함)는 로켓만 안다.
--
-- 로켓이 ft_wow_sync_order 의 p_boxes 에 같이 보낸다 (입고예정일과 같은 방식):
--   p_boxes = [{ box_no, box_size, arrival_date, box_total, center_phone, center_address }]
--   · 함수 인자는 그대로
--   · 값을 보내지 않으면(null · 빈 문자열) 저장된 값을 지우지 않는다
--   · 담은 박스도 센터처럼 이 값들은 갱신된다 (줄 · 박스 크기만 고정)
--   · box_total 이 숫자가 아니면 WOW_INVALID_INPUT (입력 검증에서 같이 읽는다)
-- ft_wow_sync_order 는 007 의 정의에서 이 세 값을 읽고 쓰는 네 곳만 바뀐다.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-23)
-- ============================================================

ALTER TABLE public.ft_wow_boxes
  ADD COLUMN IF NOT EXISTS order_box_total int CHECK (order_box_total > 0),
  ADD COLUMN IF NOT EXISTS center_phone    text,
  ADD COLUMN IF NOT EXISTS center_address  text;

COMMENT ON COLUMN public.ft_wow_boxes.order_box_total IS '그 발주서의 박스 전체 수 (한국에서 보내는 박스 포함) — 택배엑셀 "총 M박스". 로켓이 채운다';
COMMENT ON COLUMN public.ft_wow_boxes.center_phone IS '쿠팡 물류센터 연락처 (로켓 coupang_centers) — 택배엑셀 전화번호';
COMMENT ON COLUMN public.ft_wow_boxes.center_address IS '쿠팡 물류센터 주소 (로켓 coupang_centers) — 택배엑셀 주소';

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
   WHERE b.user_id = p_user_id AND b.order_number = v_order AND b.box_info_id IS NOT NULL
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
                        AND b.box_no = l.box_no AND b.box_info_id IS NOT NULL)
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
   WHERE b.user_id = p_user_id AND b.order_number = v_order AND b.box_info_id IS NULL
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
         box_size   = CASE WHEN b.box_info_id IS NULL THEN EXCLUDED.box_size ELSE b.box_size END,
         updated_at = now();

  FOR v_line IN
    SELECT trim(l.barcode) AS barcode, l.box_no, l.qty
      FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int)
     WHERE NOT EXISTS (SELECT 1 FROM ft_wow_boxes b
                        WHERE b.user_id = p_user_id AND b.order_number = v_order
                          AND b.box_no = l.box_no AND b.box_info_id IS NOT NULL)
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
