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
   ============================================================ */

window._1688_ALL = [];
window._1688_DONE = false;

(async () => {
  const DELAY = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- mtop 호출 (재시도 포함) ---------- */
  async function mtopCall(data, api) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await window.lib.mtop.request({
          api: api || 'mtop.1688.trading.dataline.service',
          v: '1.0', ecode: 1, type: 'POST', dataType: 'json',
          data
        });
        const ret = String(res.ret && res.ret[0] || '');
        if (ret.includes('SUCCESS')) return res;
        console.warn(`  ⚠️ mtop 실패(${attempt}회): ${ret} → 재시도`);
      } catch (e) {
        const ret = String((e && (e.ret && e.ret[0] || e.message)) || 'unknown');
        console.warn(`  ⚠️ mtop 예외(${attempt}회): ${ret} → 재시도`);
      }
      await DELAY(1200 * attempt);   // 트래픽 제한(RGV587 등) 대비 백오프
    }
    throw new Error('mtop 호출 4회 실패');
  }

  function parseResult(res) {
    let raw = res.data && res.data.data && res.data.data.result;
    if (raw == null) raw = res.data && res.data.result;
    if (typeof raw === 'string') raw = JSON.parse(raw);
    return raw;
  }

  /* ---------- 1. 주문목록 (100건/페이지) ---------- */
  async function fetchOrderList(tradeStatus, page) {
    const res = await mtopCall({
      serviceId: 'OrderListDataLineService.buyerOrderList',
      param: JSON.stringify({ tradeStatus, page, pageSize: 100 })
    });
    const j = parseResult(res);
    return j.data;   // { data:[...], total, pages, pageSize }
  }

  /* ---------- 2. 물류 요약 (10건 배치, 병렬 3) ---------- */
  async function fetchFulfillment(ids) {
    const map = {};
    const chunks = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    const CONC = 3;
    for (let i = 0; i < chunks.length; i += CONC) {
      const batch = chunks.slice(i, i + CONC);
      const results = await Promise.all(batch.map(chunk =>
        mtopCall({
          serviceId: 'OrderCardDataLineService.batchQueryFulfillmentSummary',
          param: JSON.stringify({ orderIds: chunk })
        }).then(parseResult).catch(e => { console.warn('  ⚠️ 물류배치 실패:', e.message); return null; })
      ));
      results.forEach(raw => {
        const arr = Array.isArray(raw) ? raw : (raw && raw.data) || [];
        arr.forEach(f => { map[f.orderId] = f; });
      });
      await DELAY(250);
    }
    return map;
  }

  /* ---------- 3. 발송지연 문구 (待发货 보조, 선택적) ---------- */
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

  /* ---------- 4. 물류 요약 → status/detail/carrier/waybill ---------- */
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

  /* ---------- 5. 한 탭 크롤링 ---------- */
  async function crawlTab(tradeStatus, tabLabel) {
    console.log(`\n🔄 [${tabLabel}] API 크롤링 시작...`);
    const first = await fetchOrderList(tradeStatus, 1);
    const total = first.total;
    const pages = first.pages || Math.ceil(total / 100);
    console.log(`📄 [${tabLabel}] 총 ${total}건 / ${pages}페이지`);

    let orders = first.data.slice();
    for (let p = 2; p <= pages; p++) {
      const pg = await fetchOrderList(tradeStatus, p);
      orders = orders.concat(pg.data);
      console.log(`  📥 목록 p${p}/${pages} (누적 ${orders.length}건)`);
      await DELAY(300);
    }

    // 중복 제거 (크롤링 중 주문상태 변동으로 페이지가 밀리는 경우 대비)
    const seen = {};
    orders = orders.filter(o => !seen[o.idStr] && (seen[o.idStr] = 1));

    console.log(`  🚚 물류정보 조회 중... (${orders.length}건, 10건씩 배치)`);
    const fulMap = await fetchFulfillment(orders.map(o => o.idStr));
    const otMap = (tradeStatus === 'waitsellersend') ? await fetchOvertime(orders) : {};

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
    console.log(`✅ [${tabLabel}] 완료! 소계: ${window._1688_ALL.filter(x => x.tab === tabLabel).length}건`);
  }

  /* ---------- 6. 실행 ---------- */
  try {
    if (!(window.lib && window.lib.mtop)) throw new Error('lib.mtop 없음 — 1688 주문목록 페이지에서 실행하세요');
    const t0 = Date.now();

    await crawlTab('waitsellersend', '待发货');
    await crawlTab('waitbuyerreceive', '待收货');
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

    /* ---------- 7. CSV (v2와 동일 형식) ---------- */
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