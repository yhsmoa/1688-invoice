/* ============================================================
   1688 주문현황 크롤러 v3  (API 직접 호출 방식)
   - 스크롤/탭클릭/페이지사이즈 변경 전부 불필요 → DOM을 아예 안 읽음
   - 페이지가 내부적으로 쓰는 mtop API를 그대로 호출:
       · OrderListDataLineService.buyerOrderList        (주문목록, 100건/페이지)
       · OrderCardDataLineService.batchQueryFulfillmentSummary (물류상태/택배사/송장, 10건 배치)
       · mtop.1688.deliveryLimitTime.listDeliveryLimitTime4OrderList (발송지연 문구, 待发货 보조)
   - 백그라운드 탭이어도 동작 (lazy-load 의존 없음)
   - CSV 형식은 v2와 동일 (8열: 탭,주문번호,주문일시,주문상태,물류상태,상세내용,택배사,송장번호)
   ※ 주문목록 페이지(air.1688.com/.../buyer-order-list.html) 콘솔에서 실행

   실행 순서 (단계 분리):
     1단계  모든 탭의 주문목록만 먼저 수집 (페이지 단위 실패 격리 → 끝에 재시도)
     2단계  수집된 전체 주문의 물류 요약 조회 (배치 단위 실패 격리 → 끝에 재시도)
     3단계  待发货 발송지연 문구 (선택적)
     4단계  행 조립 → CSV
   누락이 남으면 CSV 를 만들지 않는다 — 업로드 시 계정 행이 통째로 교체되므로
   불완전한 CSV 는 서버의 주문 행을 지운다. 받은 데이터는 window._1688_ALL 에 남긴다.
   ============================================================ */

window._1688_ALL = [];
window._1688_DONE = false;

(async () => {
  const DELAY = ms => new Promise(r => setTimeout(r, ms));

  /* ============================================================
     설정
     ============================================================ */
  const PAGE_SIZE = 100;
  const MTOP_TIMEOUT_MS = 60000;      // mtop SDK 기본 20초 → 100건+물류 조회는 넘길 수 있음
  const MTOP_MAX_ATTEMPTS = 5;        // 한 호출당 최대 시도 횟수
  const MTOP_BACKOFF_BASE_MS = 3000;  // 재시도 대기: 3s → 6s → 12s → 24s (지수 백오프)
  const PAGE_GAP_MS = 500;            // 목록 페이지 사이 간격
  const FULFILL_BATCH = 10;           // 물류 요약 배치 크기 (API 한도)
  const FULFILL_GAP_MS = 300;         // 물류 배치 사이 간격 (순차 호출)
  const RETRY_ROUND_GAP_MS = 5000;    // 실패분 재시도 라운드 전 대기

  /* ============================================================
     mtop 호출 (명시적 timeout + 지수 백오프)
     ============================================================ */
  async function mtopCall(data, api) {
    let lastErr = '';
    for (let attempt = 1; attempt <= MTOP_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await window.lib.mtop.request({
          api: api || 'mtop.1688.trading.dataline.service',
          v: '1.0', ecode: 1, type: 'POST', dataType: 'json',
          timeout: MTOP_TIMEOUT_MS,
          data
        });
        const ret = String(res.ret && res.ret[0] || '');
        if (ret.includes('SUCCESS')) return res;
        lastErr = ret;
        console.warn(`  ⚠️ mtop 실패(${attempt}/${MTOP_MAX_ATTEMPTS}): ${ret}`);
      } catch (e) {
        lastErr = String((e && (e.ret && e.ret[0] || e.message)) || 'unknown');
        console.warn(`  ⚠️ mtop 예외(${attempt}/${MTOP_MAX_ATTEMPTS}): ${lastErr}`);
      }
      if (attempt < MTOP_MAX_ATTEMPTS) {
        const wait = MTOP_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`     ↳ ${wait / 1000}초 후 재시도`);
        await DELAY(wait);
      }
    }
    throw new Error(`mtop 호출 ${MTOP_MAX_ATTEMPTS}회 실패 (${lastErr})`);
  }

  function parseResult(res) {
    let raw = res.data && res.data.data && res.data.data.result;
    if (raw == null) raw = res.data && res.data.result;
    if (typeof raw === 'string') raw = JSON.parse(raw);
    return raw;
  }

  /* ============================================================
     1단계. 주문목록 (100건/페이지, 페이지 단위 실패 격리)
     ============================================================ */
  async function fetchOrderList(tradeStatus, page) {
    const res = await mtopCall({
      serviceId: 'OrderListDataLineService.buyerOrderList',
      param: JSON.stringify({ tradeStatus, page, pageSize: PAGE_SIZE })
    });
    const j = parseResult(res);
    return j.data;   // { data:[...], total, pages, pageSize }
  }

  // ── 페이지 묶음을 순차로 받고, 실패한 페이지 번호를 돌려준다 ──
  async function fetchPages(tradeStatus, tabLabel, pageNums, pageMap, totalPages) {
    const failed = [];
    for (const p of pageNums) {
      try {
        const pg = await fetchOrderList(tradeStatus, p);
        pageMap[p] = pg.data || [];
        const got = Object.values(pageMap).reduce((n, arr) => n + arr.length, 0);
        console.log(`  📥 [${tabLabel}] 목록 p${p}/${totalPages} (누적 ${got}건)`);
      } catch (e) {
        failed.push(p);
        console.warn(`  ❌ [${tabLabel}] 목록 p${p} 실패 → 건너뜀 (끝에 재시도): ${e.message}`);
      }
      await DELAY(PAGE_GAP_MS);
    }
    return failed;
  }

  // ── 한 탭의 주문목록 전체 → { orders, missingPages } ──
  async function fetchTabOrders(tradeStatus, tabLabel) {
    console.log(`\n🔄 [${tabLabel}] 주문목록 수집 시작...`);
    const first = await fetchOrderList(tradeStatus, 1);   // 1페이지는 total 을 알아야 하므로 실패 시 중단
    const total = first.total;
    const pages = first.pages || Math.ceil(total / PAGE_SIZE);
    console.log(`📄 [${tabLabel}] 총 ${total}건 / ${pages}페이지`);

    const pageMap = { 1: first.data || [] };
    const rest = [];
    for (let p = 2; p <= pages; p++) rest.push(p);

    let missing = await fetchPages(tradeStatus, tabLabel, rest, pageMap, pages);
    if (missing.length) {
      console.warn(`  🔁 [${tabLabel}] 실패 페이지 ${missing.length}개 재시도: p${missing.join(', p')}`);
      await DELAY(RETRY_ROUND_GAP_MS);
      missing = await fetchPages(tradeStatus, tabLabel, missing, pageMap, pages);
    }

    let orders = [];
    for (let p = 1; p <= pages; p++) orders = orders.concat(pageMap[p] || []);

    // 중복 제거 (크롤링 중 주문상태 변동으로 페이지가 밀리는 경우 대비)
    const seen = {};
    orders = orders.filter(o => !seen[o.idStr] && (seen[o.idStr] = 1));

    console.log(`✅ [${tabLabel}] 목록 ${orders.length}건 수집` + (missing.length ? ` (누락 페이지 ${missing.length}개)` : ''));
    return { orders, missingPages: missing };
  }

  /* ============================================================
     2단계. 물류 요약 (10건 배치, 순차, 배치 단위 실패 격리)
     ============================================================ */
  async function fetchFulfillmentChunks(chunks, map, label) {
    const failed = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const raw = parseResult(await mtopCall({
          serviceId: 'OrderCardDataLineService.batchQueryFulfillmentSummary',
          param: JSON.stringify({ orderIds: chunk })
        }));
        const arr = Array.isArray(raw) ? raw : (raw && raw.data) || [];
        arr.forEach(f => { map[f.orderId] = f; });
        if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
          console.log(`  🚚 ${label} 물류 배치 ${i + 1}/${chunks.length}`);
        }
      } catch (e) {
        failed.push(chunk);
        console.warn(`  ❌ 물류 배치 ${i + 1}/${chunks.length} 실패 → 건너뜀 (끝에 재시도): ${e.message}`);
      }
      await DELAY(FULFILL_GAP_MS);
    }
    return failed;
  }

  // ── 전체 주문 ID → { map, missingIds } ──
  async function fetchFulfillment(ids) {
    const map = {};
    const chunks = [];
    for (let i = 0; i < ids.length; i += FULFILL_BATCH) chunks.push(ids.slice(i, i + FULFILL_BATCH));
    console.log(`\n🚚 물류정보 조회 시작... (${ids.length}건, ${FULFILL_BATCH}건씩 ${chunks.length}배치)`);

    let failed = await fetchFulfillmentChunks(chunks, map, '');
    if (failed.length) {
      console.warn(`  🔁 실패 물류 배치 ${failed.length}개 재시도`);
      await DELAY(RETRY_ROUND_GAP_MS);
      failed = await fetchFulfillmentChunks(failed, map, '(재시도)');
    }
    const missingIds = failed.reduce((acc, c) => acc.concat(c), []);
    console.log(`✅ 물류정보 ${Object.keys(map).length}건 확보` + (missingIds.length ? ` (누락 ${missingIds.length}건)` : ''));
    return { map, missingIds };
  }

  /* ============================================================
     3단계. 발송지연 문구 (待发货 보조, 선택적)
     ============================================================ */
  async function fetchOvertime(orders) {
    const map = {};
    try {
      for (let i = 0; i < orders.length; i += 20) {
        const params = orders.slice(i, i + 20).map(o => ({
          orderId: o.idStr, gmtPayment: o.gmtPayment, status: o.status, entryParamList: []
        }));
        const res = await mtopCall({ params: JSON.stringify(params) },
          'mtop.1688.deliveryLimitTime.listDeliveryLimitTime4OrderList');
        const model = (res.data && (res.data.model || (res.data.data && res.data.data.model))) || [];
        model.forEach(m => {
          const oid = m.orderId || m.orderIdStr || '';
          const texts = [];
          (function scan(v) {
            if (typeof v === 'string' && v.length > 3 && /[超时发货送达]/.test(v) && !/^\d+$/.test(v)) texts.push(v);
            else if (v && typeof v === 'object') Object.values(v).forEach(scan);
          })(m);
          if (oid && texts.length) map[String(oid)] = texts[0];
        });
        await DELAY(200);
      }
    } catch (e) { console.warn('  ⚠️ 발송지연 조회 생략:', e.message); }
    return map;
  }

  /* ============================================================
     물류 요약 → status/detail/carrier/waybill
     ============================================================ */
  function parseProgress(f) {
    let status = '', detail = '';
    const carriers = [], waybills = [];
    (f && f.displayItems || []).forEach(di => {
      (di.progressLines || []).forEach(pl => {
        const segs = pl.segments || [];
        const wbSegs = segs.filter(s => s.semanticType === 'WAYBILL_NO');
        if (wbSegs.length) {
          // 송장 줄: 택배사 + 송장번호 (DOM의 progress-secondary-line 에 해당)
          wbSegs.forEach(s => waybills.push((s.text || '').trim()));
          const cr = segs.filter(s => s.semanticType === 'NORMAL')
            .map(s => (s.text || '').trim()).filter(Boolean).join(' ');
          if (cr) carriers.push(cr);
        } else {
          // 상태 줄: STATUS 세그먼트 + 나머지 상세 (DOM의 progress-line 에 해당)
          const st = segs.find(s => s.semanticType === 'STATUS');
          if (st && !status) status = (st.text || '').trim();
          const rest = segs.filter(s => s !== st)
            .map(s => (s.text || '').trim()).filter(Boolean).join(' ');
          if (rest && !detail) detail = rest.replace(/\s+/g, ' ').trim();
        }
      });
      if (!detail && di.progressText) detail = String(di.progressText).replace(/\s+/g, ' ').trim();
    });
    return { status, detail, carrier: carriers.join(' / '), waybill: waybills.join(' / ') };
  }

  /* ============================================================
     4단계. 행 조립
     ============================================================ */
  function buildRows(tabLabel, orders, fulMap, otMap) {
    orders.forEach(o => {
      if (window._1688_ALL.find(x => x.orderNum === o.idStr)) return;
      const orderStatus = o.statusLabel || '';
      const p = parseProgress(fulMap[o.idStr]);

      let statusLabel, statusDetail;
      if (tabLabel === '待发货') {
        statusLabel = orderStatus;
        statusDetail = p.detail || otMap[o.idStr] || '';
      } else {
        statusLabel = p.status || orderStatus;
        statusDetail = p.detail;
      }

      window._1688_ALL.push({
        tab: tabLabel,
        orderNum: o.idStr,
        dateStr: o.gmtCreate || '',
        orderStatus,
        statusLabel,
        statusDetail,
        carrier: p.carrier,
        waybill: p.waybill
      });
    });
  }

  /* ============================================================
     실행
     ============================================================ */
  try {
    if (!(window.lib && window.lib.mtop)) throw new Error('lib.mtop 없음 — 1688 주문목록 페이지에서 실행하세요');
    const t0 = Date.now();

    const TABS = [
      { tradeStatus: 'waitsellersend',   label: '待发货' },
      { tradeStatus: 'waitbuyerreceive', label: '待收货' }
    ];

    // ── 1단계: 모든 탭의 주문목록 (물류 조회와 분리) ──
    const tabResults = [];
    const missingReport = [];
    for (const tab of TABS) {
      const r = await fetchTabOrders(tab.tradeStatus, tab.label);
      tabResults.push({ ...tab, orders: r.orders });
      if (r.missingPages.length) missingReport.push(`[${tab.label}] 목록 페이지 p${r.missingPages.join(', p')}`);
    }

    // ── 2단계: 전체 주문의 물류 요약 ──
    const allIds = tabResults.reduce((acc, t) => acc.concat(t.orders.map(o => o.idStr)), []);
    const ful = await fetchFulfillment(allIds);
    if (ful.missingIds.length) missingReport.push(`물류정보 ${ful.missingIds.length}건 (${ful.missingIds.slice(0, 5).join(', ')}${ful.missingIds.length > 5 ? ' …' : ''})`);

    // ── 3단계: 待发货 발송지연 문구 ──
    const waitSend = tabResults.find(t => t.tradeStatus === 'waitsellersend');
    const otMap = waitSend ? await fetchOvertime(waitSend.orders) : {};

    // ── 4단계: 행 조립 ──
    tabResults.forEach(t => buildRows(t.label, t.orders, ful.map, otMap));

    // ── 누락 검사: 불완전하면 CSV 를 만들지 않는다 ──
    if (missingReport.length) {
      throw new Error(
        `재시도 후에도 누락이 남아 CSV 를 만들지 않았습니다 (업로드 시 계정 행이 통째로 교체되므로).\n` +
        `  누락: ${missingReport.join(' / ')}\n` +
        `  받은 데이터 ${window._1688_ALL.length}건은 window._1688_ALL 에 있습니다. 잠시 후 스크립트를 다시 실행하세요.`
      );
    }
    window._1688_DONE = true;

    const icons = {
      '待发货': '📋발송대기', '部分已发货': '📦부분발송', '发货超时': '⏰발송지연',
      '已签收': '✅배송완료', '运输中': '🚚운송중', '派送中': '📦배달중',
      '已发货': '📤발송됨', '已揽件': '📬집하완료', '다중택배': '📮다중택배',
      '待收货': '📥수취대기', '物流异常提醒': '⚠️이상'
    };
    const sm = {};
    window._1688_ALL.forEach(o => { sm[o.statusLabel] = (sm[o.statusLabel] || 0) + 1; });
    const wbN = window._1688_ALL.filter(o => o.waybill).length;

    console.log(`\n✅ 전체 완료! 총 ${window._1688_ALL.length}건 (소요 ${Math.round((Date.now() - t0) / 1000)}초)`);
    console.log(`  📋 待发货: ${window._1688_ALL.filter(o => o.tab === '待发货').length}건`);
    console.log(`  📦 待收货: ${window._1688_ALL.filter(o => o.tab === '待收货').length}건`);
    console.log(`  🔖 송장번호 확보: ${wbN}건`);
    Object.entries(sm).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${icons[k] || k || '(없음)'}: ${v}건`));

    /* ---------- CSV (v2와 동일 형식) ---------- */
    let csv = '﻿탭,주문번호,주문일시,주문상태,물류상태,상세내용,택배사,송장번호\n';
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    window._1688_ALL.forEach(o => {
      csv += [
        q(o.tab),
        q('\t' + o.orderNum),
        q(o.dateStr),
        q(o.orderStatus),
        q(o.statusLabel),
        q(o.statusDetail),
        q(o.carrier),
        q(o.waybill ? '\t' + o.waybill : '')
      ].join(',') + '\n';
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `1688_주문현황_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    console.log('📥 CSV 다운로드 완료!');
  } catch (err) {
    console.error('❌ 에러:', err.message, err.stack);
  }
})();
