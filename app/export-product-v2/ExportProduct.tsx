'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useSaveContext } from '../../contexts/SaveContext';
import { useFtUsers } from '../import-product-v2/hooks/useFtData';
import './ExportProduct.css';

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
  available_qty: number; // 실입고개수 (입고-취소)
  barcode: string; // 바코드 (F열)
  product_size: string; // 분류상자코드 (V열)
}

interface ShipmentData {
  box_number: string;
  order_number: string;
  product_name: string;
  option_name: string;
  china_options: string;
  scanned_qty: number;
  barcode: string;
  available_qty: number; // 입고개수
  scan_method?: '스캔' | '입력'; // 스캔 방식
  scan_time?: string; // 스캔 시간
  is_error?: boolean; // 에러 상태 (잘못된 스캔)
}

interface ScanSheetData {
  box_number: string;
  order_number: string;
  scanned_qty: number;
  row_index: number;
}

const ExportProduct: React.FC = () => {
  const { t } = useTranslation();
  const { hasUnsavedChanges, setHasUnsavedChanges } = useSaveContext();

  const [barcodeInput, setBarcodeInput] = useState('');
  const [quantityInput, setQuantityInput] = useState('');
  // ── 박스번호 3분할 입력 (prefix-type-seq → selectedBox 합성) ──
  const [boxPrefix, setBoxPrefix] = useState('');   // ft_users.user_code 자동입력
  const [boxType, setBoxType] = useState('');       // 한 글자 대문자 (A~Z)
  const [boxSeq, setBoxSeq] = useState('');         // 박스 일련번호
  const selectedBox = [boxPrefix, boxType, boxSeq].filter(Boolean).join('-');

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

  // 디버깅: 상태 변경 추적
  useEffect(() => {
    console.log('결과보드 활성화 상태:', isResultBoardActive);
  }, [isResultBoardActive]);

  // Ref for barcode input
  const barcodeInputRef = React.useRef<HTMLInputElement>(null);
  const quantityInputRef = React.useRef<HTMLInputElement>(null);
  const boardBarcodeInputRef = React.useRef<HTMLInputElement>(null);

  // Ref for box number split inputs
  const boxTypeInputRef = React.useRef<HTMLInputElement>(null);
  const boxSeqInputRef = React.useRef<HTMLInputElement>(null);

  // 기본 상태
  const [loading, setLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showAlert, setShowAlert] = useState(false);

  // ft_users (V2 전용)
  const { users: ftUsers } = useFtUsers();

  // 쿠팡 사용자 목록
  const [coupangUsers, setCoupangUsers] = useState<CoupangUser[]>([]);

  // 주문 데이터
  const [orderData, setOrderData] = useState<OrderData[]>([]);
  const [currentOrder, setCurrentOrder] = useState<OrderData | null>(null);
  const [scannedQty, setScannedQty] = useState(0);
  const [lastScannedSizeCode, setLastScannedSizeCode] = useState<string | null>(null);
  const [sizeMismatchInfo, setSizeMismatchInfo] = useState<{ boxCode: string; productCode: string } | null>(null);

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
    const handleGlobalClick = (e: MouseEvent) => {
      console.log('전역 mousedown 발생', e.target);
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
          china_options: `${matchedOrder.china_option1} ${matchedOrder.china_option2}`.trim(),
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
    setCurrentOrder(null);
    setScannedQty(0);
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

  const findOrderByNumber = (orderNumber: string) => {
    // 1. 입력값 정규화 (BZ-250926-0049-A01 → BZ-250926-0049, BZ-250926-0049#1-S21 → BZ-250926-0049#1)
    const normalized = normalizeBarcodeToOrderNumber(orderNumber);

    // 2. orderData에서 매칭 (orderData도 이미 정규화되어 있음)
    const matchedOrder = orderData.find(order => order.order_number === normalized);

    if (matchedOrder) {
      // product_size 확인하여 사이즈 코드 추가 (UI 표시용)
      const sizeCode = getSizeCodeFromProductSize(matchedOrder.product_size);
      if (sizeCode) {
        console.log(`주문번호 ${normalized}에 사이즈 코드 ${sizeCode} 자동 추가`);
      }
    }

    return matchedOrder;
  };

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

    console.log('입력폼 스캔 - 입력된 주문번호:', `"${orderNumber}"`);
    console.log('현재 로드된 주문 데이터 개수:', orderData.length);

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

  // 공통 스캔 처리 로직
  const processScan = (orderNumber: string, quantity: number, scanMethod: '스캔' | '입력') => {
    // 바코드 정규화 (BZ-250926-0049-A01 → BZ-250926-0049, BZ-250926-0049#1-S21 → BZ-250926-0049#1)
    const normalizedOrderNumber = normalizeBarcodeToOrderNumber(orderNumber);
    console.log('원본 바코드:', orderNumber, '→ 정규화:', normalizedOrderNumber);

    // 주문 데이터에서 해당 주문번호 찾기
    const foundOrder = findOrderByNumber(orderNumber);

    console.log('주문번호 검색 결과:', foundOrder);

    // 디버깅: 유사한 주문번호들 찾기
    const similarOrders = orderData.filter(order =>
      order.order_number.includes(normalizedOrderNumber) || normalizedOrderNumber.includes(order.order_number)
    );
    console.log('유사한 주문번호들:', similarOrders.map(order => order.order_number));

    if (!foundOrder) {
      playErrorSound();
      setAlertMessage('해당 주문번호를 찾을 수 없습니다.');
      setShowAlert(true);
      setTimeout(() => setShowAlert(false), 2000);
      setCurrentOrder(null);
      setLastScannedSizeCode(null); // 사이즈 코드 초기화

      // 잘못된 스캔도 기록에 추가 (에러 상태)
      const scanTime = new Date().toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const errorScanItem: ShipmentData = {
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
        is_error: true
      };

      setScanHistory(prev => [...prev, errorScanItem]);

      return;
    }

    // 사이즈 코드 검증 로직
    const boxSizeCode = getSizeCodeFromBoxNumber(selectedBox);
    const productSizeCode = getSizeCodeFromProductSize(foundOrder.product_size);

    console.log('박스 사이즈 코드:', boxSizeCode, '/ 상품 사이즈 코드:', productSizeCode);

    // 두 사이즈 코드가 모두 존재하고 일치하지 않으면 에러
    if (boxSizeCode && productSizeCode && boxSizeCode !== productSizeCode) {
      playErrorSound();
      // 모달창 제거, 결과 입력폼에만 표시
      setCurrentOrder(null);
      setLastScannedSizeCode(null);
      // 사이즈 불일치 정보 저장 (화면에 표시용)
      setSizeMismatchInfo({ boxCode: boxSizeCode, productCode: productSizeCode });
      setTimeout(() => setSizeMismatchInfo(null), 5000); // 5초 후 자동 제거

      // 사이즈 불일치 에러도 기록에 추가 (에러 상태)
      const scanTime = new Date().toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const sizeMismatchItem: ShipmentData = {
        box_number: selectedBox,
        order_number: normalizedOrderNumber,
        product_name: `${foundOrder.product_name} [사이즈 불일치: 박스=${boxSizeCode}, 상품=${productSizeCode}]`,
        option_name: foundOrder.option_name,
        china_options: `${foundOrder.china_option1} ${foundOrder.china_option2}`.trim(),
        scanned_qty: quantity,
        barcode: foundOrder.barcode,
        available_qty: foundOrder.available_qty,
        scan_method: scanMethod,
        scan_time: scanTime,
        is_error: true
      };

      setScanHistory(prev => [...prev, sizeMismatchItem]);

      return;
    }

    // 기존 스캔된 수량 계산 (정규화된 주문번호로 검색)
    const existingScannedQty = shipmentData
      .filter(item => item.order_number === normalizedOrderNumber)
      .reduce((sum, item) => sum + item.scanned_qty, 0);

    const newTotalScannedQty = existingScannedQty + quantity;

    // 스캔 개수 제한 체크 (빨간색 상황: 실입고개수 < 스캔개수)
    if (newTotalScannedQty > foundOrder.available_qty) {
      playErrorSound();

      // 현재 주문 정보는 표시하되 초과된 스캔개수를 보여줌 (빨간색 표시를 위해)
      setCurrentOrder(foundOrder);
      setScannedQty(newTotalScannedQty); // 초과된 개수를 표시

      // V열(product_size)에서 사이즈 코드 추출 (에러 시에도 표시)
      const sizeCode = getSizeCodeFromProductSize(foundOrder.product_size);
      setLastScannedSizeCode(sizeCode);
      console.log('에러 시 product_size에서 사이즈 코드 추출:', sizeCode);

      // 초과 스캔도 기록에 추가 (에러 상태)
      const scanTime = new Date().toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const overScanItem: ShipmentData = {
        box_number: selectedBox,
        order_number: normalizedOrderNumber,
        product_name: foundOrder.product_name,
        option_name: foundOrder.option_name,
        china_options: `${foundOrder.china_option1} ${foundOrder.china_option2}`.trim(),
        scanned_qty: quantity,
        barcode: foundOrder.barcode,
        available_qty: foundOrder.available_qty,
        scan_method: scanMethod,
        scan_time: scanTime,
        is_error: true
      };

      setScanHistory(prev => [...prev, overScanItem]);

      return;
    }

    // 성공 소리 재생 (정상 스캔)
    playSuccessSound();

    // 현재 주문 정보 설정
    setCurrentOrder(foundOrder);
    setScannedQty(newTotalScannedQty);

    // V열(product_size)에서 사이즈 코드 추출 (항상 V열에서만 가져오기)
    const sizeCode = getSizeCodeFromProductSize(foundOrder.product_size);
    setLastScannedSizeCode(sizeCode);
    console.log('product_size에서 사이즈 코드 추출:', sizeCode);

    // 쉽먼트 데이터에 추가 또는 업데이트 (정규화된 주문번호 사용)
    setShipmentData(prev => {
      console.log('현재 쉽먼트 데이터:', prev);
      console.log('검색할 박스번호:', `"${selectedBox}"`);
      console.log('검색할 주문번호 (정규화):', `"${normalizedOrderNumber}"`);

      // 동일한 박스번호-주문번호 조합 찾기 (정규화된 주문번호로)
      const existingIndex = prev.findIndex(item => {
        console.log(`비교: "${item.box_number}" === "${selectedBox}" && "${item.order_number}" === "${normalizedOrderNumber}"`);
        return item.box_number.trim() === selectedBox.trim() && item.order_number.trim() === normalizedOrderNumber.trim();
      });

      console.log('찾은 인덱스:', existingIndex);

      let updatedData;
      if (existingIndex >= 0) {
        // 기존 항목이 있으면 개수만 증가
        console.log('기존 항목 업데이트');
        updatedData = [...prev];
        updatedData[existingIndex] = {
          ...updatedData[existingIndex],
          scanned_qty: updatedData[existingIndex].scanned_qty + quantity
        };
      } else {
        // 새로운 항목 추가 (정규화된 주문번호로 저장)
        console.log('새로운 항목 추가');
        const newShipmentItem: ShipmentData = {
          box_number: selectedBox,
          order_number: normalizedOrderNumber,
          product_name: foundOrder.product_name,
          option_name: foundOrder.option_name,
          china_options: `${foundOrder.china_option1} ${foundOrder.china_option2}`.trim(),
          scanned_qty: quantity,
          barcode: foundOrder.barcode,
          available_qty: foundOrder.available_qty
        };
        updatedData = [...prev, newShipmentItem];
      }

      // 박스번호로 정렬
      const sortedData = updatedData.sort((a, b) => a.box_number.localeCompare(b.box_number));

      // 데이터 변경 시 저장 필요 상태로 변경
      setHasUnsavedChanges(true);

      return sortedData;
    });

    // 스캔 기록 추가 (시트 불러온 후의 스캔만 기록)
    const scanTime = new Date().toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const scanHistoryItem: ShipmentData = {
      box_number: selectedBox,
      order_number: normalizedOrderNumber,
      product_name: foundOrder.product_name,
      option_name: foundOrder.option_name,
      china_options: `${foundOrder.china_option1} ${foundOrder.china_option2}`.trim(),
      scanned_qty: quantity,
      barcode: foundOrder.barcode,
      available_qty: foundOrder.available_qty,
      scan_method: scanMethod,
      scan_time: scanTime
    };

    setScanHistory(prev => [...prev, scanHistoryItem]);

    console.log('주문 찾음:', foundOrder);
    console.log('쉽먼트 데이터 업데이트 완료');
    console.log('스캔 기록 추가:', scanHistoryItem);
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
            <h1 className="v2-export-title">{t('exportProduct.title')}</h1>

            {/* 상단 버튼 영역 */}
            <div className="v2-export-header-buttons">
              <div className="v2-export-left-buttons">
                {/* V2 전용 ft_users 드롭박스 — 선택 시 박스번호 prefix 자동입력 */}
                <select
                  className="v2-export-coupang-user-dropdown"
                  value={selectedFtUserId}
                  onChange={(e) => {
                    const userId = e.target.value;
                    setSelectedFtUserId(userId);
                    const user = ftUsers.find((u) => u.id === userId);
                    setBoxPrefix(user?.user_code?.toUpperCase() || '');
                  }}
                >
                  <option value="">사용자 선택</option>
                  {ftUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.user_code} {user.full_name}
                    </option>
                  ))}
                </select>
                <button
                  className={`v2-export-upload-btn ${loading ? 'loading' : isSheetLoaded ? 'loaded' : ''}`}
                  onClick={handleLoadGoogleSheet}
                  disabled={loading}
                >
                  {t('exportProduct.loadSheet')}
                </button>
              </div>
              <div className="v2-export-right-buttons">
                <button
                  className="v2-export-history-btn"
                  onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
                >
                  {t('exportProduct.record')}
                </button>
                <button
                  className={`v2-export-download-btn ${hasUnsavedChanges ? 'has-changes' : ''}`}
                  onClick={saveAllData}
                >
                  {t('exportProduct.save')}{hasUnsavedChanges ? ' !' : ''}
                </button>
              </div>
            </div>

            {/* ============================================================ */}
            {/* 박스번호 3분할 입력: [prefix] - [타입(1글자)] - [번호] */}
            {/* ============================================================ */}
            <div className="v2-export-barcode-section">
              <div className="v2-export-box-row">
                {/* 1) prefix — ft_users.user_code 자동입력 */}
                <input
                  type="text"
                  placeholder="코드"
                  className="v2-export-box-input v2-export-box-prefix"
                  value={boxPrefix}
                  onChange={(e) => setBoxPrefix(e.target.value.replace(/\s/g, '').toUpperCase())}
                  style={{ textTransform: 'uppercase' }}
                />
                <span className="v2-export-box-divider">-</span>

                {/* 2) 박스 타입 — 한/영 무관 1글자, 대문자 자동 변환, 입력 즉시 다음 폼 이동 */}
                <input
                  ref={boxTypeInputRef}
                  type="text"
                  placeholder="타입"
                  className="v2-export-box-input v2-export-box-type"
                  value={boxType}
                  maxLength={1}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\s/g, '');
                    if (raw.length === 0) {
                      setBoxType('');
                      return;
                    }
                    const char = raw.slice(-1).toUpperCase();
                    setBoxType(char);
                    // 1글자 입력 즉시 다음 입력폼으로 포커스 이동
                    setTimeout(() => boxSeqInputRef.current?.focus(), 0);
                  }}
                  style={{ textTransform: 'uppercase' }}
                />
                <span className="v2-export-box-divider">-</span>

                {/* 3) 박스 일련번호 */}
                <input
                  ref={boxSeqInputRef}
                  type="text"
                  placeholder="번호"
                  className="v2-export-box-input v2-export-box-seq"
                  value={boxSeq}
                  onChange={(e) => setBoxSeq(e.target.value.replace(/\s/g, '').toUpperCase())}
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              {/* ============================================================ */}
              {/* 박스크기 영역: [직접입력] | [프리셋 150] [145] [120] */}
              {/* ============================================================ */}
              <div className="v2-export-box-row">
                {/* 박스크기 직접 입력 (왼쪽) */}
                <input
                  type="text"
                  placeholder="박스크기"
                  className="v2-export-custom-size-input"
                  value={customBoxSize}
                  onFocus={() => setSelectedPresetSize('')}
                  onChange={(e) => {
                    setCustomBoxSize(e.target.value);
                    setSelectedPresetSize('');
                    setSelectedSize(e.target.value);
                  }}
                />

                {/* 프리셋 크기 버튼 3개 */}
                {[
                  { label: '150', size: '60*50*40' },
                  { label: '145', size: '50*50*45' },
                  { label: '120', size: '50*40*30' },
                ].map(({ label, size }) => (
                  <button
                    key={label}
                    className={`v2-export-size-preset-btn ${selectedPresetSize === size ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedPresetSize(size);
                      setCustomBoxSize('');
                      setSelectedSize(size);
                    }}
                  >
                    {label} {size}
                  </button>
                ))}
              </div>
            </div>

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
                  onChange={(e) => setBoardBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const barcode = boardBarcodeInput.trim();
                      if (barcode) {
                        handleBoardScan(barcode);
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
                style={{ width: '100%', height: '100%' }}
              >
                {loading ? (
                  <div className="v2-export-scan-info">
                    <p>데이터 로딩 중...</p>
                  </div>
                ) : currentOrder ? (
                  <div className="v2-export-order-display">
                    {/* 첫 번째: 이미지 */}
                    <div className="v2-export-order-image">
                      {currentOrder.image_url ? (
                        <img
                          src={`/api/image-proxy?url=${encodeURIComponent(currentOrder.image_url)}`}
                          alt="상품 이미지"
                          className="v2-export-product-image"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/placeholder.svg';
                          }}
                        />
                      ) : (
                        <div className="v2-export-no-image">이미지 없음</div>
                      )}
                    </div>

                    {/* 두 번째: 주문정보 */}
                    <div className="v2-export-order-info">
                      <div className="v2-export-order-number">
                        {currentOrder.order_number}
                      </div>
                      <div className="v2-export-order-options">
                        {currentOrder.china_option1} {currentOrder.china_option2}
                      </div>
                    </div>

                    {/* 세 번째: 수량 정보 */}
                    <div className="v2-export-order-quantity">
                      <div className="v2-export-qty-display">
                        <div className="v2-export-qty-row">
                          <div className={`v2-export-qty-circle ${
                            scannedQty >= currentOrder.available_qty && scannedQty > 0 ?
                              (scannedQty === currentOrder.available_qty ? 'completed' : 'exceeded') :
                            scannedQty > 0 && scannedQty < currentOrder.available_qty ? 'scanned' : 'default'
                          }`}>
                            {scannedQty}/{currentOrder.available_qty}
                          </div>
                          {lastScannedSizeCode && (
                            <>
                              <div className="v2-export-size-arrow">⇒</div>
                              <div className={`v2-export-size-code v2-export-size-code-${lastScannedSizeCode.toLowerCase()}`}>
                                {lastScannedSizeCode}
                              </div>
                            </>
                          )}
                        </div>
                        {selectedBox && (
                          <div className="v2-export-box-info-line">
                            <span className="v2-export-info-item">📦 {shipmentData.filter(item => item.box_number === selectedBox).length}</span>
                            <span className="v2-export-info-item">🚀 {scannedQty}</span>
                            <span className="v2-export-info-item">🎯 {currentOrder.available_qty}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="v2-export-scan-info">
                    {sizeMismatchInfo ? (
                      <div className="v2-export-size-mismatch-warning">
                        <div className="v2-export-mismatch-title">⚠️ 사이즈 코드 불일치!</div>
                        <div className="v2-export-mismatch-codes">
                          <div className="v2-export-mismatch-box">
                            <span className="v2-export-mismatch-label">박스:</span>
                            <span className={`v2-export-size-code v2-export-size-code-${sizeMismatchInfo.boxCode.toLowerCase()}`}>
                              {sizeMismatchInfo.boxCode}
                            </span>
                          </div>
                          <div className="v2-export-mismatch-arrow">→</div>
                          <div className="v2-export-mismatch-product">
                            <span className="v2-export-mismatch-label">올바른 코드:</span>
                            <span className={`v2-export-size-code-large v2-export-size-code-${sizeMismatchInfo.productCode.toLowerCase()}`}>
                              {sizeMismatchInfo.productCode}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p>{t('exportProduct.enterOrderNumber')}</p>
                        <p className="v2-export-caps-warning">키보드가 대문자 인지 확인해주세요</p>
                        {orderData.length > 0 && (
                          <p className="v2-export-data-status">
                            로드된 주문: {orderData.length}개
                          </p>
                        )}
                      </>
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
                      placeholder={t('exportProduct.enterOrderNumber')}
                      className="v2-export-barcode-input"
                      value={barcodeInput}
                      disabled={!canActivateBoards}
                      onChange={(e) => {
                        setBarcodeInput(e.target.value);
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
                  <th className="v2-export-product-name-column">상품명</th>
                  <th>출고</th>
                  <th>입고</th>
                </tr>
              </thead>
              <tbody>
                {shipmentData.length === 0 ? (
                  <tr><td colSpan={6} className="v2-export-empty-data">데이터 없음</td></tr>
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
                        <td>{item.product_name}</td>
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
