'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import './ExportProduct.css';

// 스캔 대상 데이터 구조 (메모리에 로드될 데이터)
interface ScanTargetData {
  barcode: string;
  img_url: string | null;
  product_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  available_qty: number; // import_qty - export_qty 값
}

interface ShipmentData {
  id: string;
  box_number: string;
  barcode: string;
  product_name: string;
  order_option: string;
  quantity: number;
}

const ExportProduct: React.FC = () => {
  const router = useRouter();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [quantityInput, setQuantityInput] = useState('');
  const [selectedBox, setSelectedBox] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [scanTargetData, setScanTargetData] = useState<ScanTargetData[]>([]); // 스캔 대상 데이터
  const [currentScannedItem, setCurrentScannedItem] = useState<ScanTargetData | null>(null); // 현재 스캔된 아이템
  const [loading, setLoading] = useState(true);
  const [alertMessage, setAlertMessage] = useState('');
  const [showAlert, setShowAlert] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  // 편집 상태 관리 (쉽먼트 테이블용)
  const [editingState, setEditingState] = useState<{
    type: 'shipment' | null;
    id: string | null;
    value: string;
  }>({ type: null, id: null, value: '' });
  const [shipmentData, setShipmentData] = useState<ShipmentData[]>([]);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  
  // 데이터 변경 추적을 위한 state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // 네비게이션 확인 모달 상태
  const [showNavigationModal, setShowNavigationModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  
  // 오디오 알림 기능
  const playErrorSound = () => {
    try {
      const audio = new Audio();
      audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBzSH0fPVeSMFl2++7dWENAcnXNX6vHUTBCuP2eWUPwgOe9Dy05ZBDB2k4d2iYRMFz5zQ7dKROQoVZKXs26Zcc2EXE+K13nLOgyQFPpvb8cJ1JgUui9Dy0oU2CJBxsO3P2GsgA5mD++1XFhZEyPD52EvTfU2QYXE3JEwXI2Uw87fYXi6Xm/qzaxEXlJ/WbNKpOghCpOjQkREQa7jqwIE3CCaF2+nTfTEFKIjR8dGCNAg2jNXxy3QjBCeG0fHIeiUFLZLF8dOCNAgzkMzy04A4CQ1Qp+PwtmMcBzSH0fPVeSMFl2++7dWENAcnXNX6vHUTBCuP2eWUPwgOe9Dy05ZBDB2k4d2iYRMFz5zQ7dKROQoVZKXs26JcBnQg7/0eaZKNtY/9c3Ug0miwVF6CcaD+7dyRNwgVWrzq04A2CCy';
      audio.volume = 0.5;
      audio.play().catch(e => console.log('Audio play failed:', e));
    } catch (error) {
      console.log('Audio creation failed:', error);
    }
  };

  // 쉽먼트 데이터 저장 함수
  const saveAllData = async () => {
    try {
      // 쉽먼트 데이터 저장
      const hasShipmentData = selectedBox && shipmentData.length > 0;
      if (hasShipmentData) {
        const currentBoxData = shipmentData.filter(item => item.box_number === selectedBox);
        if (currentBoxData.length > 0) {
          await saveShipmentData();
          
          // 저장 후 스캔 대상 데이터 새로 로드 (서버에 저장된 최신 상태 반영)
          await loadScanTargetData();
          
          setHasUnsavedChanges(false);
          return true;
        }
      }

      showToastNotification('저장할 데이터가 없습니다.');
      return false;
      
    } catch (error) {
      console.error('데이터 저장 오류:', error);
      showToastNotification('데이터 저장 중 오류가 발생했습니다.');
      return false;
    }
  };

  // 동기적 저장 함수 (페이지 떠나기 전용)
  const saveDataSync = () => {
    // 쉽먼트 데이터 동기 저장
    if (selectedBox && shipmentData.length > 0) {
      const currentBoxData = shipmentData.filter(item => item.box_number === selectedBox);
      if (currentBoxData.length > 0) {
        const shipmentPayload = currentBoxData.map(item => ({
          box: item.box_number,
          barcode: item.barcode,
          product_name: item.product_name,
          option_name: item.order_option,
          qty: item.quantity
        }));
        
        const payload = JSON.stringify({ shipmentData: shipmentPayload });
        navigator.sendBeacon('/api/save-shipment-data', new Blob([payload], { type: 'application/json' }));
      }
    }
  };

  // 네비게이션 확인 및 저장 처리
  const handleNavigationConfirm = async (save: boolean) => {
    if (save) {
      await saveAllData();
    }
    
    setShowNavigationModal(false);
    
    if (pendingNavigation) {
      // 실제 네비게이션 실행
      router.push(pendingNavigation);
      setPendingNavigation(null);
    }
  };

  // 네비게이션 인터셉트 함수
  const interceptNavigation = (href: string) => {
    // 저장되지 않은 변경사항이 있는지 확인
    const hasUnsavedData = hasUnsavedChanges || 
      (selectedBox && shipmentData.length > 0);

    if (hasUnsavedData) {
      // 네비게이션을 일시 중단하고 확인 모달 표시
      setPendingNavigation(href);
      setShowNavigationModal(true);
      return false; // 네비게이션 중단
    }
    
    return true; // 네비게이션 허용
  };

  // 페이지 떠나기 전 저장 처리
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 저장되지 않은 변경사항이 있는 경우
      if (hasUnsavedChanges || (selectedBox && shipmentData.length > 0)) {
        
        // 동기적 저장 실행
        saveDataSync();
        
        // 브라우저 경고 메시지 표시
        e.preventDefault();
        e.returnValue = '저장되지 않은 변경사항이 있습니다. 페이지를 떠나시겠습니까?';
        return e.returnValue;
      }
    };

    // 페이지 숨김 처리 (브라우저가 닫히거나 탭이 변경될 때)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (hasUnsavedChanges || (selectedBox && shipmentData.length > 0)) {
          saveDataSync();
        }
      }
    };

    // Link 클릭 감지를 위한 이벤트 리스너
    const handleLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a[href]') as HTMLAnchorElement;
      
      if (link && link.href && !link.href.includes('/export-product')) {
        // 현재 페이지가 아닌 다른 페이지로의 내비게이션
        const hasUnsavedData = hasUnsavedChanges || 
          (selectedBox && shipmentData.length > 0);

        if (hasUnsavedData) {
          e.preventDefault();
          setPendingNavigation(link.href);
          setShowNavigationModal(true);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('click', handleLinkClick, true); // capture phase에서 처리

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('click', handleLinkClick, true);
    };
  }, [hasUnsavedChanges, shipmentData, selectedBox]);

  // 스캔 대상 데이터 로딩 (import_qty - export_qty > 0인 데이터만)
  const loadScanTargetData = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/get-scan-targets', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('스캔 대상 데이터를 불러오는데 실패했습니다.');
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        setScanTargetData(result.data);
        showToastNotification(`스캔 대상 ${result.data.length}개 로드 완료`);
      } else {
        setScanTargetData([]);
        showToastNotification('스캔 대상 데이터가 없습니다.');
      }
      
    } catch (error) {
      console.error('스캔 대상 데이터 로딩 오류:', error);
      setScanTargetData([]);
      showToastNotification('데이터 로딩에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 박스별 쉽먼트 데이터 조회
  const fetchShipmentDataByBox = async (boxNumber: string) => {
    if (!boxNumber) {
      setShipmentData([]);
      return;
    }

    try {
      const response = await fetch(`/api/get-shipment-data-by-box?box=${encodeURIComponent(boxNumber)}`, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        cache: 'no-store'
      });

      if (!response.ok) {
        setShipmentData([]);
        return;
      }
      
      const result = await response.json();
      
      if (result.success && result.data && result.data.length > 0) {
        const formattedData = result.data.map((item: any) => ({
          id: `${item.box}-${item.barcode}`,
          box_number: item.box,
          barcode: item.barcode,
          product_name: item.product_name || '',
          order_option: item.option_name || '',
          quantity: item.qty
        }));
        
        setShipmentData(formattedData);
      } else {
        setShipmentData([]);
      }
    } catch (error) {
      console.error('박스별 쉽먼트 데이터 로드 오류:', error);
      setShipmentData([]);
    }
  };

  useEffect(() => {
    loadScanTargetData();
  }, []);

  // 박스 선택 변경시 이전 박스 데이터 저장 후 새 박스 데이터 로드
  const handleBoxChange = async (boxNumber: string) => {
    try {
      // 이전 박스에 데이터가 있으면 자동 저장
      if (selectedBox && shipmentData.length > 0) {
        const currentBoxData = shipmentData.filter(item => item.box_number === selectedBox);
        
        if (currentBoxData.length > 0) {
          const shipmentPayload = currentBoxData.map(item => ({
            box: item.box_number,
            barcode: item.barcode,
            product_name: item.product_name,
            option_name: item.order_option,
            qty: item.quantity
          }));
          
          const response = await fetch('/api/save-shipment-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shipmentData: shipmentPayload }),
          });

          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              showToastNotification(`${selectedBox} 데이터가 자동 저장되었습니다.`);
            }
          } else {
            console.error('박스 변경시 자동 저장 실패');
            showToastNotification('이전 박스 데이터 저장에 실패했습니다.');
          }
        }
      }
      
      // 새 박스 설정
      setSelectedBox(boxNumber);
      
      // UI 상태 초기화
      setShipmentData([]);
      setCurrentScannedItem(null); // 가운데 보드 초기화
      setHasUnsavedChanges(false);
      
      // 스캔 대상 데이터 새로 로드 (서버에서 최신 데이터 가져오기)
      await loadScanTargetData();
      
      // 새 박스의 쉽먼트 데이터 로드
      if (boxNumber) {
        await fetchShipmentDataByBox(boxNumber);
      }
      
    } catch (error) {
      console.error('박스 변경 처리 중 오류:', error);
      showToastNotification('박스 변경 처리 중 오류가 발생했습니다.');
    }
  };

  // 알림 모달 표시 함수 (바코드 스캔 관련 오류)
  const showAlertModal = (message: string) => {
    playErrorSound(); // 오류 소리 재생
    setAlertMessage(message);
    setShowAlert(true);
    setTimeout(() => {
      setShowAlert(false);
    }, 2000);
  };

  // 토스트 알림 표시 함수 (저장 성공 등)
  const showToastNotification = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 3000);
  };


  // 쉽먼트 데이터 DB에 저장 (저장 버튼 클릭시만)
  const saveShipmentData = async () => {
    // 현재 선택된 박스의 데이터만 저장
    const currentBoxData = shipmentData.filter(item => item.box_number === selectedBox);
    
    if (currentBoxData.length === 0) {
      showToastNotification('저장할 쉽먼트 데이터가 없습니다.');
      return;
    }
    
    if (!selectedBox) {
      showToastNotification('박스를 선택해주세요.');
      return;
    }

    try {
      // 현재 박스 데이터만 1688_shipment 테이블에 맞게 변환
      const shipmentPayload = currentBoxData.map(item => ({
        box: item.box_number,
        barcode: item.barcode,
        product_name: item.product_name,
        option_name: item.order_option,
        qty: item.quantity
      }));
      
      const response = await fetch('/api/save-shipment-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentData: shipmentPayload }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API 응답 오류:', errorText);
        throw new Error('쉽먼트 데이터 저장에 실패했습니다.');
      }
      
      const result = await response.json();
      if (result.success) {
        showToastNotification(`박스 ${selectedBox} 쉽먼트 데이터 ${currentBoxData.length}개가 저장되었습니다.`);
        
        // 저장 후 현재 박스 데이터 다시 로드
        if (selectedBox) {
          await fetchShipmentDataByBox(selectedBox);
        }
      } else {
        throw new Error(result.error || '저장 실패');
      }
      
    } catch (error) {
      console.error('쉽먼트 데이터 저장 오류:', error);
      showToastNotification('쉽먼트 데이터 저장에 실패했습니다.');
    }
  };

  // 바코드 스캔시 쉽먼트 테이블에 추가/수량증가 (통합 함수)
  const addToShipmentTable = (barcode: string, targetItem: ScanTargetData) => {
    if (!selectedBox) return;
    
    const existingIndex = shipmentData.findIndex(
      item => item.box_number === selectedBox && item.barcode === barcode
    );
    
    if (existingIndex !== -1) {
      // 기존 항목 수량 +1
      const oldQty = shipmentData[existingIndex].quantity;
      const newQty = oldQty + 1;
      
      setShipmentData(prev => 
        prev.map((item, index) => 
          index === existingIndex 
            ? { ...item, quantity: newQty }
            : item
        )
      );
      
      // 데이터 변경 상태 업데이트
      setHasUnsavedChanges(true);
    } else {
      // 새 항목 추가
      const productName = [targetItem.product_name, targetItem.option_name].filter(Boolean).join('\n');
      const orderOption = [targetItem.china_option1, targetItem.china_option2].filter(Boolean).join('\n');
      
      const newItem: ShipmentData = {
        id: `${selectedBox}-${barcode}`,
        box_number: selectedBox,
        barcode: barcode,
        product_name: productName,
        order_option: orderOption,
        quantity: 1
      };
      
      setShipmentData(prev => [...prev, newItem]);
      
      // 데이터 변경 상태 업데이트
      setHasUnsavedChanges(true);
    }

    // 현재 스캔된 아이템의 available_qty를 실시간으로 감소
    if (currentScannedItem && currentScannedItem.barcode === barcode) {
      setCurrentScannedItem(prev => 
        prev ? { ...prev, available_qty: Math.max(0, prev.available_qty - 1) } : null
      );
    }

    // 스캔 대상 데이터에서도 해당 바코드의 available_qty 감소
    setScanTargetData(prev => 
      prev.map(item => 
        item.barcode === barcode 
          ? { ...item, available_qty: Math.max(0, item.available_qty - 1) }
          : item
      )
    );
  };




  // 바코드 입력 초기화 및 포커스
  const resetBarcodeInput = () => {
    setBarcodeInput('');
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 10);
  };



  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const currentBarcode = barcodeInput.trim();
    
    // 입력 검증
    if (!currentBarcode) {
      showAlertModal('바코드를 입력해주세요.');
      return;
    }
    if (!selectedBox) {
      showAlertModal('박스를 먼저 선택해주세요.');
      return;
    }

    // 메모리에 로드된 스캔 대상 데이터에서 바코드 찾기
    const targetItem = scanTargetData.find(item => 
      item.barcode === currentBarcode && item.available_qty > 0
    );

    if (!targetItem) {
      showAlertModal('조회되지 않거나 출고 완료된 바코드입니다.');
      setCurrentScannedItem(null); // 스캔 실패시 보드 초기화
      resetBarcodeInput();
      return;
    }

    // 가운데 보드에 스캔된 아이템 정보 표시
    setCurrentScannedItem(targetItem);
    
    // 쉽먼트 테이블에 추가
    addToShipmentTable(currentBarcode, targetItem);
    resetBarcodeInput();
  };



  // 편집 가능한 수량 셀 컴포넌트 (쉽먼트 테이블 전용)
  const EditableQuantityCell: React.FC<{
    value: number;
    isEditing: boolean;
    onStartEdit: () => void;
    onFinishEdit: () => void;
    onCancel: () => void;
  }> = ({ value, isEditing, onStartEdit, onFinishEdit, onCancel }) => {
    if (isEditing) {
      return (
        <input
          type="number"
          value={editingState.value}
          onChange={(e) => setEditingState(prev => ({ ...prev, value: e.target.value }))}
          onBlur={onFinishEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFinishEdit();
            if (e.key === 'Escape') onCancel();
          }}
          className="export-qty-input"
          autoFocus
        />
      );
    }
    
    return (
      <span 
        onClick={onStartEdit}
        className="export-qty-value"
      >
        {value}
      </span>
    );
  };


  // 편집 취소 (통합)
  const cancelEdit = () => {
    setEditingState({ type: null, id: null, value: '' });
  };


  // 쉬먼트 개수 편집 시작
  const startEditShipment = (item: ShipmentData) => {
    setEditingState({
      type: 'shipment',
      id: item.id,
      value: String(item.quantity)
    });
  };

  // 쉬먼트 개수 편집 완료
  const finishEditShipment = async (itemId: string) => {
    const newValue = parseInt(editingState.value) || 0;
    const targetItem = shipmentData.find(item => item.id === itemId);
    
    if (!targetItem) {
      showToastNotification('항목을 찾을 수 없습니다.');
      setEditingState({ type: null, id: null, value: '' });
      return;
    }

    const oldQuantity = targetItem.quantity;
    const quantityDiff = newValue - oldQuantity; // 변경된 수량 차이

    try {
      if (newValue <= 0) {
        // 0 이하가 되면 해당 행 삭제 (DB에서도 삭제)
        const response = await fetch('/api/update-shipment-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'delete',
            itemData: {
              box_number: targetItem.box_number,
              barcode: targetItem.barcode
            }
          }),
        });

        if (!response.ok) {
          throw new Error('쉽먼트 삭제에 실패했습니다.');
        }

        const result = await response.json();
        if (result.success) {
          setShipmentData(prev => prev.filter(item => item.id !== itemId));
          
          // 삭제된 수량만큼 스캔 가능 개수 증가
          updateAvailableQty(targetItem.barcode, oldQuantity);
          
          showToastNotification('쉽먼트 항목이 삭제되었습니다.');
        } else {
          throw new Error(result.error || '삭제 실패');
        }
      } else {
        // 개수 업데이트 (DB에도 저장)
        const response = await fetch('/api/update-shipment-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'update',
            itemData: {
              box_number: targetItem.box_number,
              barcode: targetItem.barcode,
              quantity: newValue
            }
          }),
        });

        if (!response.ok) {
          throw new Error('쉽먼트 수정에 실패했습니다.');
        }

        const result = await response.json();
        if (result.success) {
          setShipmentData(prev => prev.map(item => 
            item.id === itemId 
              ? { ...item, quantity: newValue }
              : item
          ));
          
          // 수량 변경에 따른 스캔 가능 개수 업데이트 (음수 = 증가, 양수 = 감소)
          updateAvailableQty(targetItem.barcode, -quantityDiff);
          
          showToastNotification('쉽먼트 개수가 수정되었습니다.');
        } else {
          throw new Error(result.error || '수정 실패');
        }
      }
    } catch (error) {
      console.error('쉽먼트 업데이트 오류:', error);
      showToastNotification('업데이트에 실패했습니다.');
    }
    
    setEditingState({ type: null, id: null, value: '' });
  };

  // 스캔 가능 개수 업데이트 헬퍼 함수
  const updateAvailableQty = (barcode: string, qtyChange: number) => {
    // 현재 스캔된 아이템의 available_qty 업데이트
    if (currentScannedItem && currentScannedItem.barcode === barcode) {
      setCurrentScannedItem(prev => 
        prev ? { ...prev, available_qty: Math.max(0, prev.available_qty + qtyChange) } : null
      );
    }

    // 스캔 대상 데이터에서도 해당 바코드의 available_qty 업데이트
    setScanTargetData(prev => 
      prev.map(item => 
        item.barcode === barcode 
          ? { ...item, available_qty: Math.max(0, item.available_qty + qtyChange) }
          : item
      )
    );
  };

  // 쉬먼트 개수 편집 취소
  const cancelEditShipment = () => {
    setEditingState({ type: null, id: null, value: '' });
  };




  return (
    <div className="export-layout">
      <TopsideMenu />
      <div className="export-main-content">
        <LeftsideMenu />
        <main className="export-content">
          <div className="export-container">
            <h1 className="export-title">상품 출고</h1>
            
            {/* 상단 버튼 영역 */}
            <div className="export-header-buttons">
              <div className="export-left-buttons">
                <button className="export-upload-btn">바코드 스캔</button>
              </div>
              <div className="export-right-buttons">
                <button className="export-download-btn" onClick={saveAllData}>
                  저장 {hasUnsavedChanges && <span style={{color: 'red'}}>●</span>}
                </button>
              </div>
            </div>

            {/* 바코드 입력 영역 */}
            <div className="export-barcode-section">
              <div className="export-barcode-board">
                {/* 첫 번째 줄: 드롭박스들 */}
                <div className="export-dropdown-row">
                  <select 
                    className="export-box-dropdown"
                    value={selectedBox}
                    onChange={(e) => handleBoxChange(e.target.value)}
                  >
                    <option value="">박스 선택</option>
                    {Array.from({length: 30}, (_, i) => (
                      <option key={i+1} value={`Box ${i+1}`}>Box {i+1}</option>
                    ))}
                  </select>
                  
                  <select 
                    className="export-size-dropdown"
                    value={selectedSize}
                    onChange={(e) => setSelectedSize(e.target.value)}
                  >
                    <option value="">크기 선택</option>
                    <option value="극소">극소</option>
                    <option value="소">소</option>
                    <option value="중">중</option>
                    <option value="대1">대1</option>
                    <option value="대2">대2</option>
                    <option value="이형">이형</option>
                  </select>
                </div>

                {/* 두 번째 줄: 입력폼과 버튼 */}
                <div className="export-input-row">
                  <input 
                    ref={barcodeInputRef}
                    type="text" 
                    placeholder="바코드를 입력하세요" 
                    className="export-barcode-input"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleScan(e);
                      }
                    }}
                    autoFocus
                  />
                  <input 
                    type="number" 
                    placeholder="개수" 
                    className="export-quantity-input"
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(e.target.value)}
                  />
                  <button className="export-scan-button" onClick={handleScan}>스캔</button>
                </div>
              </div>
            </div>


            {/* 스캔 정보 보드 */}
            <div className="export-table-board">
              <div className="export-scan-board">
                {loading ? (
                  <div className="export-scan-info">
                    <p>스캔 대상 데이터 로딩 중...</p>
                  </div>
                ) : currentScannedItem ? (
                  <div className="export-scanned-item">
                    {/* 이미지 영역 */}
                    <div className="export-scanned-image">
                      {currentScannedItem.img_url ? (
                        <img 
                          src={currentScannedItem.img_url} 
                          alt="상품 이미지" 
                          className="export-product-image"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                            const parent = img.parentElement;
                            if (parent) {
                              parent.innerHTML = '<div class="export-no-image">이미지 없음</div>';
                            }
                          }}
                        />
                      ) : (
                        <div className="export-no-image">이미지 없음</div>
                      )}
                    </div>
                    
                    {/* 상품명 및 중국 옵션 영역 */}
                    <div className="export-product-info">
                      <div className="export-product-title">
                        {[currentScannedItem.product_name, currentScannedItem.option_name]
                          .filter(Boolean)
                          .join(' ')}
                      </div>
                      <div className="export-china-options">
                        <div className="export-china-option1">
                          {currentScannedItem.china_option1 || '-'}
                        </div>
                        <div className="export-china-option2">
                          {currentScannedItem.china_option2 || '-'}
                        </div>
                      </div>
                    </div>
                    
                    {/* 스캔 가능 수량 영역 */}
                    <div className="export-scan-qty">
                      <div className={`export-qty-number ${
                        currentScannedItem.available_qty < 5 ? 'danger' : 
                        currentScannedItem.available_qty < 10 ? 'warning' : ''
                      }`}>
                        {currentScannedItem.available_qty}
                      </div>
                      <div className="export-qty-label">스캔 가능</div>
                    </div>
                  </div>
                ) : (
                  <div className="export-scan-info">
                    <p>스캔 대상 {scanTargetData.length}개 로드 완료</p>
                    <p>바코드를 스캔해주세요</p>
                  </div>
                )}
              </div>
            </div>

            {/* 쉽먼트 테이블 */}
            <div className="export-shipment-section">
              <h3 className="export-shipment-title">쉽먼트</h3>
              <div className="export-table-board">
                <table className="export-table">
                  <thead>
                    <tr>
                      <th>박스번호</th>
                      <th>바코드</th>
                      <th>상품명</th>
                      <th>주문옵션</th>
                      <th>개수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipmentData.length === 0 ? (
                      <tr><td colSpan={5} className="export-empty-data">데이터 없음</td></tr>
                    ) : (
                      shipmentData.map((item) => (
                        <tr key={item.id}>
                          <td>{item.box_number}</td>
                          <td>{item.barcode}</td>
                          <td style={{ whiteSpace: 'pre-line' }}>{item.product_name}</td>
                          <td style={{ whiteSpace: 'pre-line' }}>{item.order_option}</td>
                          <td className="export-qty-cell">
                            <EditableQuantityCell
                              value={item.quantity}
                              isEditing={editingState.type === 'shipment' && editingState.id === item.id}
                              onStartEdit={() => startEditShipment(item)}
                              onFinishEdit={() => finishEditShipment(item.id)}
                              onCancel={cancelEdit}
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* 알림 모달 */}
      {showAlert && (
        <div className="export-alert-modal">
          <div className="export-alert-content">
            {alertMessage}
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {showToast && (
        <div className="export-toast-notification">
          {toastMessage}
        </div>
      )}

      {/* 네비게이션 확인 모달 */}
      {showNavigationModal && (
        <div className="export-alert-modal" style={{ zIndex: 9999 }}>
          <div className="export-alert-content" style={{ padding: '20px', minWidth: '300px' }}>
            <h3 style={{ marginBottom: '15px', color: '#333' }}>저장되지 않은 변경사항</h3>
            <p style={{ marginBottom: '20px', lineHeight: '1.5' }}>
              저장되지 않은 데이터가 있습니다.<br />
              저장하고 이동하시겠습니까?
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => handleNavigationConfirm(false)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #ddd',
                  background: '#f5f5f5',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                저장하지 않고 이동
              </button>
              <button 
                onClick={() => handleNavigationConfirm(true)}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  background: '#007bff',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                저장하고 이동
              </button>
              <button 
                onClick={() => {
                  setShowNavigationModal(false);
                  setPendingNavigation(null);
                }}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #ddd',
                  background: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportProduct;