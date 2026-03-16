'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import { useSaveContext } from '../../contexts/SaveContext';
import './BarcodeScan.css';

// ============================================================
// 인터페이스 정의
// ============================================================
interface CoupangUser {
  coupang_name: string;
  googlesheet_id: string;
  user_code?: string;
}

interface OrderData {
  order_number: string;
  product_name: string;
  option_name: string;
  china_option1: string;
  china_option2: string;
  image_url: string;
  import_qty: number;
  cancel_qty: number;
  available_qty: number;
  barcode: string;
  product_size: string;
}

interface ShipmentData {
  box_number: string;
  order_number: string;
  product_name: string;
  option_name: string;
  china_options: string;
  scanned_qty: number;
  barcode: string;
  available_qty: number;
  scan_method?: string;
  scan_time?: string;
  is_error?: boolean;
}

interface ScanSheetData {
  box_number: string;
  order_number: string;
  scanned_qty: number;
  row_index: number;
}

// ============================================================
// 메인 컴포넌트
// ============================================================
const BarcodeScan: React.FC = () => {
  const { hasUnsavedChanges, setHasUnsavedChanges } = useSaveContext();

  // ============================================================
  // Phase 상태: 'select' (사용자 선택) / 'scan' (스캔 화면)
  // ============================================================
  const [phase, setPhase] = useState<'select' | 'scan'>('select');

  // ============================================================
  // 사용자 및 데이터 상태
  // ============================================================
  const [coupangUsers, setCoupangUsers] = useState<CoupangUser[]>([]);
  const [selectedCoupangUser, setSelectedCoupangUser] = useState('');
  const [orderData, setOrderData] = useState<OrderData[]>([]);
  const [currentOrder, setCurrentOrder] = useState<OrderData | null>(null);
  const [scannedQty, setScannedQty] = useState(0);
  const [lastScannedSizeCode, setLastScannedSizeCode] = useState<string | null>(null);
  const [sizeMismatchInfo, setSizeMismatchInfo] = useState<{ boxCode: string; productCode: string } | null>(null);

  // ============================================================
  // 스캔 및 쉽먼트 상태
  // ============================================================
  const [selectedBox, setSelectedBox] = useState('');
  const [shipmentData, setShipmentData] = useState<ShipmentData[]>([]);
  const [scanHistory, setScanHistory] = useState<ShipmentData[]>([]);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);

  // ============================================================
  // UI 상태
  // ============================================================
  const [loading, setLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showAlert, setShowAlert] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // ============================================================
  // Refs
  // ============================================================
  const boxInputRef = useRef<HTMLInputElement>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // 1) 쿠팡 사용자 목록 로드
  // ============================================================
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch('/api/get-coupang-users');
        const result = await res.json();
        if (result.success && result.data) setCoupangUsers(result.data);
      } catch (err) {
        console.error('사용자 목록 로드 오류:', err);
      }
    };
    fetchUsers();
  }, []);

  // ============================================================
  // 2) 페이지 이탈 방지
  // ============================================================
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // ============================================================
  // 3) 소리 재생 함수
  // ============================================================
  const playSuccessSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc1 = ctx.createOscillator(); const g1 = ctx.createGain();
      osc1.connect(g1); g1.connect(ctx.destination);
      osc1.frequency.setValueAtTime(1200, ctx.currentTime); osc1.type = 'sine';
      g1.gain.setValueAtTime(0.5, ctx.currentTime);
      g1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc1.start(ctx.currentTime); osc1.stop(ctx.currentTime + 0.1);
      const osc2 = ctx.createOscillator(); const g2 = ctx.createGain();
      osc2.connect(g2); g2.connect(ctx.destination);
      osc2.frequency.setValueAtTime(1400, ctx.currentTime + 0.15); osc2.type = 'sine';
      g2.gain.setValueAtTime(0.5, ctx.currentTime + 0.15);
      g2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc2.start(ctx.currentTime + 0.15); osc2.stop(ctx.currentTime + 0.25);
    } catch {}
  }, []);

  const playErrorSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const mk = (freq: number, start: number, dur: number) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.setValueAtTime(freq, ctx.currentTime + start); o.type = 'square';
        g.gain.setValueAtTime(0.7, ctx.currentTime + start);
        g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur);
        o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur);
      };
      mk(1000, 0, 0.15); mk(600, 0.2, 0.15); mk(1000, 0.4, 0.15);
    } catch {}
  }, []);

  // ============================================================
  // 4) 유틸리티 함수 (export-product와 동일)
  // ============================================================
  const normalizeBarcodeToOrderNumber = (barcode: string): string => {
    const parts = barcode.trim().split('-');
    return parts.length > 3 ? parts.slice(0, 3).join('-') : barcode.trim();
  };

  const getSizeCodeFromProductSize = (ps: string | null | undefined): string | null => {
    if (!ps?.trim()) return 'X';
    const s = ps.trim().toLowerCase();
    if (s.includes('small')) return 'A';
    if (s.includes('medium')) return 'B';
    if (s.includes('large')) return 'C';
    if (s.includes('p-')) return 'P';
    return 'X';
  };

  const getSizeCodeFromBoxNumber = (box: string): string | null => {
    if (!box) return null;
    const parts = box.trim().split('-');
    if (parts.length < 3) return null;
    const code = parts[1].toUpperCase();
    return ['A', 'B', 'C', 'P', 'X'].includes(code) ? code : null;
  };

  const findOrderByNumber = useCallback((orderNumber: string) => {
    const normalized = normalizeBarcodeToOrderNumber(orderNumber);
    return orderData.find(o => o.order_number === normalized);
  }, [orderData]);

  // ============================================================
  // 5) 사용자 선택 → 데이터 로딩
  // ============================================================
  const handleUserSelect = useCallback(async (userName: string) => {
    const user = coupangUsers.find(u => u.coupang_name === userName);
    if (!user?.googlesheet_id) return;

    setSelectedCoupangUser(userName);
    setLoading(true);

    try {
      // 주문 데이터 로드
      const orderRes = await fetch(
        `/api/load-google-sheet-optimized?googlesheet_id=${user.googlesheet_id}&coupang_name=${encodeURIComponent(userName)}&cache=false`,
        { cache: 'no-store' }
      );
      const orderResult = await orderRes.json();

      if (!orderRes.ok || !orderResult.success) {
        setAlertMessage(orderResult.error || '데이터 로드 실패');
        setShowAlert(true); setTimeout(() => setShowAlert(false), 3000);
        return;
      }

      // 주문 데이터 변환
      const dataArray = Array.isArray(orderResult.data) ? orderResult.data : Object.values(orderResult.data);
      const isSetProduct = (n: string) => { const p = n.split('-'); return p.length >= 4 && /^S\d{2}$/.test(p[p.length - 1].toUpperCase()); };
      const normalizeOrderNum = (n: string) => { const p = n.split('-'); return p.length > 3 ? p.slice(0, 3).join('-') : n; };

      const raw = dataArray.map((item: any) => ({
        order_number: item.order_number || '',
        product_name: item.product_name || '',
        option_name: item.product_name_sub || '',
        china_option1: item.china_option1 || '',
        china_option2: item.china_option2 || '',
        image_url: item.img_url || '',
        import_qty: parseInt(item.import_qty) || 0,
        cancel_qty: parseInt(item.cancel_qty) || 0,
        available_qty: parseInt(item.import_qty) || 0,
        barcode: item.barcode || '',
        product_size: item.product_size || '',
      })).filter((i: any) => i.order_number.trim() !== '');

      // 세트상품 처리
      const groups = new Map<string, any[]>();
      raw.forEach((item: any) => {
        const n = normalizeOrderNum(item.order_number);
        if (!groups.has(n)) groups.set(n, []);
        groups.get(n)!.push(item);
      });

      const processed: OrderData[] = [];
      groups.forEach((items, normalizedOrderNum) => {
        const setItems = items.filter((i: any) => isSetProduct(i.order_number));
        if (setItems.length > 1) {
          const minQty = Math.min(...setItems.map((i: any) => i.import_qty));
          processed.push({ ...setItems[0], order_number: normalizedOrderNum, import_qty: minQty, cancel_qty: 0, available_qty: minQty });
        } else {
          items.forEach((i: any) => processed.push({ ...i, order_number: normalizedOrderNum }));
        }
      });

      setOrderData(processed);

      // 스캔 시트 로드
      const scanRes = await fetch(`/api/load-scan-data?googlesheet_id=${user.googlesheet_id}`, { cache: 'no-store' });
      const scanResult = await scanRes.json();

      if (scanRes.ok && scanResult.success && scanResult.data) {
        const matched = (scanResult.data as ScanSheetData[]).map(s => {
          const order = processed.find(o => o.order_number === s.order_number);
          return {
            box_number: s.box_number, order_number: s.order_number,
            product_name: order?.product_name || '(주문 정보 없음)', option_name: order?.option_name || '',
            china_options: order ? `${order.china_option1} ${order.china_option2}`.trim() : '',
            scanned_qty: s.scanned_qty, barcode: order?.barcode || '', available_qty: order?.available_qty || 0,
          };
        }).sort((a, b) => a.box_number.localeCompare(b.box_number));
        setShipmentData(matched);
      }

      setHasUnsavedChanges(false);
      setPhase('scan');

      // 박스 입력에 포커스
      setTimeout(() => boxInputRef.current?.focus(), 100);

    } catch (err) {
      console.error('데이터 로드 오류:', err);
      setAlertMessage('데이터 로드 중 오류 발생');
      setShowAlert(true); setTimeout(() => setShowAlert(false), 3000);
    } finally {
      setLoading(false);
    }
  }, [coupangUsers, setHasUnsavedChanges]);

  // ============================================================
  // 6) 박스 스캔 → 주문번호 입력 활성화
  // ============================================================
  const handleBoxScan = useCallback((value: string) => {
    const box = value.replace(/\s/g, '').toUpperCase();
    setSelectedBox(box);
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
  }, []);

  // ============================================================
  // 7) 바코드 스캔 처리 (export-product processScan과 동일 로직)
  // ============================================================
  const processScan = useCallback((orderNumber: string, quantity: number) => {
    const normalized = normalizeBarcodeToOrderNumber(orderNumber);
    const found = findOrderByNumber(orderNumber);
    const scanTime = new Date().toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    // ── 에러 1: 주문 없음 ──
    if (!found) {
      playErrorSound();
      setAlertMessage('해당 주문번호를 찾을 수 없습니다.');
      setShowAlert(true); setTimeout(() => setShowAlert(false), 2000);
      setCurrentOrder(null); setLastScannedSizeCode(null);
      setScanHistory(prev => [...prev, {
        box_number: selectedBox, order_number: normalized,
        product_name: '주문번호를 찾을 수 없음', option_name: '', china_options: '',
        scanned_qty: quantity, barcode: '', available_qty: 0,
        scan_method: '스캔', scan_time: scanTime, is_error: true,
      }]);
      return;
    }

    // ── 에러 2: 사이즈 불일치 ──
    const boxSize = getSizeCodeFromBoxNumber(selectedBox);
    const productSize = getSizeCodeFromProductSize(found.product_size);
    if (boxSize && productSize && boxSize !== productSize) {
      playErrorSound();
      setCurrentOrder(null); setLastScannedSizeCode(null);
      setSizeMismatchInfo({ boxCode: boxSize, productCode: productSize });
      setTimeout(() => setSizeMismatchInfo(null), 5000);
      setScanHistory(prev => [...prev, {
        box_number: selectedBox, order_number: normalized,
        product_name: `${found.product_name} [사이즈 불일치: 박스=${boxSize}, 상품=${productSize}]`,
        option_name: found.option_name,
        china_options: `${found.china_option1} ${found.china_option2}`.trim(),
        scanned_qty: quantity, barcode: found.barcode, available_qty: found.available_qty,
        scan_method: '스캔', scan_time: scanTime, is_error: true,
      }]);
      return;
    }

    // ── 에러 3: 수량 초과 ──
    const existing = shipmentData
      .filter(i => i.order_number === normalized)
      .reduce((s, i) => s + i.scanned_qty, 0);
    const newTotal = existing + quantity;

    if (newTotal > found.available_qty) {
      playErrorSound();
      setCurrentOrder(found); setScannedQty(newTotal);
      setLastScannedSizeCode(getSizeCodeFromProductSize(found.product_size));
      setScanHistory(prev => [...prev, {
        box_number: selectedBox, order_number: normalized,
        product_name: found.product_name, option_name: found.option_name,
        china_options: `${found.china_option1} ${found.china_option2}`.trim(),
        scanned_qty: quantity, barcode: found.barcode, available_qty: found.available_qty,
        scan_method: '스캔', scan_time: scanTime, is_error: true,
      }]);
      return;
    }

    // ── 성공 ──
    playSuccessSound();
    setCurrentOrder(found);
    setScannedQty(newTotal);
    setLastScannedSizeCode(getSizeCodeFromProductSize(found.product_size));

    setShipmentData(prev => {
      const idx = prev.findIndex(i => i.box_number === selectedBox && i.order_number === normalized);
      let updated;
      if (idx >= 0) {
        updated = [...prev];
        updated[idx] = { ...updated[idx], scanned_qty: updated[idx].scanned_qty + quantity };
      } else {
        updated = [...prev, {
          box_number: selectedBox, order_number: normalized,
          product_name: found.product_name, option_name: found.option_name,
          china_options: `${found.china_option1} ${found.china_option2}`.trim(),
          scanned_qty: quantity, barcode: found.barcode, available_qty: found.available_qty,
        }];
      }
      setHasUnsavedChanges(true);
      return updated.sort((a, b) => a.box_number.localeCompare(b.box_number));
    });

    setScanHistory(prev => [...prev, {
      box_number: selectedBox, order_number: normalized,
      product_name: found.product_name, option_name: found.option_name,
      china_options: `${found.china_option1} ${found.china_option2}`.trim(),
      scanned_qty: quantity, barcode: found.barcode, available_qty: found.available_qty,
      scan_method: '스캔', scan_time: scanTime,
    }]);
  }, [selectedBox, findOrderByNumber, shipmentData, playSuccessSound, playErrorSound, setHasUnsavedChanges]);

  // ============================================================
  // 8) 저장 함수 (구글 시트)
  // ============================================================
  const saveAllData = useCallback(async () => {
    if (!selectedCoupangUser) {
      setAlertMessage('사용자를 선택해주세요.'); setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000); return;
    }
    if (shipmentData.length === 0) {
      setAlertMessage('저장할 스캔 데이터가 없습니다.'); setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000); return;
    }

    const user = coupangUsers.find(u => u.coupang_name === selectedCoupangUser);
    if (!user?.googlesheet_id) return;

    try {
      setLoading(true);
      const res = await fetch('/api/save-scan-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googlesheet_id: user.googlesheet_id,
          scan_data: shipmentData.map(i => ({
            box_number: i.box_number, order_number: i.order_number,
            barcode: i.barcode, product_name: i.product_name,
            option_name: i.option_name, scanned_qty: i.scanned_qty,
            available_qty: i.available_qty,
          })),
        }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setAlertMessage(`저장 완료! ${shipmentData.length}개 데이터 저장됨`);
        setShowAlert(true); setTimeout(() => setShowAlert(false), 3000);
        setHasUnsavedChanges(false);
      } else {
        setAlertMessage(result.error || '저장 실패');
        setShowAlert(true); setTimeout(() => setShowAlert(false), 3000);
      }
    } catch (err) {
      setAlertMessage('저장 중 오류 발생');
      setShowAlert(true); setTimeout(() => setShowAlert(false), 3000);
    } finally {
      setLoading(false);
    }
  }, [selectedCoupangUser, coupangUsers, shipmentData, setHasUnsavedChanges]);

  // ============================================================
  // 9) 기록 패널 함수
  // ============================================================
  const handleSelectItem = (index: number) => {
    const next = new Set(selectedItems);
    next.has(index) ? next.delete(index) : next.add(index);
    setSelectedItems(next);
  };

  const handleSelectAll = () => {
    setSelectedItems(selectedItems.size === shipmentData.length ? new Set() : new Set(shipmentData.map((_, i) => i)));
  };

  const handleDeleteSelected = () => {
    setShipmentData(prev => prev.filter((_, i) => !selectedItems.has(i)));
    setSelectedItems(new Set());
    setHasUnsavedChanges(true);
  };

  const handleQtyClick = (index: number) => {
    setEditingIndex(index);
    setEditingValue(String(shipmentData[index].scanned_qty));
  };

  const handleQtyBlur = () => {
    if (editingIndex !== null) {
      const val = parseInt(editingValue) || 0;
      if (val > 0) {
        const updated = [...shipmentData];
        updated[editingIndex] = { ...updated[editingIndex], scanned_qty: val };
        setShipmentData(updated);
        setHasUnsavedChanges(true);
      }
    }
    setEditingIndex(null);
  };

  const handleQtyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleQtyBlur();
    if (e.key === 'Escape') setEditingIndex(null);
  };

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="bs-layout">
      <TopsideMenu />

      {/* ── 알림 메시지 ── */}
      {showAlert && (
        <div className="bs-alert">{alertMessage}</div>
      )}

      {/* ============================================================ */}
      {/* Phase 1: 사용자 선택 화면 */}
      {/* ============================================================ */}
      {phase === 'select' && (
        <div className="bs-select-screen">
          <h1 className="bs-select-title">请选择一家营业厅。</h1>
          <div className="bs-select-buttons">
            {coupangUsers.map(user => (
              <button
                key={user.coupang_name}
                className="bs-select-btn"
                onClick={() => handleUserSelect(user.coupang_name)}
                disabled={loading}
              >
                {loading && selectedCoupangUser === user.coupang_name ? '로딩 중...' : (
                  user.user_code ? `${user.user_code} ${user.coupang_name}` : user.coupang_name
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Phase 2: 스캔 화면 */}
      {/* ============================================================ */}
      {phase === 'scan' && (
        <div className="bs-scan-screen">
          {/* ── 상단: 박스 + 주문번호 입력폼 ── */}
          <div className="bs-input-section">
            <input
              ref={boxInputRef}
              type="text"
              placeholder="박스를 스캔해주세요"
              className="bs-box-input"
              value={selectedBox}
              onChange={e => setSelectedBox(e.target.value.replace(/\s/g, '').toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (selectedBox.trim()) barcodeInputRef.current?.focus();
                }
              }}
            />
            <input
              ref={barcodeInputRef}
              type="text"
              placeholder="주문번호를 입력해주세요"
              className="bs-barcode-input"
              disabled={!selectedBox}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) {
                    processScan(val, 1);
                    (e.target as HTMLInputElement).value = '';
                  }
                }
              }}
            />
          </div>

          {/* ── 스캔 결과 카드 ── */}
          <div className="bs-result-card">
            {currentOrder ? (
              <div className="bs-order-display">
                {/* 이미지 */}
                <div className="bs-order-image">
                  {currentOrder.image_url && (
                    <img
                      src={`/api/image-proxy?url=${encodeURIComponent(currentOrder.image_url)}`}
                      alt="상품"
                      onError={e => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                    />
                  )}
                </div>
                {/* 주문 정보 */}
                <div className="bs-order-info">
                  <div className="bs-order-number">{currentOrder.order_number}</div>
                  <div className="bs-order-name">{currentOrder.product_name}</div>
                  <div className="bs-order-options">
                    {currentOrder.china_option1} {currentOrder.china_option2}
                  </div>
                </div>
                {/* 수량 */}
                <div className="bs-order-qty">
                  <div className={`bs-qty-circle ${
                    scannedQty >= currentOrder.available_qty && scannedQty > 0
                      ? (scannedQty === currentOrder.available_qty ? 'completed' : 'exceeded')
                      : scannedQty > 0 ? 'scanned' : 'default'
                  }`}>
                    {scannedQty}/{currentOrder.available_qty}
                  </div>
                  {lastScannedSizeCode && (
                    <div className={`bs-size-code bs-size-${lastScannedSizeCode.toLowerCase()}`}>
                      {lastScannedSizeCode}
                    </div>
                  )}
                </div>
              </div>
            ) : sizeMismatchInfo ? (
              <div className="bs-mismatch-warning">
                <div className="bs-mismatch-title">사이즈 코드 불일치!</div>
                <div className="bs-mismatch-detail">
                  박스: <strong>{sizeMismatchInfo.boxCode}</strong> / 상품: <strong>{sizeMismatchInfo.productCode}</strong>
                </div>
              </div>
            ) : (
              <div className="bs-empty-card">
                {selectedBox ? (
                  <p>박스 <strong>{selectedBox}</strong> 선택됨 — 바코드를 스캔하세요</p>
                ) : (
                  <p>박스를 먼저 스캔해주세요</p>
                )}
                {orderData.length > 0 && (
                  <p className="bs-data-count">로드된 주문: {orderData.length}개</p>
                )}
              </div>
            )}
          </div>

          {/* ── 버튼 영역: [기록] [저장] ── */}
          <div className="bs-action-buttons">
            <button
              className="bs-action-btn bs-record-btn"
              onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
            >
              기록
            </button>
            <button
              className={`bs-action-btn bs-save-btn ${hasUnsavedChanges ? 'has-changes' : ''}`}
              onClick={saveAllData}
              disabled={loading}
            >
              {loading ? '저장 중...' : `저장${hasUnsavedChanges ? ' !' : ''}`}
            </button>
          </div>

          {/* ── 기록 패널 (슬라이드) ── */}
          <div className={`bs-history-panel ${isHistoryPanelOpen ? 'open' : ''}`}>
            <div className="bs-history-header">
              <h3>쉽먼트</h3>
              <button className="bs-history-close" onClick={() => setIsHistoryPanelOpen(false)}>✕</button>
            </div>
            <div className="bs-history-content">
              <div className="bs-history-toolbar">
                <button
                  className="bs-delete-btn"
                  onClick={handleDeleteSelected}
                  disabled={selectedItems.size === 0}
                >
                  삭제 ({selectedItems.size})
                </button>
              </div>
              <table className="bs-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input type="checkbox"
                        checked={shipmentData.length > 0 && selectedItems.size === shipmentData.length}
                        onChange={handleSelectAll}
                        disabled={shipmentData.length === 0}
                      />
                    </th>
                    <th>박스</th>
                    <th>주문번호</th>
                    <th>상품명</th>
                    <th style={{ width: 60 }}>출고</th>
                    <th style={{ width: 60 }}>입고</th>
                  </tr>
                </thead>
                <tbody>
                  {shipmentData.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: '#999' }}>데이터 없음</td></tr>
                  ) : (
                    [...shipmentData].reverse().map((item, di) => {
                      const oi = shipmentData.length - 1 - di;
                      return (
                        <tr key={oi}>
                          <td><input type="checkbox" checked={selectedItems.has(oi)} onChange={() => handleSelectItem(oi)} /></td>
                          <td>{item.box_number}</td>
                          <td>{item.order_number}</td>
                          <td>{item.product_name}</td>
                          <td onClick={() => handleQtyClick(oi)} style={{ cursor: 'pointer' }}>
                            {editingIndex === oi ? (
                              <input type="number" value={editingValue} onChange={e => setEditingValue(e.target.value)}
                                onBlur={handleQtyBlur} onKeyDown={handleQtyKeyDown} autoFocus className="bs-qty-edit" />
                            ) : item.scanned_qty}
                          </td>
                          <td>{item.available_qty}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BarcodeScan;
