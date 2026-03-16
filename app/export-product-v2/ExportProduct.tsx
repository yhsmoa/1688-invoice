'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useSaveContext } from '../../contexts/SaveContext';
import { useFtUsers, type FtOrderItem } from '../import-product-v2/hooks/useFtData';
import './ExportProduct.css';

// ============================================================
// 타입 정의
// ============================================================
interface CoupangUser {
  coupang_name: string;
  googlesheet_id: string;
  user_code?: string;
}

/** ft_order_items 기반 출고 준비 데이터 */
interface ExportOrderItem extends FtOrderItem {
  available_qty: number; // ARRIVAL - PACKED - CANCEL
  packed_qty: number;    // DB에 저장된 PACKED 합계
  size_code: string;     // A(Small) | B(Medium) | C(Large) | P(Personal) | X(Direct/null)
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
  scan_method?: '스캔' | '입력';
  scan_time?: string;
  is_error?: boolean;
}

interface ScanSheetData {
  box_number: string;
  order_number: string;
  scanned_qty: number;
  row_index: number;
}

/** ft_box_info 박스 정보 */
interface BoxInfo {
  id: string;
  box_code: string;
  type: string;
  no: string;
  size: string;
  status: string;
  user_code: string;
}

const OPERATOR_OPTIONS = ['소현', '장뢰', '3'];

// ============================================================
// 한글 키보드 → 영문 대문자 변환 맵
// ============================================================
const KO_TO_EN: Record<string, string> = {
  'ㅂ':'Q','ㅈ':'W','ㄷ':'E','ㄱ':'R','ㅅ':'T','ㅛ':'Y','ㅕ':'U','ㅑ':'I','ㅐ':'O','ㅔ':'P',
  'ㅁ':'A','ㄴ':'S','ㅇ':'D','ㄹ':'F','ㅎ':'G','ㅗ':'H','ㅓ':'J','ㅏ':'K','ㅣ':'L',
  'ㅋ':'Z','ㅌ':'X','ㅊ':'C','ㅍ':'V','ㅠ':'B','ㅜ':'N','ㅡ':'M',
  'ㅃ':'Q','ㅉ':'W','ㄸ':'E','ㄲ':'R','ㅆ':'T','ㅒ':'O','ㅖ':'P',
};
/** 한글 포함 문자열 → 영문 대문자로 변환 */
const toEnglishUpper = (str: string): string =>
  str.split('').map((ch) => KO_TO_EN[ch] || ch).join('').toUpperCase();

const ExportProduct: React.FC = () => {
  const { t } = useTranslation();
  const { hasUnsavedChanges, setHasUnsavedChanges } = useSaveContext();

  const [barcodeInput, setBarcodeInput] = useState('');
  const [quantityInput, setQuantityInput] = useState('');
  // ── 박스번호: user_code (박스생성 모달에서 사업자코드로 사용) ──
  const [boxPrefix, setBoxPrefix] = useState('');   // ft_users.user_code 자동입력

  const [selectedSize, setSelectedSize] = useState('');
  const [selectedCoupangUser, setSelectedCoupangUser] = useState<string>('');
  const [selectedFtUserId, setSelectedFtUserId] = useState<string>('');
  const [customBoxSize, setCustomBoxSize] = useState<string>('');
  const [selectedPresetSize, setSelectedPresetSize] = useState<string>('');
  const [isResultBoardActive, setIsResultBoardActive] = useState(false); // 스캔결과 보드 활성화 상태
  const [isInputFormActive, setIsInputFormActive] = useState(false); // 입력폼 보드 활성화 상태
  const [boardBarcodeInput, setBoardBarcodeInput] = useState(''); // 보드용 바코드 입력
  const [isSheetLoaded, setIsSheetLoaded] = useState(false); // 시트 불러오기 완료 여부
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false); // 기록 패널 열림 상태
  const [scanHistory, setScanHistory] = useState<ShipmentData[]>([]); // 스캔 기록 (시트 불러온 후 스캔한 것만)

  // ============================================================
  // 단건 스캔 결과 (ft_order_items 기반)
  // ============================================================
  const [currentExportItem, setCurrentExportItem] = useState<ExportOrderItem | null>(null);
  const [lastScanSuccess, setLastScanSuccess] = useState<boolean | null>(null); // true=성공, false=실패, null=초기

  // 디버깅: 상태 변경 추적
  useEffect(() => {
    console.log('결과보드 활성화 상태:', isResultBoardActive);
  }, [isResultBoardActive]);

  // Ref for barcode input
  const barcodeInputRef = React.useRef<HTMLInputElement>(null);
  const quantityInputRef = React.useRef<HTMLInputElement>(null);
  const boardBarcodeInputRef = React.useRef<HTMLInputElement>(null);

  // 기본 상태
  const [loading, setLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showAlert, setShowAlert] = useState(false);

  // 담당자 드롭박스
  const [selectedOperator, setSelectedOperator] = useState('');

  // P=X 모드: 체크 시 P/X 상호 허용 (타입 불일치 무시)
  const [isPxEqual, setIsPxEqual] = useState(false);
  // A=B=C=P=X 모드: 모든 타입 상호 허용
  const [isAllEqual, setIsAllEqual] = useState(false);

  // ── 박스 관리 상태 ──
  const [showBoxCreateModal, setShowBoxCreateModal] = useState(false);
  const [showBoxSelectModal, setShowBoxSelectModal] = useState(false);
  const [activeBoxInfo, setActiveBoxInfo] = useState<BoxInfo | null>(null);
  const [boxCreateType, setBoxCreateType] = useState('');
  const [boxCreateNo, setBoxCreateNo] = useState('');
  const [boxCreateSize, setBoxCreateSize] = useState('');
  const [availableBoxes, setAvailableBoxes] = useState<BoxInfo[]>([]);

  // ── selectedBox: activeBoxInfo의 box_code ──
  const selectedBox = activeBoxInfo?.box_code || '';

  // 타입 선택 (A/B/C/P/X)
  const [selectedType, setSelectedType] = useState('');

  // ft_users (V2 전용)
  const { users: ftUsers } = useFtUsers();

  // ============================================================
  // ft_order_items(PROCESSING) + fulfillment 기반 출고 준비 데이터
  // ============================================================
  const [exportItems, setExportItems] = useState<ExportOrderItem[]>([]);
  const [ftDataLoading, setFtDataLoading] = useState(false);

  /** 드롭박스 선택 시 ft_order_items + fulfillment 데이터 로드 */
  const fetchExportData = useCallback(async (userId: string) => {
    if (!userId) {
      setExportItems([]);
      return;
    }
    setFtDataLoading(true);
    try {
      // 1) ft_order_items (PROCESSING)
      const itemsRes = await fetch(`/api/ft/order-items?user_id=${userId}&status=PROCESSING`);
      const itemsJson = await itemsRes.json();
      if (!itemsJson.success) throw new Error(itemsJson.error);
      const items: FtOrderItem[] = itemsJson.data || [];

      if (items.length === 0) {
        setExportItems([]);
        return;
      }

      // 2) fulfillment 집계 (배치 POST)
      const orderItemIds = items.map((i) => i.id);
      const ffRes = await fetch('/api/ft/fulfillments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_item_ids: orderItemIds }),
      });
      const ffJson = await ffRes.json();
      const ffRows: { order_item_id: string; quantity: number; type: string }[] =
        ffJson.success ? ffJson.data || [] : [];

      // 타입별 합계 맵 생성
      const arrivalMap = new Map<string, number>();
      const packedMap = new Map<string, number>();
      const cancelMap = new Map<string, number>();
      ffRows.forEach((r) => {
        const map =
          r.type === 'ARRIVAL' ? arrivalMap : r.type === 'PACKED' ? packedMap : r.type === 'CANCEL' ? cancelMap : null;
        if (map) map.set(r.order_item_id, (map.get(r.order_item_id) ?? 0) + r.quantity);
      });

      // 3) available_qty 계산 및 0 이하 필터
      const withQty = items
        .map((item) => {
          const arrival = arrivalMap.get(item.id) ?? 0;
          const packed = packedMap.get(item.id) ?? 0;
          const cancel = cancelMap.get(item.id) ?? 0;
          return { ...item, available_qty: arrival - packed - cancel, packed_qty: packed, size_code: 'X' };
        })
        .filter((item) => item.available_qty > 0);

      // 4) shipment_type 별 사이즈 코드 결정
      //    COUPANG → ft_cp_item + ft_cp_shipment_size 조인으로 A/B/C
      //    PERSONAL → P
      //    Direct / null → X
      const coupangItems = withQty.filter((i) => i.shipment_type === 'COUPANG' && i.barcode);
      const coupangBarcodes = [...new Set(coupangItems.map((i) => i.barcode!))];

      let barcodeSizeMap: Record<string, string | null> = {};
      if (coupangBarcodes.length > 0) {
        try {
          const sizeRes = await fetch('/api/ft/shipment-size', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barcodes: coupangBarcodes }),
          });
          const sizeJson = await sizeRes.json();
          if (sizeJson.success) barcodeSizeMap = sizeJson.data || {};
        } catch (sizeErr) {
          console.error('shipment-size 조회 오류:', sizeErr);
        }
      }

      // 5) size_code 병합
      const result: ExportOrderItem[] = withQty.map((item) => {
        let sizeCode = 'X'; // 기본값: Direct / null
        if (item.shipment_type === 'COUPANG') {
          sizeCode = (item.barcode && barcodeSizeMap[item.barcode]) || 'X';
        } else if (item.shipment_type === 'PERSONAL') {
          sizeCode = 'P';
        }
        return { ...item, size_code: sizeCode };
      });

      setExportItems(result);
      console.log(`출고 준비 데이터: ${result.length}개 (전체 ${items.length}개 중 available > 0)`);
    } catch (err) {
      console.error('출고 데이터 로드 오류:', err);
      setExportItems([]);
    } finally {
      setFtDataLoading(false);
    }
  }, []);

  // 쿠팡 사용자 목록
  const [coupangUsers, setCoupangUsers] = useState<CoupangUser[]>([]);

  // 주문 데이터
  const [orderData, setOrderData] = useState<OrderData[]>([]);

  // 쉽먼트 데이터
  const [shipmentData, setShipmentData] = useState<ShipmentData[]>([]);

  // 체크박스 선택 상태
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  // 테이블 개수 수정 상태
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  // 쿠팡 사용자 목록 가져오기
  const fetchCoupangUsers = async () => {
    try {
      const response = await fetch('/api/get-coupang-users');
      const result = await response.json();

      if (result.success && result.data) {
        setCoupangUsers(result.data);
      }
    } catch (error) {
      console.error('쿠팡 사용자 목록 가져오기 오류:', error);
    }
  };

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    fetchCoupangUsers();
  }, []);

  // 페이지 이탈 방지 (브라우저 닫기, 새로고침)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Chrome에서 필요
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  // 드롭다운 변경 시 저장 확인
  const handleCoupangUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('저장하시겠습니까？\n你想保存吗？');
      if (confirmed) {
        saveAllData().then(() => {
          setSelectedCoupangUser(e.target.value);
        });
        return;
      }
      // 취소하면 변경사항 버리고 진행
      setHasUnsavedChanges(false);
    }
    setSelectedCoupangUser(e.target.value);
  };

  // 전역 클릭 이벤트로 보드 비활성화
  useEffect(() => {
    const handleGlobalClick = () => {
      setIsResultBoardActive(false);
      setIsInputFormActive(false);
    };

    document.addEventListener('mousedown', handleGlobalClick);

    return () => {
      document.removeEventListener('mousedown', handleGlobalClick);
    };
  }, []);

  // 스캔 시트 데이터와 주문 데이터를 매칭하는 함수
  const matchScanDataWithOrders = (scanData: ScanSheetData[], orderData: OrderData[]): ShipmentData[] => {
    return scanData.map(scanItem => {
      // 주문번호로 주문 데이터 찾기
      const matchedOrder = orderData.find(order => order.order_number === scanItem.order_number);

      if (matchedOrder) {
        return {
          box_number: scanItem.box_number,
          order_number: scanItem.order_number,
          product_name: matchedOrder.product_name,
          option_name: matchedOrder.option_name,
          china_options: [matchedOrder.china_option1, matchedOrder.china_option2].filter(Boolean).join(', '),
          scanned_qty: scanItem.scanned_qty,
          barcode: matchedOrder.barcode,
          available_qty: matchedOrder.available_qty
        };
      } else {
        // 매칭되는 주문이 없는 경우 기본값 설정
        return {
          box_number: scanItem.box_number,
          order_number: scanItem.order_number,
          product_name: '(주문 정보 없음)',
          option_name: '',
          china_options: '(주문 정보 없음)',
          scanned_qty: scanItem.scanned_qty,
          barcode: '',
          available_qty: 0
        };
      }
    });
  };

  // 시트 불러오기 함수
  const handleLoadGoogleSheet = async () => {
    // 저장하지 않은 변경사항이 있는지 확인
    if (hasUnsavedChanges) {
      const confirmSave = window.confirm('저장되지 않은 변경사항이 있습니다. 저장하시겠습니까?');
      if (confirmSave) {
        await saveAllData();
        return; // 저장 후 함수 종료 (저장 완료 후 다시 시트 불러오기를 수동으로 해야 함)
      }
      // 저장하지 않고 계속 진행
      setHasUnsavedChanges(false);
    }

    // 시트 불러오기 전 모든 상태 초기화
    setShipmentData([]);
    setScanHistory([]); // 스캔 기록 초기화
    setCurrentExportItem(null);
    setLastScanSuccess(null);
    setBarcodeInput('');
    setQuantityInput('');
    setBoardBarcodeInput('');

    if (!selectedCoupangUser) {
      setAlertMessage('쿠팡 사용자를 선택해주세요.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser || !selectedUser.googlesheet_id) {
      setAlertMessage('선택한 사용자의 구글 시트 ID를 찾을 수 없습니다.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    try {
      setLoading(true);

      // 1. 진행 시트에서 주문 데이터 로드
      const orderResponse = await fetch(`/api/load-google-sheet-optimized?googlesheet_id=${selectedUser.googlesheet_id}&coupang_name=${encodeURIComponent(selectedCoupangUser)}&cache=false`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });

      const orderResult = await orderResponse.json();

      console.log('주문 데이터 API 응답:', orderResult);

      if (!orderResponse.ok || !orderResult.success) {
        const errorMessage = orderResult.error || '진행 시트 데이터를 불러오는데 실패했습니다.';
        console.error('주문 시트 로드 오류:', errorMessage);
        setAlertMessage(errorMessage);
        setShowAlert(true);
        setTimeout(() => setShowAlert(false), 3000);
        return;
      }

      // 주문 데이터 변환
      const dataArray = Array.isArray(orderResult.data) ? orderResult.data : Object.values(orderResult.data);
      const rawTransformed = dataArray.map((item: any) => ({
        order_number: item.order_number || '',
        product_name: item.product_name || '',
        option_name: item.product_name_sub || '',
        china_option1: item.china_option1 || '',
        china_option2: item.china_option2 || '',
        image_url: item.img_url || '',
        import_qty: parseInt(item.import_qty) || 0,
        cancel_qty: parseInt(item.cancel_qty) || 0,
        available_qty: parseInt(item.import_qty) || 0, // 입고개수만 사용 (취소개수 무시)
        barcode: item.barcode || '', // F열 바코드 추가
        product_size: item.product_size || '' // V열 분류상자코드 추가
      }));

      // 빈 주문번호 제외
      const filteredData = rawTransformed.filter((item: any) => {
        const orderNum = item.order_number.trim();
        return orderNum !== '';
      });

      // 세트상품 처리: 정규화된 주문번호로 그룹핑 후 최소 수량 계산
      // 세트상품 패턴: -S21, -S22, -S31, -S32, ... (마지막이 -Sxx 형태)
      const isSetProduct = (orderNum: string): boolean => {
        const parts = orderNum.split('-');
        if (parts.length >= 4) {
          const lastPart = parts[parts.length - 1].toUpperCase();
          return /^S\d{2}$/.test(lastPart); // S21, S22, S31 등
        }
        return false;
      };

      // 정규화 함수 (로컬)
      const normalizeOrderNum = (orderNum: string): string => {
        const parts = orderNum.split('-');
        if (parts.length > 3) {
          return parts.slice(0, 3).join('-');
        }
        return orderNum;
      };

      // 주문번호별 그룹핑
      const orderGroups = new Map<string, any[]>();
      filteredData.forEach((item: any) => {
        const normalized = normalizeOrderNum(item.order_number);
        if (!orderGroups.has(normalized)) {
          orderGroups.set(normalized, []);
        }
        orderGroups.get(normalized)!.push(item);
      });

      // 그룹별 처리: 세트상품은 최소 수량, 그 외는 첫 번째 아이템 사용
      const processedData: any[] = [];
      orderGroups.forEach((items, normalizedOrderNum) => {
        // 세트상품 여부 확인 (그룹 내 모든 아이템이 -Sxx 패턴인지)
        const setItems = items.filter((item: any) => isSetProduct(item.order_number));

        if (setItems.length > 1) {
          // 세트상품: 최소 입고 수량 계산
          const minImportQty = Math.min(...setItems.map((item: any) => item.import_qty));
          const minCancelQty = Math.min(...setItems.map((item: any) => item.cancel_qty));

          // 첫 번째 아이템 기준으로 정규화된 주문번호 사용
          const baseItem = setItems[0];
          processedData.push({
            ...baseItem,
            order_number: normalizedOrderNum, // 정규화된 주문번호 사용
            import_qty: minImportQty,
            cancel_qty: minCancelQty,
            available_qty: minImportQty
          });

          console.log(`세트상품 처리: ${normalizedOrderNum} (${setItems.length}개 아이템) → 입고수량: ${minImportQty}`);
        } else {
          // 일반 상품: 정규화된 주문번호로 저장
          items.forEach((item: any) => {
            processedData.push({
              ...item,
              order_number: normalizedOrderNum // 정규화된 주문번호 사용
            });
          });
        }
      });

      const transformedOrderData: OrderData[] = processedData.filter((item: OrderData) => item.order_number.trim() !== '');
      setOrderData(transformedOrderData);

      console.log(`진행 시트에서 ${transformedOrderData.length}개 주문 로드 완료`);

      // 2. 스캔 시트에서 기존 스캔 데이터 로드
      const scanResponse = await fetch(`/api/load-scan-data?googlesheet_id=${selectedUser.googlesheet_id}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });

      const scanResult = await scanResponse.json();

      console.log('스캔 데이터 API 응답:', scanResult);

      if (scanResponse.ok && scanResult.success) {
        const scanData: ScanSheetData[] = scanResult.data || [];
        console.log(`스캔 시트에서 ${scanData.length}개 데이터 로드 완료`);

        // 3. 스캔 데이터와 주문 데이터 매칭
        const matchedShipmentData = matchScanDataWithOrders(scanData, transformedOrderData);

        // 4. 박스번호로 정렬
        const sortedShipmentData = matchedShipmentData.sort((a, b) =>
          a.box_number.localeCompare(b.box_number)
        );

        setShipmentData(sortedShipmentData);

        console.log(`매칭된 쉽먼트 데이터: ${matchedShipmentData.length}개`);

        setAlertMessage(`주문 ${transformedOrderData.length}개, 스캔 ${scanData.length}개 데이터를 불러왔습니다.`);
        setShowAlert(true);
        setTimeout(() => setShowAlert(false), 3000);

        // 새 데이터 불러오기 후 저장 상태 초기화
        setHasUnsavedChanges(false);
        setIsSheetLoaded(true); // 시트 불러오기 완료
      } else {
        // 스캔 데이터 로드 실패는 경고만 표시
        console.warn('스캔 데이터 로드 실패:', scanResult.error);
        setShipmentData([]);

        setAlertMessage(`주문 ${transformedOrderData.length}개 데이터를 불러왔습니다. (스캔 데이터 없음)`);
        setShowAlert(true);
        setTimeout(() => setShowAlert(false), 3000);

        // 새 데이터 불러오기 후 저장 상태 초기화
        setHasUnsavedChanges(false);
        setIsSheetLoaded(true); // 시트 불러오기 완료
      }

    } catch (error) {
      console.error('시트 데이터 불러오기 오류:', error);
      setAlertMessage(`시트 데이터를 불러오는데 실패했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  // 주문번호로 주문 정보 찾기
  // 성공 소리 재생 함수 - 밝고 경쾌한 소리
  const playSuccessSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // 첫 번째 비프음 (높은음)
      const osc1 = audioContext.createOscillator();
      const gain1 = audioContext.createGain();
      osc1.connect(gain1);
      gain1.connect(audioContext.destination);
      osc1.frequency.setValueAtTime(1200, audioContext.currentTime);
      osc1.type = 'sine';
      gain1.gain.setValueAtTime(0.5, audioContext.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      osc1.start(audioContext.currentTime);
      osc1.stop(audioContext.currentTime + 0.1);

      // 두 번째 비프음 (더 높은음)
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.setValueAtTime(1400, audioContext.currentTime + 0.15);
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.5, audioContext.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);
      osc2.start(audioContext.currentTime + 0.15);
      osc2.stop(audioContext.currentTime + 0.25);

    } catch (error) {
      console.log('성공 소리 재생 실패:', error);
    }
  };

  // 에러 소리 재생 함수 - 더 확실한 소리
  const playErrorSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // 첫 번째 비프음 (높은음)
      const osc1 = audioContext.createOscillator();
      const gain1 = audioContext.createGain();
      osc1.connect(gain1);
      gain1.connect(audioContext.destination);
      osc1.frequency.setValueAtTime(1000, audioContext.currentTime);
      osc1.type = 'square';
      gain1.gain.setValueAtTime(0.7, audioContext.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
      osc1.start(audioContext.currentTime);
      osc1.stop(audioContext.currentTime + 0.15);

      // 두 번째 비프음 (낮은음)
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.setValueAtTime(600, audioContext.currentTime + 0.2);
      osc2.type = 'square';
      gain2.gain.setValueAtTime(0.7, audioContext.currentTime + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);
      osc2.start(audioContext.currentTime + 0.2);
      osc2.stop(audioContext.currentTime + 0.35);

      // 세 번째 비프음 (높은음)
      const osc3 = audioContext.createOscillator();
      const gain3 = audioContext.createGain();
      osc3.connect(gain3);
      gain3.connect(audioContext.destination);
      osc3.frequency.setValueAtTime(1000, audioContext.currentTime + 0.4);
      osc3.type = 'square';
      gain3.gain.setValueAtTime(0.7, audioContext.currentTime + 0.4);
      gain3.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.55);
      osc3.start(audioContext.currentTime + 0.4);
      osc3.stop(audioContext.currentTime + 0.55);

    } catch (error) {
      console.log('오디오 재생 실패:', error);
    }
  };

  // 바코드 정규화 함수: 세 번째 - 이후 제거
  // 예: BZ-250926-0049-A01 → BZ-250926-0049
  // 예: BZ-250926-0049#1-S21 → BZ-250926-0049#1
  const normalizeBarcodeToOrderNumber = (barcode: string): string => {
    const trimmed = barcode.trim();
    const parts = trimmed.split('-');

    // - 가 3개 이상이면 앞의 3개만 사용
    if (parts.length > 3) {
      return parts.slice(0, 3).join('-');
    }

    return trimmed;
  };

  // 바코드에서 사이즈 코드 추출 (마지막 -A, -B, -C, -P, -X)
  const extractSizeCode = (barcode: string): string | null => {
    const trimmed = barcode.trim();
    const parts = trimmed.split('-');

    // 마지막 부분이 A, B, C, P, X 중 하나인지 확인
    if (parts.length > 3) {
      const lastPart = parts[parts.length - 1].toUpperCase();
      if (['A', 'B', 'C', 'P', 'X'].includes(lastPart)) {
        return lastPart;
      }
    }

    return null;
  };

  // V열(product_size)에서 사이즈 코드 변환 함수
  const getSizeCodeFromProductSize = (productSize: string | null | undefined): string | null => {
    if (!productSize || typeof productSize !== 'string' || !productSize.trim()) return 'X'; // 비어있으면 'X'

    const sizeLower = productSize.trim().toLowerCase();

    if (sizeLower.includes('small')) return 'A';
    if (sizeLower.includes('medium')) return 'B';
    if (sizeLower.includes('large')) return 'C';
    if (sizeLower.includes('p-')) return 'P';
    if (sizeLower.includes('direct')) return 'X';

    return 'X'; // 매칭되지 않는 경우도 'X'
  };

  // 박스 번호에서 사이즈 코드 추출 함수 (BZ-A-01 -> A, HI-P-01 -> P)
  const getSizeCodeFromBoxNumber = (boxNumber: string): string | null => {
    if (!boxNumber || typeof boxNumber !== 'string') return null;

    const parts = boxNumber.trim().split('-');

    // 최소 3개 부분이 있어야 함 (예: BZ-A-01)
    if (parts.length < 3) return null;

    // 두 번째 부분이 사이즈 코드 (A, B, C, P, X 중 하나)
    const sizeCode = parts[1].toUpperCase();
    if (['A', 'B', 'C', 'P', 'X'].includes(sizeCode)) {
      return sizeCode;
    }

    return null;
  };

  const findOrderByNumber = (orderNumber: string): ExportOrderItem | undefined => {
    // 1. 입력값 정규화 (BZ-250926-0049-A01 → BZ-250926-0049, BZ-250926-0049#1-S21 → BZ-250926-0049#1)
    const normalized = normalizeBarcodeToOrderNumber(orderNumber);

    // 2. exportItems에서 매칭 (product_no 기준)
    return exportItems.find(item => item.product_no === normalized);
  };

  // ============================================================
  // 단건 스캔: product_no 로 exportItems 에서 조회 → 카드 표시 + scanHistory 추가
  // ============================================================
  const handleSingleScan = useCallback((productNo: string) => {
    const trimmed = productNo.trim();
    if (!trimmed) return;

    const found = exportItems.find((item) => item.product_no === trimmed);
    if (!found) {
      playErrorSound();
      setAlertMessage('해당 주문번호(product_no)를 찾을 수 없습니다.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      setCurrentExportItem(null);
      setLastScanSuccess(null);
      return;
    }

    if (!selectedBox) {
      playErrorSound();
      setAlertMessage('박스번호를 먼저 입력해주세요.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    // ── 박스 타입(A/B/C/P/X)과 상품 size_code 불일치 검증 ──
    // A=B=C=P=X 모드: 모든 타입 허용 / P=X 모드: P와 X 상호 허용
    if (selectedType && found.size_code !== selectedType) {
      if (!isAllEqual) {
        const pxGroup = ['P', 'X'];
        const isAllowed = isPxEqual && pxGroup.includes(selectedType) && pxGroup.includes(found.size_code);
        if (!isAllowed) {
          playErrorSound();
          setCurrentExportItem(found);
          setLastScanSuccess(false);
          return;
        }
      }
    }

    // 전체개수(DB + 로컬) 계산 — 준비개수 초과 시 실패 처리 (에러 항목 제외)
    const localScanned = scanHistory
      .filter((s) => !s.is_error && s.order_number === (found.product_no || ''))
      .reduce((sum, s) => sum + s.scanned_qty, 0);

    if (localScanned >= found.available_qty) {
      // 초과: 결과만 보여주고 스캔개수 증가 안 함
      playErrorSound();
      setCurrentExportItem(found);
      setLastScanSuccess(false);
      return;
    }

    // 스캔 기록 추가
    const scanTime = new Date().toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const scanItem: ShipmentData = {
      box_number: selectedBox,
      order_number: found.product_no || '',
      product_name: found.item_name || '',
      option_name: found.option_name || '',
      china_options: [found.china_option1, found.china_option2].filter(Boolean).join(', '),
      scanned_qty: 1,
      barcode: found.barcode || '',
      available_qty: found.available_qty,
      scan_method: '스캔',
      scan_time: scanTime,
    };

    setScanHistory((prev) => [...prev, scanItem]);
    setCurrentExportItem(found);
    setLastScanSuccess(true);
    playSuccessSound();

    // shipmentData 에도 추가/업데이트
    setShipmentData((prev) => {
      const existIdx = prev.findIndex(
        (s) => s.box_number === selectedBox && s.order_number === (found.product_no || '')
      );
      if (existIdx >= 0) {
        const updated = [...prev];
        updated[existIdx] = { ...updated[existIdx], scanned_qty: updated[existIdx].scanned_qty + 1 };
        return updated;
      }
      return [...prev, { ...scanItem }];
    });

    setHasUnsavedChanges(true);
  }, [exportItems, selectedBox, scanHistory]);

  // ============================================================
  // ft_fulfillments 저장 (PACKED)
  // ============================================================
  const [isSavingFulfillment, setIsSavingFulfillment] = useState(false);
  const savingLockRef = React.useRef(false); // 더블클릭 방지 lock

  const handleFulfillmentSave = useCallback(async () => {
    // 더블클릭 방지: ref 기반 즉시 lock (state보다 빠름)
    if (savingLockRef.current) return;
    savingLockRef.current = true;

    if (!selectedOperator) {
      alert('담당자를 선택해주세요.');
      savingLockRef.current = false;
      return;
    }
    const validScans = scanHistory.filter(s => !s.is_error);
    if (validScans.length === 0) {
      alert('저장할 스캔 데이터가 없습니다.');
      savingLockRef.current = false;
      return;
    }
    if (!selectedFtUserId) {
      alert('사용자를 선택해주세요.');
      savingLockRef.current = false;
      return;
    }

    // (box_number, order_number) 기준으로 수량 합산 — is_error 항목 제외
    const groupMap = new Map<string, { box_number: string; order_number: string; qty: number }>();
    for (const s of scanHistory) {
      if (s.is_error) continue; // 에러 항목은 저장에서 제외
      const key = `${s.box_number}||${s.order_number}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.qty += s.scanned_qty;
      } else {
        groupMap.set(key, { box_number: s.box_number, order_number: s.order_number, qty: s.scanned_qty });
      }
    }

    const items: Record<string, unknown>[] = [];
    for (const group of groupMap.values()) {
      const exportItem = exportItems.find((e) => e.product_no === group.order_number);
      if (!exportItem) continue;
      items.push({
        order_item_id: exportItem.id,
        type: 'PACKED',
        quantity: group.qty,
        operator_name: selectedOperator,
        operator_id: null,
        order_no: exportItem.order_no,
        item_no: exportItem.item_no,
        shipment_no: null,
        shipment_id: null,
        user_id: selectedFtUserId,
        package_no: group.box_number,
        box_code: group.box_number,
        box_info_id: activeBoxInfo?.id || null,
        product_no: exportItem.product_no,
        product_id: exportItem.product_id || null,
      });
    }

    if (items.length === 0) {
      alert('매칭되는 출고 항목이 없습니다.');
      savingLockRef.current = false;
      return;
    }

    setIsSavingFulfillment(true);
    try {
      const res = await fetch('/api/ft/fulfillments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!json.success) throw new Error((json.error || '저장 실패') + (json.details ? ` [${json.details}]` : ''));
      alert(`${json.message}`);
      // 저장 완료 후 스캔 기록 초기화 (중복 저장 방지)
      setScanHistory([]);
      setShipmentData([]);
      setCurrentExportItem(null);
      setLastScanSuccess(null);
      setHasUnsavedChanges(false);
      // DB 반영된 최신 데이터 새로고침 (available_qty, packed_qty 갱신)
      await fetchExportData(selectedFtUserId);
    } catch (err) {
      console.error('fulfillment 저장 오류:', err);
      alert(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingFulfillment(false);
      savingLockRef.current = false;
    }
  }, [selectedOperator, selectedFtUserId, scanHistory, exportItems, setHasUnsavedChanges, fetchExportData]);

  // ============================================================
  // 박스 관리 핸들러
  // ============================================================

  /** PACKING 상태 박스 목록 조회 (박스선택 모달용) */
  const fetchAvailableBoxes = useCallback(async () => {
    if (!selectedFtUserId) return;
    try {
      const res = await fetch(`/api/ft/box-info?user_id=${selectedFtUserId}&status=PACKING&shipment_id=null`);
      const json = await res.json();
      if (json.success) setAvailableBoxes(json.data || []);
    } catch (err) {
      console.error('박스 목록 조회 오류:', err);
    }
  }, [selectedFtUserId]);

  /** 박스 생성 → ft_box_info INSERT → 자동 선택 */
  const handleBoxCreate = useCallback(async () => {
    if (!boxPrefix || !boxCreateType || !boxCreateNo) {
      alert('사업자코드, 타입, 번호를 모두 입력해주세요.');
      return;
    }
    const newBoxCode = `${boxPrefix}-${boxCreateType}-${boxCreateNo}`;
    try {
      const res = await fetch('/api/ft/box-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_code: boxPrefix,
          box_code: newBoxCode,
          type: boxCreateType,
          no: boxCreateNo,
          size: boxCreateSize || null,
          user_id: selectedFtUserId,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      // 생성된 박스 자동 선택
      const created = json.data;
      setActiveBoxInfo(created);
      setSelectedSize(boxCreateSize);
      setShowBoxCreateModal(false);
      // 폼 초기화
      setBoxCreateType('');
      setBoxCreateNo('');
      setBoxCreateSize('');
    } catch (err) {
      alert(err instanceof Error ? err.message : '박스 생성 오류');
    }
  }, [boxPrefix, boxCreateType, boxCreateNo, boxCreateSize, selectedFtUserId]);

  /** 박스 선택 → activeBoxInfo 설정 + 입력폼 반영 */
  const handleBoxSelect = useCallback((box: BoxInfo) => {
    setActiveBoxInfo(box);
    setBoxPrefix(box.user_code);
    setSelectedSize(box.size || '');
    setShowBoxSelectModal(false);
  }, []);

  // 보드용 스캔 처리 함수 (개수 자동 1)
  const handleBoardScan = (orderNumber: string) => {
    console.log('보드 스캔 - 입력된 주문번호:', `"${orderNumber}"`);

    if (!orderNumber) {
      playErrorSound();
      setAlertMessage('주문번호를 입력해주세요.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    if (!selectedBox) {
      playErrorSound();
      setAlertMessage('박스번호를 입력해주세요.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    processScan(orderNumber, 1, '스캔');
    setBoardBarcodeInput(''); // 보드 바코드 입력 초기화
  };

  // 입력폼용 스캔 처리 함수
  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();

    const orderNumber = barcodeInput.trim();
    const quantity = quantityInput.trim() === '' ? 1 : parseInt(quantityInput);

    if (!orderNumber) {
      playErrorSound();
      setAlertMessage('주문번호를 입력해주세요.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    if (!selectedBox) {
      playErrorSound();
      setAlertMessage('박스번호를 입력해주세요.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    processScan(orderNumber, quantity, '입력');

    // 입력 필드 초기화
    setBarcodeInput('');
    setQuantityInput('');
  };

  // 공통 스캔 처리 로직 — exportItems(Supabase) 기반
  const processScan = (orderNumber: string, quantity: number, scanMethod: '스캔' | '입력') => {
    // 바코드 정규화
    const normalizedOrderNumber = normalizeBarcodeToOrderNumber(orderNumber);

    // exportItems에서 해당 주문번호 찾기
    const found = findOrderByNumber(orderNumber);

    if (!found) {
      playErrorSound();
      setAlertMessage('해당 주문번호를 찾을 수 없습니다.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      setCurrentExportItem(null);
      setLastScanSuccess(null);

      const scanTime = new Date().toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });

      setScanHistory(prev => [...prev, {
        box_number: selectedBox,
        order_number: normalizedOrderNumber,
        product_name: '주문번호를 찾을 수 없음',
        option_name: '',
        china_options: '',
        scanned_qty: quantity,
        barcode: '',
        available_qty: 0,
        scan_method: scanMethod,
        scan_time: scanTime,
        is_error: true,
      }]);

      return;
    }

    // 사이즈 코드 검증 (박스 타입 vs 상품 size_code)
    const boxSizeCode = getSizeCodeFromBoxNumber(selectedBox);
    const productSizeCode = found.size_code || null;

    if (boxSizeCode && productSizeCode && boxSizeCode !== productSizeCode) {
      // A=B=C=P=X 모드 / P=X 모드 체크
      if (!isAllEqual) {
        const pxGroup = ['P', 'X'];
        const isAllowed = isPxEqual && pxGroup.includes(boxSizeCode) && pxGroup.includes(productSizeCode);
        if (!isAllowed) {
          playErrorSound();
          setCurrentExportItem(found);
          setLastScanSuccess(false);

          const scanTime = new Date().toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });

          setScanHistory(prev => [...prev, {
            box_number: selectedBox,
            order_number: normalizedOrderNumber,
            product_name: `${found.item_name || ''} [사이즈 불일치: 박스=${boxSizeCode}, 상품=${productSizeCode}]`,
            option_name: found.option_name || '',
            china_options: [found.china_option1, found.china_option2].filter(Boolean).join(', '),
            scanned_qty: quantity,
            barcode: found.barcode || '',
            available_qty: found.available_qty,
            scan_method: scanMethod,
            scan_time: scanTime,
            is_error: true,
          }]);

          return;
        }
      }
    }

    // 기존 스캔 수량 계산 (에러 항목 제외)
    const localScanned = scanHistory
      .filter(s => !s.is_error && s.order_number === (found.product_no || ''))
      .reduce((sum, s) => sum + s.scanned_qty, 0);

    if (localScanned + quantity > found.available_qty) {
      playErrorSound();
      setCurrentExportItem(found);
      setLastScanSuccess(false);

      const scanTime = new Date().toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });

      setScanHistory(prev => [...prev, {
        box_number: selectedBox,
        order_number: normalizedOrderNumber,
        product_name: found.item_name || '',
        option_name: found.option_name || '',
        china_options: [found.china_option1, found.china_option2].filter(Boolean).join(', '),
        scanned_qty: quantity,
        barcode: found.barcode || '',
        available_qty: found.available_qty,
        scan_method: scanMethod,
        scan_time: scanTime,
        is_error: true,
      }]);

      return;
    }

    // 성공
    playSuccessSound();

    const scanTime = new Date().toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const scanItem: ShipmentData = {
      box_number: selectedBox,
      order_number: found.product_no || '',
      product_name: found.item_name || '',
      option_name: found.option_name || '',
      china_options: [found.china_option1, found.china_option2].filter(Boolean).join(', '),
      scanned_qty: quantity,
      barcode: found.barcode || '',
      available_qty: found.available_qty,
      scan_method: scanMethod,
      scan_time: scanTime,
    };

    setScanHistory(prev => [...prev, scanItem]);
    setCurrentExportItem(found);
    setLastScanSuccess(true);

    // shipmentData 추가/업데이트
    setShipmentData(prev => {
      const existIdx = prev.findIndex(
        s => s.box_number === selectedBox && s.order_number === (found.product_no || '')
      );
      let updatedData;
      if (existIdx >= 0) {
        updatedData = [...prev];
        updatedData[existIdx] = { ...updatedData[existIdx], scanned_qty: updatedData[existIdx].scanned_qty + quantity };
      } else {
        updatedData = [...prev, { ...scanItem }];
      }
      setHasUnsavedChanges(true);
      return updatedData.sort((a, b) => a.box_number.localeCompare(b.box_number));
    });
  };

  // 체크박스 관련 함수들
  const handleSelectItem = (index: number) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedItems.size === shipmentData.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(shipmentData.map((_, index) => index)));
    }
  };

  const handleDeleteSelected = () => {
    const newShipmentData = shipmentData.filter((_, index) => !selectedItems.has(index));
    setShipmentData(newShipmentData);
    setSelectedItems(new Set());
    setHasUnsavedChanges(true); // 삭제 시 저장 필요 상태로 변경
  };

  // 개수 셀 클릭 핸들러
  const handleQtyClick = (index: number) => {
    setEditingIndex(index);
    setEditingValue(shipmentData[index].scanned_qty.toString());
  };

  // 개수 변경 핸들러
  const handleQtyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingValue(e.target.value);
  };

  // 개수 변경 완료 핸들러
  const handleQtyBlur = () => {
    if (editingIndex !== null) {
      const newQty = parseInt(editingValue);
      if (!isNaN(newQty) && newQty > 0) {
        const updatedData = [...shipmentData];
        updatedData[editingIndex] = {
          ...updatedData[editingIndex],
          scanned_qty: newQty
        };
        setShipmentData(updatedData);
        setHasUnsavedChanges(true);
      }
      setEditingIndex(null);
      setEditingValue('');
    }
  };

  // 개수 입력 중 엔터키 핸들러
  const handleQtyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleQtyBlur();
    } else if (e.key === 'Escape') {
      setEditingIndex(null);
      setEditingValue('');
    }
  };

  const saveAllData = async () => {
    console.log('저장 클릭');

    if (!selectedCoupangUser) {
      setAlertMessage('쿠팡 사용자를 선택해주세요.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    if (shipmentData.length === 0) {
      setAlertMessage('저장할 스캔 데이터가 없습니다.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser || !selectedUser.googlesheet_id) {
      setAlertMessage('선택한 사용자의 구글 시트 ID를 찾을 수 없습니다.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      return;
    }

    try {
      setLoading(true);

      // 스캔 데이터를 API에 전송
      const response = await fetch('/api/save-scan-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          googlesheet_id: selectedUser.googlesheet_id,
          scan_data: shipmentData.map(item => ({
            box_number: item.box_number,
            order_number: item.order_number,
            barcode: item.barcode,
            product_name: item.product_name,
            option_name: item.option_name,
            scanned_qty: item.scanned_qty,
            available_qty: item.available_qty
          }))
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // 저장 후 검증: 구글 시트에서 데이터를 다시 조회해서 저장이 제대로 되었는지 확인
        console.log('저장 완료, 검증을 위해 데이터 재조회 중...');

        try {
          const verifyResponse = await fetch(`/api/load-scan-data?googlesheet_id=${selectedUser.googlesheet_id}`, {
            method: 'GET',
            headers: {
              'Cache-Control': 'no-cache',
            },
            cache: 'no-store'
          });

          const verifyResult = await verifyResponse.json();

          if (verifyResponse.ok && verifyResult.success) {
            const savedDataCount = verifyResult.data?.length || 0;
            const originalDataCount = shipmentData.length;

            if (savedDataCount >= originalDataCount) {
              // 저장 검증 성공
              setAlertMessage(`✅ 저장 완료! ${originalDataCount}개 데이터가 구글 시트에 성공적으로 저장되었습니다. (검증됨: ${savedDataCount}개)`);
              setShowAlert(true);
              setTimeout(() => setShowAlert(false), 4000);

              // 저장 성공 시 저장 필요 상태 해제
              setHasUnsavedChanges(false);
            } else {
              // 저장된 데이터 수가 예상보다 적음
              setAlertMessage(`⚠️ 저장 경고: ${originalDataCount}개를 저장했지만 ${savedDataCount}개만 확인됨. 다시 저장을 시도해주세요.`);
              setShowAlert(true);
              setTimeout(() => setShowAlert(false), 5000);
            }
          } else {
            // 검증 조회 실패
            setAlertMessage(`⚠️ 저장은 완료되었으나 검증 실패: ${result.message || '저장 확인 중 오류 발생'}`);
            setShowAlert(true);
            setTimeout(() => setShowAlert(false), 4000);
            setHasUnsavedChanges(false); // 저장은 성공했으므로 상태 해제
          }
        } catch (verifyError) {
          console.error('저장 검증 오류:', verifyError);
          setAlertMessage(`⚠️ 저장은 완료되었으나 검증 중 오류: ${verifyError instanceof Error ? verifyError.message : '검증 실패'}`);
          setShowAlert(true);
          setTimeout(() => setShowAlert(false), 4000);
          setHasUnsavedChanges(false); // 저장은 성공했으므로 상태 해제
        }
      } else {
        const errorMessage = result.error || '스캔 데이터 저장에 실패했습니다.';
        console.error('저장 오류:', errorMessage);
        setAlertMessage(errorMessage);
        setShowAlert(true);
        setTimeout(() => setShowAlert(false), 3000);
      }
    } catch (error) {
      console.error('스캔 데이터 저장 오류:', error);
      setAlertMessage(`스캔 데이터 저장 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  // 박스번호 + 크기 둘 다 입력돼야 보드 활성화 가능
  const canActivateBoards = selectedBox.trim() !== '' && selectedSize.trim() !== '';

  return (
    <div className="v2-export-layout">
      <TopsideMenu />
      <div className="v2-export-main-content">
        <LeftsideMenu />
        <main className="v2-export-content">
          <div className="v2-export-container">
            {/* ============================================================ */}
            {/* 헤더: 타이틀 왼쪽 | P=X, A=B=C=P=X, 담당자, 사업자 오른쪽 */}
            {/* ============================================================ */}
            <div className="v2-export-header-row">
              <h1 className="v2-export-title">{t('exportProduct.title')}</h1>
              <div className="v2-export-header-controls">
                {/* P=X 체크 */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: isPxEqual ? '#ea580c' : '#6b7280' }}>
                  <input type="checkbox" checked={isPxEqual} onChange={(e) => setIsPxEqual(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  P=X
                </label>
                {/* A=B=C=P=X 체크 */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: isAllEqual ? '#2563eb' : '#6b7280' }}>
                  <input type="checkbox" checked={isAllEqual} onChange={(e) => setIsAllEqual(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  A=B=C=P=X
                </label>
                {/* 담당자 드롭박스 */}
                <select className="v2-export-coupang-user-dropdown" value={selectedOperator} onChange={(e) => setSelectedOperator(e.target.value)}>
                  <option value="">담당자</option>
                  {OPERATOR_OPTIONS.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {/* 사업자 드롭박스 — 선택 시 prefix 자동입력 + 출고 데이터 로드 */}
                <select
                  className="v2-export-coupang-user-dropdown"
                  value={selectedFtUserId}
                  onChange={(e) => {
                    const userId = e.target.value;
                    setSelectedFtUserId(userId);
                    const user = ftUsers.find((u) => u.id === userId);
                    setBoxPrefix(user?.user_code?.toUpperCase() || '');
                    fetchExportData(userId);
                  }}
                >
                  <option value="">사용자</option>
                  {ftUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.vender_name || user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ============================================================ */}
            {/* 박스 액션 버튼 (세로 배치) + 선택된 박스 표시              */}
            {/* ============================================================ */}
            <div className="v2-export-box-action-col">
              <button className="v2-export-box-action-btn" disabled={!selectedOperator || !selectedFtUserId} onClick={() => setShowBoxCreateModal(true)}>박스생성</button>
              <button className="v2-export-box-action-btn" disabled={!selectedOperator || !selectedFtUserId} onClick={() => { fetchAvailableBoxes(); setShowBoxSelectModal(true); }}>박스선택</button>
              <button className="v2-export-box-action-btn" disabled={!selectedOperator || !selectedFtUserId} onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}>{t('exportProduct.record')}</button>
              <button
                className={`v2-export-box-action-btn v2-export-box-action-btn--save ${hasUnsavedChanges ? 'has-changes' : ''}`}
                onClick={handleFulfillmentSave}
                disabled={!selectedOperator || !selectedFtUserId || isSavingFulfillment}
              >
                {isSavingFulfillment ? '저장 중...' : `저장${hasUnsavedChanges ? ' !' : ''}`}
              </button>
            </div>

            {/* 선택된 박스 표시 (보드 없이 텍스트만, 한줄) */}
            <div className="v2-export-active-box-text">
              {activeBoxInfo ? (
                <span><strong>{activeBoxInfo.box_code}</strong> {activeBoxInfo.size || ''}</span>
              ) : (
                <span className="v2-export-active-box-empty">박스를 생성하거나 선택하세요</span>
              )}
            </div>

            {/* 박스코드/타입/번호/크기 입력은 모달로 이동됨 */}

            {/* 스캔 정보 보드 (결과 표시) */}
            <div
              className={`v2-export-scan-board ${isResultBoardActive ? 'active' : ''} ${!canActivateBoards ? 'board-disabled' : ''}`}
              onMouseDown={(e) => {
                if (!canActivateBoards) {
                  setAlertMessage(!selectedBox.trim() ? '박스 번호를 입력해주세요.' : '박스 크기를 선택해주세요.');
                  setShowAlert(true);
                  setTimeout(() => setShowAlert(false), 2000);
                  return;
                }
                console.log('결과보드 mousedown');
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setIsResultBoardActive(true);
                setIsInputFormActive(false);
                setTimeout(() => {
                  boardBarcodeInputRef.current?.focus();
                }, 0);
              }}
              style={{
                cursor: canActivateBoards ? 'pointer' : 'not-allowed',
                border: isResultBoardActive ? '3px solid #4CAF50' : undefined,
                boxShadow: isResultBoardActive ? '0 0 10px rgba(76, 175, 80, 0.3)' : undefined,
                position: 'relative'
              }}
            >
              {/* 보드 활성화 시 바코드 스캔을 위한 숨겨진 입력 필드 */}
              {isResultBoardActive && (
                <input
                  ref={boardBarcodeInputRef}
                  type="text"
                  value={boardBarcodeInput}
                  onChange={(e) => setBoardBarcodeInput(toEnglishUpper(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const barcode = boardBarcodeInput.trim();
                      if (barcode) {
                        // ft_order_items 기반 스캔 우선, 없으면 기존 로직
                        if (exportItems.length > 0) {
                          handleSingleScan(barcode);
                        } else {
                          handleBoardScan(barcode);
                        }
                        setBoardBarcodeInput('');
                      }
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '1px',
                    height: '1px',
                    opacity: 0,
                    pointerEvents: 'none'
                  }}
                  autoFocus
                />
              )}

              {/* 클릭 이벤트 캡처용 오버레이 */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                }}
                style={{ width: '100%', height: '390px' }}
              >
                {loading || ftDataLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                    <p style={{ fontSize: '18px', color: '#9ca3af' }}>데이터 로딩 중...</p>
                  </div>
                ) : currentExportItem ? (
                  /* ============================================================ */
                  /* 단건 스캔 결과 카드 — 4분할: 이미지 | 상품정보 | 수량 | 결과 */
                  /* ============================================================ */
                  <div style={{ display: 'grid', gridTemplateColumns: '3fr 3fr 3fr 2fr', width: '100%', height: '100%' }}>
                    {/* 1) 이미지 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', borderRight: '1px solid #e9ecef' }}>
                      {currentExportItem.img_url ? (
                        <img
                          src={`/api/image-proxy?url=${encodeURIComponent(currentExportItem.img_url)}`}
                          alt="상품 이미지"
                          style={{ width: '100%', height: '286px', objectFit: 'cover', borderRadius: '12px', display: 'block' }}
                          onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '286px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px', color: '#adb5bd', border: '1px dashed #dee2e6' }}>
                          <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                          <span style={{ fontSize: '12px' }}>이미지 없음</span>
                        </div>
                      )}
                    </div>

                    {/* 2) 상품 정보 — 가운데+상단 정렬 */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '16px 20px', borderRight: '1px solid #e9ecef', overflow: 'hidden' }}>
                      <div style={{ fontSize: '38px', fontWeight: 700, color: '#111827', lineHeight: 1.2, wordBreak: 'break-all', letterSpacing: '-0.5px', textAlign: 'center' }}>
                        {currentExportItem.product_no}
                      </div>
                      {[currentExportItem.china_option1, currentExportItem.china_option2].filter(Boolean).length > 0 && (
                        <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                          {[currentExportItem.china_option1, currentExportItem.china_option2].filter(Boolean).map((opt, i) => (
                            <span key={i} style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '6px', background: '#f3f4f6', color: '#374151', fontSize: '24px', fontWeight: 500 }}>
                              {opt}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 사이즈 코드 배지: A/B/C(파란) P(주황) X(검정) — 4배 크기 */}
                      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', flex: 1, alignItems: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '6px 24px',
                          borderRadius: '12px',
                          fontSize: '144px',
                          fontWeight: 700,
                          lineHeight: 1,
                          color: '#fff',
                          background: ['A', 'B', 'C'].includes(currentExportItem.size_code) ? '#2563eb'
                            : currentExportItem.size_code === 'P' ? '#ea580c'
                            : '#111827',
                        }}>
                          {currentExportItem.size_code}
                        </span>
                      </div>
                    </div>

                    {/* 3) 수량 3개: 준비 / 스캔(이 박스 로컬) / 전체(DB + 로컬) */}
                    {(() => {
                      const localTotal = scanHistory.filter((s) => !s.is_error && s.order_number === currentExportItem.product_no).reduce((sum, s) => sum + s.scanned_qty, 0);
                      const boxScanned = scanHistory.filter((s) => !s.is_error && s.box_number === selectedBox && s.order_number === currentExportItem.product_no).reduce((sum, s) => sum + s.scanned_qty, 0);
                      const grandTotal = (currentExportItem.packed_qty || 0) + localTotal; // DB 저장분 + 로컬 스캔
                      const allDone = grandTotal > 0 && grandTotal >= (currentExportItem.available_qty + (currentExportItem.packed_qty || 0));
                      const numColor = allDone ? '#16a34a' : '#111827';
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderRight: '1px solid #e9ecef' }}>
                          {[
                            { label: '준비', value: currentExportItem.available_qty },
                            { label: '스캔', value: boxScanned },
                            { label: '전체', value: grandTotal },
                          ].map((item, i) => (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: i > 0 ? '1px solid #e9ecef' : undefined }}>
                              <div style={{ fontSize: '15px', fontWeight: 600, color: '#9ca3af', letterSpacing: '0.8px', marginBottom: '8px', textTransform: 'uppercase' }}>{item.label}</div>
                              <div style={{ fontSize: '73px', fontWeight: 700, color: numColor, lineHeight: 1 }}>{item.value}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* 4) 성공/실패 이모지 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: lastScanSuccess === true ? '#f0fdf4' : lastScanSuccess === false ? '#fef2f2' : 'transparent' }}>
                      <span style={{ fontSize: '72px', lineHeight: 1 }}>{lastScanSuccess === true ? '✅' : lastScanSuccess === false ? '❌' : '—'}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: '16px' }}>
                    <div style={{ fontSize: '48px', opacity: 0.25 }}>🔍</div>
                    <div style={{ fontSize: '15px', color: '#aaa', fontWeight: 500, letterSpacing: '0.3px' }}>보드를 클릭 후 바코드를 스캔하세요</div>
                    {exportItems.length > 0 && (
                      <div style={{ fontSize: '12px', color: '#6c7bff', background: '#eef1ff', padding: '4px 12px', borderRadius: '20px', fontWeight: 600 }}>
                        출고 준비 {exportItems.length}개
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 바코드 입력 영역 */}
            <div className="v2-export-barcode-section">
              <div
                className={`v2-export-barcode-board ${!canActivateBoards ? 'board-disabled' : ''}`}
                onMouseDown={(e) => {
                  if (!canActivateBoards) {
                    setAlertMessage(!selectedBox.trim() ? '박스 번호를 입력해주세요.' : '박스 크기를 선택해주세요.');
                    setShowAlert(true);
                    setTimeout(() => setShowAlert(false), 2000);
                    return;
                  }
                  e.stopPropagation();
                  setIsInputFormActive(true);
                  setIsResultBoardActive(false);
                }}
                style={{
                  cursor: canActivateBoards ? 'default' : 'not-allowed',
                  border: isInputFormActive ? '3px solid #2196F3' : undefined,
                  boxShadow: isInputFormActive ? '0 0 10px rgba(33, 150, 243, 0.3)' : undefined
                }}
              >
                {/* 클릭 이벤트 캡처용 오버레이 */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  style={{ width: '100%', height: '100%' }}
                >
                  {/* 입력폼과 버튼 */}
                  <div className="v2-export-input-row">
                    <input
                      ref={barcodeInputRef}
                      type="text"
                      placeholder="여러건 주문번호 처리"
                      className="v2-export-barcode-input"
                      value={barcodeInput}
                      disabled={!canActivateBoards}
                      onChange={(e) => {
                        setBarcodeInput(toEnglishUpper(e.target.value));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          quantityInputRef.current?.focus();
                        }
                      }}
                    />
                    <input
                      ref={quantityInputRef}
                      type="number"
                      placeholder={t('exportProduct.quantityInput')}
                      className="v2-export-quantity-input"
                      value={quantityInput}
                      disabled={!canActivateBoards}
                      onChange={(e) => setQuantityInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleScan(e);
                        }
                      }}
                    />
                    <button
                      className={`v2-export-scan-button ${!canActivateBoards || !barcodeInput.trim() || !quantityInput.trim() ? 'disabled' : ''}`}
                      onClick={handleScan}
                      disabled={!canActivateBoards || !barcodeInput.trim() || !quantityInput.trim()}
                    >
                      {t('exportProduct.scan')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* 박스 생성 모달                                              */}
      {/* ============================================================ */}
      {showBoxCreateModal && (
        <div className="v2-export-box-modal-overlay" onClick={() => setShowBoxCreateModal(false)}>
          <div className="v2-export-box-create-modal" onClick={(e) => e.stopPropagation()}>
            <h3>박스 생성</h3>

            {/* Row 1: 사업자코드 */}
            <div className="v2-export-box-modal-row">
              <label>사업자코드</label>
              <input type="text" value={boxPrefix} readOnly />
            </div>

            {/* Row 2: 타입 A/B/C/P/X — 테두리+폰트 색상만 (배경 없음) */}
            <div className="v2-export-box-modal-row">
              <label>타입</label>
              <div className="v2-export-box-type-btns">
                {['A', 'B', 'C', 'P', 'X'].map((t) => (
                  <button
                    key={t}
                    className={`v2-export-box-type-btn ${boxCreateType === t ? `active-${t}` : ''}`}
                    onClick={() => setBoxCreateType(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 3: 번호 + 숫자 패드 (3열: 123 / 456 / 789 / C 0 초기화) */}
            <div className="v2-export-box-modal-row">
              <label>번호</label>
              <input
                type="text"
                value={boxCreateNo}
                onChange={(e) => setBoxCreateNo(e.target.value)}
                placeholder="번호 입력"
              />
              <div className="v2-export-box-numpad">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                  <button key={n} onClick={() => setBoxCreateNo((prev) => prev + n)}>{n}</button>
                ))}
                <button onClick={() => setBoxCreateNo((prev) => prev.slice(0, -1))}>C</button>
                <button onClick={() => setBoxCreateNo((prev) => prev + '0')}>0</button>
                <button onClick={() => setBoxCreateNo('')}>초기화</button>
              </div>
            </div>

            {/* Row 4: 박스크기 (가로 x 세로 x 높이) + 프리셋 */}
            <div className="v2-export-box-modal-row">
              <label>박스크기 (가로 x 세로 x 높이)</label>
              <div className="v2-export-box-size-inputs">
                <input
                  type="text"
                  value={boxCreateSize.split('x')[0] || ''}
                  onChange={(e) => {
                    const parts = boxCreateSize.split('x');
                    parts[0] = e.target.value;
                    setBoxCreateSize(parts.join('x'));
                  }}
                  placeholder="가로"
                />
                <span className="v2-export-box-size-x">x</span>
                <input
                  type="text"
                  value={boxCreateSize.split('x')[1] || ''}
                  onChange={(e) => {
                    const parts = boxCreateSize.split('x');
                    while (parts.length < 2) parts.push('');
                    parts[1] = e.target.value;
                    setBoxCreateSize(parts.join('x'));
                  }}
                  placeholder="세로"
                />
                <span className="v2-export-box-size-x">x</span>
                <input
                  type="text"
                  value={boxCreateSize.split('x')[2] || ''}
                  onChange={(e) => {
                    const parts = boxCreateSize.split('x');
                    while (parts.length < 3) parts.push('');
                    parts[2] = e.target.value;
                    setBoxCreateSize(parts.join('x'));
                  }}
                  placeholder="높이"
                />
              </div>
              <div className="v2-export-box-size-presets">
                {[
                  { label: '150 60x50x40', value: '60x50x40' },
                  { label: '145 50x50x45', value: '50x50x45' },
                  { label: '120 50x40x30', value: '50x40x30' },
                ].map((s) => (
                  <button
                    key={s.label}
                    className={`v2-export-box-size-btn ${boxCreateSize === s.value ? 'active' : ''}`}
                    onClick={() => setBoxCreateSize(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 생성 버튼 */}
            <button className="v2-export-box-create-confirm" onClick={handleBoxCreate}>
              생성
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 박스 선택 모달                                              */}
      {/* ============================================================ */}
      {showBoxSelectModal && (
        <div className="v2-export-box-modal-overlay" onClick={() => setShowBoxSelectModal(false)}>
          <div className="v2-export-box-select-modal" onClick={(e) => e.stopPropagation()}>
            <h3>박스 선택</h3>
            {['A', 'B', 'C', 'P', 'X'].map((type) => {
              const boxes = availableBoxes.filter((b) => b.type === type);
              if (boxes.length === 0) return null;
              return (
                <div key={type} className="v2-export-box-select-type-section">
                  <h4>{type} 타입</h4>
                  <div className="v2-export-box-select-grid">
                    {boxes.map((box) => (
                      <button
                        key={box.id}
                        className="v2-export-box-select-item"
                        onClick={() => handleBoxSelect(box)}
                      >
                        {box.box_code}
                        <small>{box.size || '-'}</small>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {availableBoxes.length === 0 && (
              <p style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>
                PACKING 상태의 박스가 없습니다.
              </p>
            )}
          </div>
        </div>
      )}

      {/* 알림 모달 */}
      {showAlert && (
        <div className="v2-export-alert-modal">
          <div className="v2-export-alert-content">
            {alertMessage}
          </div>
        </div>
      )}

      {/* 쉽먼트 슬라이드 패널 */}
      <div className={`v2-export-history-panel ${isHistoryPanelOpen ? 'open' : ''}`}>
        <div className="v2-export-history-header">
          <h3>쉽먼트</h3>
          <button className="v2-export-history-close" onClick={() => setIsHistoryPanelOpen(false)}>
            ✕
          </button>
        </div>
        <div className="v2-export-history-content">
          {/* 쉽먼트 테이블 내용 */}
          <div className="v2-export-shipment-header" style={{ padding: '15px 20px', borderBottom: '1px solid #ddd' }}>
            <button
              className="v2-export-delete-btn"
              onClick={handleDeleteSelected}
              disabled={selectedItems.size === 0}
            >
              삭제 ({selectedItems.size})
            </button>
          </div>
          <div className="v2-export-table-board" style={{ padding: '0', margin: '0' }}>
            <table className="v2-export-table">
              <thead>
                <tr>
                  <th className="v2-export-checkbox-column">
                    <input
                      type="checkbox"
                      checked={shipmentData.length > 0 && selectedItems.size === shipmentData.length}
                      onChange={handleSelectAll}
                      disabled={shipmentData.length === 0}
                    />
                  </th>
                  <th>박스번호</th>
                  <th className="v2-export-order-number-column">주문번호</th>
                  <th className="v2-export-product-name-column">상품정보</th>
                  <th>준비</th>
                  <th>스캔</th>
                  <th>전체</th>
                </tr>
              </thead>
              <tbody>
                {shipmentData.length === 0 ? (
                  <tr><td colSpan={7} className="v2-export-empty-data">데이터 없음</td></tr>
                ) : (
                  // 역순으로 표시 (최신 스캔이 위에 오도록)
                  [...shipmentData].reverse().map((item, displayIndex) => {
                    // 원본 배열의 인덱스 계산 (체크박스와 편집을 위해 필요)
                    const originalIndex = shipmentData.length - 1 - displayIndex;
                    return (
                      <tr key={originalIndex}>
                        <td className="v2-export-checkbox-column">
                          <input
                            type="checkbox"
                            checked={selectedItems.has(originalIndex)}
                            onChange={() => handleSelectItem(originalIndex)}
                          />
                        </td>
                        <td>{item.box_number}</td>
                        <td>{item.order_number}</td>
                        <td style={{ lineHeight: '1.5' }}>
                          <div>{item.product_name}{item.option_name ? `, ${item.option_name}` : ''}</div>
                          {item.china_options && <div style={{ color: '#6b7280', fontSize: '0.85em' }}>{item.china_options}</div>}
                        </td>
                        <td>{item.available_qty}</td>
                        <td
                          className="v2-export-editable-cell"
                          onClick={() => handleQtyClick(originalIndex)}
                          style={{ cursor: 'pointer' }}
                        >
                          {editingIndex === originalIndex ? (
                            <input
                              type="number"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={handleQtyBlur}
                              onKeyDown={handleQtyKeyDown}
                              autoFocus
                              className="v2-export-qty-input"
                            />
                          ) : (
                            <span>{item.scanned_qty}</span>
                          )}
                        </td>
                        <td>
                          {(() => {
                            const exportItem = exportItems.find((e) => e.product_no === item.order_number);
                            const dbPacked = exportItem?.packed_qty || 0;
                            const localTotal = scanHistory.filter((s) => !s.is_error && s.order_number === item.order_number).reduce((sum, s) => sum + s.scanned_qty, 0);
                            return dbPacked + localTotal;
                          })()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 기록 패널 오버레이 */}
      {isHistoryPanelOpen && (
        <div
          className="v2-export-history-overlay"
          onClick={() => setIsHistoryPanelOpen(false)}
        />
      )}
    </div>
  );
};

export default ExportProduct;
