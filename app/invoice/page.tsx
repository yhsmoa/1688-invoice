'use client';

import React, { useRef, useState, useEffect } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import Card from '../../component/Card';
import SearchForm from '../../component/SearchForm';
import './InvoiceSave.css';

// 디바운스 함수 구현
const debounce = <F extends (...args: any[]) => any>(
  func: F,
  waitFor: number
) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<F>): Promise<ReturnType<F>> => {
    if (timeout) {
      clearTimeout(timeout);
    }

    return new Promise(resolve => {
      timeout = setTimeout(() => {
        resolve(func(...args));
      }, waitFor);
    });
  };
};

interface InvoiceData {
  id: string;
  order_number: string;
  delivery_fee: number | null;
  delivery_number: string | null;
  delivery_number1: string | null;
  delivery_number2: string | null;
  delivery_number3: string | null;
  delivery_number4: string | null;
  delivery_number5: string | null;
  invoice: string | null;
  order_date: string | null;
  payment_date: string | null;
  price: number | null;
  product_name: string | null;
  seller: string | null;
  total_price: number | null;
  order_qty: number | null;
  unit_price: number | null;
  offer_id: string | null;
  sku_id: string | null; // SKU ID 추가
  img_upload: boolean;
  file_extension: string | null;
  received_qty: number | null;
  memo: string | null;
  category: string | null;
  composition: string | null;
  order_status: string | null;
  note?: string; // 메모 추가
}

const InvoiceSave: React.FC = () => {
  const cardData = ['전체', '결제대기', '배송대기', '수령대기', '환불중', '평가대기'];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptFileInputRef = useRef<HTMLInputElement>(null);
  const [invoiceData, setInvoiceData] = useState<InvoiceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<InvoiceData | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState<InvoiceData[]>([]);
  const [originalData, setOriginalData] = useState<InvoiceData[]>([]);
  const [activeStatus, setActiveStatus] = useState<string>('전체');
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<{ [key: string]: string }>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);

  // 메모 저장 함수
  const saveNote = async (orderNumber: string, note: string) => {
    if (savingNote === orderNumber) return;
    
    try {
      setSavingNote(orderNumber);
      
      const response = await fetch('/api/save-invoice-note', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderNumber, note }),
      });

      if (response.ok) {
        // 로컬 상태 업데이트
        setNoteText(prev => ({
          ...prev,
          [orderNumber]: note
        }));
        
        // 필터링된 데이터 업데이트
        setFilteredData(prev => 
          prev.map(item => 
            item.order_number === orderNumber ? { ...item, note } : item
          )
        );
        
        // 전체 데이터 업데이트
        setInvoiceData(prev => 
          prev.map(item => 
            item.order_number === orderNumber ? { ...item, note } : item
          )
        );
        
        setEditingNote(null);
      } else {
        const errorData = await response.json();
        console.error('메모 저장 실패:', errorData);
        alert('메모 저장 중 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('메모 저장 오류:', error);
      alert('메모 저장 중 오류가 발생했습니다.');
    } finally {
      setSavingNote(null);
    }
  };
  
  // 디바운스된 저장 함수 생성 (500ms 지연)
  const debouncedSaveNote = debounce(saveNote, 500);
  
  // 메모 편집 시작
  const startEditingNote = (orderNumber: string) => {
    setEditingNote(orderNumber);
    // 기존 메모가 있으면 가져오고, 없으면 빈 문자열로 설정
    const currentNote = noteText[orderNumber] || '';
    setNoteText(prev => ({
      ...prev,
      [orderNumber]: currentNote
    }));
  };
  
  // 메모 텍스트 변경 처리
  const handleNoteChange = (orderNumber: string, value: string) => {
    setNoteText(prev => ({
      ...prev,
      [orderNumber]: value
    }));
  };

  // 데이터 가져오기
  const fetchInvoiceData = async () => {
    console.log('fetchInvoiceData 시작');
    try {
      setLoading(true);
      const response = await fetch('/api/get-invoices', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      console.log('API 응답 상태:', response.ok);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API 오류 응답:', errorText);
        throw new Error(`API 오류: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('받은 데이터 길이:', data.length);
      console.log('받은 데이터 샘플:', data.slice(0, 2));
      
      // 원본 데이터 저장 (중복 제거 전)
      setOriginalData(data);
      
      // order_number로 그룹화하여 중복 제거
      // img_upload가 true인 항목을 우선적으로 선택
      const uniqueData = data.reduce((acc: InvoiceData[], current: InvoiceData) => {
        const existingIndex = acc.findIndex(item => item.order_number === current.order_number);
        if (existingIndex === -1) {
          // 첫 번째 항목이면 추가
          acc.push(current);
        } else {
          // 이미 존재하는 경우, img_upload가 true인 것을 우선 선택
          const existing = acc[existingIndex];
          if (current.img_upload && !existing.img_upload) {
            // 현재 항목이 img_upload가 true이고 기존 항목이 false면 교체
            acc[existingIndex] = current;
          } else if (current.img_upload === existing.img_upload) {
            // 둘 다 같은 상태면 최신 것으로 교체 (나중에 추가된 것이 더 최신)
            acc[existingIndex] = current;
          }
          // existing이 true이고 current가 false면 기존 것 유지 (변경 없음)
        }
        return acc;
      }, []);
      
      console.log('중복 제거 후 데이터 길이:', uniqueData.length);
      console.log('중복 제거 후 샘플:', uniqueData.slice(0, 2));
      
      // 메모 데이터 가져오기
      try {
        const noteResponse = await fetch('/api/get-invoice-notes', {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
          },
          cache: 'no-store'
        });
        
        if (noteResponse.ok) {
          const noteData = await noteResponse.json();
          console.log('메모 데이터 길이:', noteData.length);
          
          // 메모 데이터를 주문 데이터에 병합
          const notesMap: {[key: string]: string} = {};
          noteData.forEach((note: {order_number: string, note: string}) => {
            notesMap[note.order_number] = note.note;
          });
          
          // noteText 상태 업데이트
          setNoteText(notesMap);
          
          // 주문 데이터에 메모 추가
          uniqueData.forEach((item: InvoiceData) => {
            if (notesMap[item.order_number]) {
              item.note = notesMap[item.order_number];
            }
          });
        }
      } catch (noteError) {
        console.error('메모 데이터 가져오기 오류:', noteError);
      }

      setInvoiceData(uniqueData);
      setFilteredData(uniqueData); // 초기에는 모든 데이터 표시
      console.log('State 업데이트 완료');
    } catch (error) {
      console.error('데이터 가져오기 오류:', error);
      alert('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoiceData();
  }, []);

  // 검색 함수
  const performSearch = () => {
    if (!searchTerm.trim()) {
      setFilteredData(invoiceData); // 검색어가 없으면 모든 데이터 표시
      return;
    }

    const searchLower = searchTerm.toLowerCase();
    const filtered = invoiceData.filter(item => {
      // order_number에서 검색
      if (item.order_number?.toLowerCase().includes(searchLower)) return true;
      
      // seller에서 검색
      if (item.seller?.toLowerCase().includes(searchLower)) return true;
      
      // total_price에서 검색 (숫자를 문자열로 변환하여 검색)
      if (item.total_price?.toString().includes(searchTerm)) return true;
      
      // 운송장번호 검색 (delivery_number1~5)
      if (item.delivery_number1?.toLowerCase().includes(searchLower)) return true;
      if (item.delivery_number2?.toLowerCase().includes(searchLower)) return true;
      if (item.delivery_number3?.toLowerCase().includes(searchLower)) return true;
      if (item.delivery_number4?.toLowerCase().includes(searchLower)) return true;
      if (item.delivery_number5?.toLowerCase().includes(searchLower)) return true;
      
      return false;
    });
    
    setFilteredData(filtered);
  };

  // 검색어 변경 시 자동으로 필터링하지 않음 (메모리 효율성을 위해)
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // 검색 버튼 클릭
  const handleSearchClick = () => {
    performSearch();
  };

  // Enter 키 검색
  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };

  // 체크박스 관련 함수들
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(filteredData.map(item => item.id));
      setSelectedRows(allIds);
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedRows(newSelected);
  };

  const isAllSelected = filteredData.length > 0 && selectedRows.size === filteredData.length;
  const isIndeterminate = selectedRows.size > 0 && selectedRows.size < filteredData.length;

  const handleExcelUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload-excel', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        alert('엑셀 파일이 성공적으로 업로드되었습니다.');
        // 파일 입력 초기화
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        // 데이터 새로고침
        fetchInvoiceData();
      } else {
        alert('업로드 중 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('업로드 중 오류가 발생했습니다.');
    }
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleOrderClick = (order: InvoiceData) => {
    setSelectedOrder(order);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedOrder(null);
  };

  // 상품명 줄바꿈 처리 함수
  const formatProductName = (productName: string) => {
    const colonIndex = productName.indexOf(':');
    if (colonIndex === -1) return productName;

    const beforeColon = productName.substring(0, colonIndex);
    const afterColon = productName.substring(colonIndex);

    // ':' 앞에서 가장 가까운 공백 찾기
    const lastSpaceIndex = beforeColon.lastIndexOf(' ');
    if (lastSpaceIndex === -1) return productName;

    const firstPart = productName.substring(0, lastSpaceIndex);
    const secondPart = productName.substring(lastSpaceIndex + 1);

    return (
      <>
        {firstPart}
        <br />
        {secondPart}
      </>
    );
  };

  // 상품명 클릭 시 새탭으로 열기
  const handleProductClick = (e: React.MouseEvent, offerId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (offerId) {
      const url = `https://detail.1688.com/offer/${offerId}.html`;
      window.open(url, '_blank');
    }
  };

  // 영수증 이모지 클릭 시 이미지 업로드
  const handleReceiptClick = (orderNumber: string) => {
    // 현재 선택된 주문번호를 저장하고 파일 선택 다이얼로그 열기
    receiptFileInputRef.current?.setAttribute('data-order-number', orderNumber);
    receiptFileInputRef.current?.click();
  };

  // 영수증 이모지 클릭 시 이미지 보기
  const handleReceiptView = async (orderNumber: string) => {
    try {
      // S3에서 이미지 URL 가져오기
      const response = await fetch('/api/get-receipt-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderNumber }),
      });

      const result = await response.json();

      if (response.ok && result.imageUrl) {
        // 새 탭에서 이미지 열기
        window.open(result.imageUrl, '_blank');
      } else {
        alert('이미지를 불러올 수 없습니다.');
      }
    } catch (error) {
      alert('이미지를 불러올 수 없습니다.');
    }
  };

  // 영수증 삭제
  const handleReceiptDelete = async (orderNumber: string) => {
    if (!confirm('영수증을 삭제하시겠습니까?')) {
      return;
    }

    try {
      const response = await fetch('/api/delete-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderNumber }),
      });

      const result = await response.json();

      if (response.ok) {
        // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
        const updatedInvoiceData = invoiceData.map(item => 
          item.order_number === orderNumber ? { ...item, img_upload: false } : item
        );
        setInvoiceData(updatedInvoiceData);
        
        const updatedFilteredData = filteredData.map(item => 
          item.order_number === orderNumber ? { ...item, img_upload: false } : item
        );
        setFilteredData(updatedFilteredData);
        
        // 서버에서 최신 데이터 가져오기
        fetchInvoiceData();
      } else {
        alert(result.error || '삭제 중 오류가 발생했습니다.');
      }
    } catch (error) {
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  // 영수증 파일 선택 시 S3 업로드
  const handleReceiptFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const orderNumber = event.target.getAttribute('data-order-number');
    
    if (!file || !orderNumber) return;

    // 이미지 파일 또는 PDF 파일인지 확인
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      alert('이미지 파일 또는 PDF 파일만 업로드 가능합니다.');
      return;
    }

    setUploadingReceipt(orderNumber);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('orderNumber', orderNumber);

    try {
      const response = await fetch('/api/upload-receipt', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        console.log('영수증 업로드 성공:', result);
        alert('영수증이 성공적으로 업로드되었습니다.');
        
        // 로컬 상태 즉시 업데이트 (UI 즉시 반영)
        const updatedInvoiceData = invoiceData.map(item => 
          item.order_number === orderNumber ? { ...item, img_upload: true } : item
        );
        setInvoiceData(updatedInvoiceData);
        
        const updatedFilteredData = filteredData.map(item => 
          item.order_number === orderNumber ? { ...item, img_upload: true } : item
        );
        setFilteredData(updatedFilteredData);
        
        // 서버에서 최신 데이터 가져오기
        await fetchInvoiceData();
        console.log('데이터 새로고침 완료');
        
        // 업로드된 주문번호의 상태 확인
        console.log('업로드된 주문번호:', orderNumber);
        setTimeout(() => {
          const updatedItem = filteredData.find(item => item.order_number === orderNumber);
          console.log('업로드 후 해당 주문의 img_upload 상태:', updatedItem?.img_upload);
          console.log('업로드 후 해당 주문 전체 정보:', updatedItem);
        }, 100);
      } else {
        console.error('업로드 실패:', result);
        alert(result.error || '업로드 중 오류가 발생했습니다.');
      }
    } catch (error) {
      alert('업로드 중 오류가 발생했습니다.');
    } finally {
      setUploadingReceipt(null);
      // 파일 입력 초기화
      if (receiptFileInputRef.current) {
        receiptFileInputRef.current.value = '';
        receiptFileInputRef.current.removeAttribute('data-order-number');
      }
    }
  };

  return (
    <div className="invoice-layout">
      <TopsideMenu />
      <div className="invoice-main-content">
        <LeftsideMenu />
        <main className="invoice-content">
          <div className="invoice-container">
            <h1 className="invoice-title">영수증 저장</h1>
            
            {/* 상태 카드들 */}
            <div className="status-cards">
              {cardData.map((status, index) => (
                <Card key={index} className="status-card">
                  <div className="status-content">
                    <span className="status-text">{status}</span>
                    <span className="status-count">{filteredData.length}</span>
                  </div>
                </Card>
              ))}
            </div>

            {/* 엑셀 업로드 버튼 */}
            <div className="excel-upload-section">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
              />
              <input
                type="file"
                ref={receiptFileInputRef}
                onChange={handleReceiptFileChange}
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
              />
              <button className="excel-upload-btn" onClick={handleExcelUpload}>
                엑셀 업로드
              </button>
              <button className="excel-download-btn">
                ⬇️ 엑셀 다운로드
              </button>
            </div>

            {/* 검색 영역 */}
            <div className="search-section">
              <div className="search-board">
                <div className="search-form-container">
                  <select className="search-dropdown">
                    <option value="">전체</option>
                    <option value="결제대기">결제대기</option>
                    <option value="배송대기">배송대기</option>
                    <option value="환불중">환불중</option>
                    <option value="평가대기">평가대기</option>
                  </select>
                  <input 
                    type="text" 
                    placeholder="검색어를 입력하세요" 
                    className="search-input"
                    value={searchTerm}
                    onChange={handleSearchInputChange}
                    onKeyPress={handleSearchKeyPress}
                  />
                  <button className="search-button" onClick={handleSearchClick}>검색</button>
                </div>
              </div>
            </div>

            {/* 테이블 */}
            <div className="table-board">
              <table className="invoice-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = isIndeterminate;
                        }}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="table-checkbox"
                      />
                    </th>
                    <th>주문번호</th>
                    <th>총금액</th>
                    <th>운송장번호</th>
                    <th>비고</th>
                    <th>주문/결제 시간</th>
                    <th>영수증</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="empty-data">로딩 중...</td>
                    </tr>
                  ) : filteredData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-data">검색 결과가 없습니다.</td>
                    </tr>
                  ) : (
                    filteredData.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedRows.has(item.id)}
                            onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                            className="table-checkbox"
                          />
                        </td>
                        <td>
                          <span 
                            className="order-number-text"
                            onClick={() => handleOrderClick(item)}
                          >
                            {item.order_number}
                            <br />
                            {item.seller}
                          </span>
                        </td>
                        <td>
                          {item.total_price?.toLocaleString()}
                        </td>
                        <td>
                          {item.order_status && (
                            <>
                              {item.order_status}
                              {(item.delivery_number1 || item.delivery_number2 || item.delivery_number3 || item.delivery_number4 || item.delivery_number5) && (
                                <div className="delivery-numbers">
                                  {item.delivery_number1 && <div>{item.delivery_number1}</div>}
                                  {item.delivery_number2 && <div>{item.delivery_number2}</div>}
                                  {item.delivery_number3 && <div>{item.delivery_number3}</div>}
                                  {item.delivery_number4 && <div>{item.delivery_number4}</div>}
                                  {item.delivery_number5 && <div>{item.delivery_number5}</div>}
                                </div>
                              )}
                            </>
                          )}
                          {!item.order_status && (item.delivery_number1 || item.delivery_number2 || item.delivery_number3 || item.delivery_number4 || item.delivery_number5) && (
                            <div className="delivery-numbers">
                              {item.delivery_number1 && <div>{item.delivery_number1}</div>}
                              {item.delivery_number2 && <div>{item.delivery_number2}</div>}
                              {item.delivery_number3 && <div>{item.delivery_number3}</div>}
                              {item.delivery_number4 && <div>{item.delivery_number4}</div>}
                              {item.delivery_number5 && <div>{item.delivery_number5}</div>}
                            </div>
                          )}
                        </td>
                        <td>
                          {editingNote === item.order_number ? (
                            <div>
                              <input
                                type="text"
                                className="note-input"
                                value={noteText[item.order_number] || ''}
                                onChange={(e) => handleNoteChange(item.order_number, e.target.value)}
                                onBlur={() => saveNote(item.order_number, noteText[item.order_number] || '')}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                  }
                                }}
                                autoFocus
                              />
                            </div>
                          ) : (
                            <span 
                              className="note-text"
                              onClick={() => startEditingNote(item.order_number)}
                            >
                              {item.note || '메모 추가'}
                            </span>
                          )}
                        </td>
                        <td>
                          {item.order_date && (
                            <>
                              {formatDate(item.order_date)}
                              {item.payment_date && (
                                <>
                                  <br />
                                  {formatDate(item.payment_date)}
                                </>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          {uploadingReceipt === item.order_number ? (
                            <span className="receipt-icon uploading" title="업로드 중...">
                              ⏳
                            </span>
                          ) : item.img_upload ? (
                            <div className="receipt-icons-container">
                              <span 
                                className="receipt-icon"
                                onClick={() => handleReceiptView(item.order_number)}
                                title="영수증 보기"
                              >
                                📄
                              </span>
                              <span 
                                className="delete-icon"
                                onClick={() => handleReceiptDelete(item.order_number)}
                                title="영수증 삭제"
                              >
                                🗑️
                              </span>
                            </div>
                          ) : (
                            <span 
                              className="receipt-attach-text"
                              onClick={() => handleReceiptClick(item.order_number)}
                              title="영수증 업로드"
                            >
                              첨부
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* Drawer */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={closeDrawer}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>주문 상세 정보</h2>
              <button className="close-btn" onClick={closeDrawer}>×</button>
            </div>
            <div className="drawer-content">
              {selectedOrder && (
                <div>
                  <h3>주문번호: {selectedOrder.order_number}</h3>
                  <table className="detail-table">
                    <thead>
                      <tr>
                        <th>Product Name</th>
                        <th>Qty</th>
                        <th>Unit Price</th>
                        <th>Total Price</th>
                        <th>Received</th>
                        <th>Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {originalData
                        .filter(item => item.order_number === selectedOrder.order_number)
                        .map((item, index) => (
                          <tr key={index}>
                            <td>
                              <div className="product-name-display">
                                {formatProductName(item.product_name || '')}
                              </div>
                            </td>
                            <td>{item.order_qty || 0}</td>
                            <td>{item.unit_price?.toLocaleString() || 0}</td>
                            <td>
                              {((item.unit_price || 0) * (item.order_qty || 0)).toLocaleString()}
                            </td>
                            <td>
                              <input
                                type="number"
                                className="received-input"
                                defaultValue={item.received_qty || ''}
                                onKeyPress={(e) => {
                                  if (e.key === 'Enter') {
                                    // 다음 행의 received 입력으로 포커스 이동
                                    const nextInput = e.currentTarget.closest('tr')?.nextElementSibling?.querySelector('.received-input') as HTMLInputElement;
                                    if (nextInput) {
                                      nextInput.focus();
                                    }
                                  }
                                }}
                              />
                            </td>
                            <td>
                              <select 
                                className="category-select"
                                defaultValue={item.category || ''}
                              >
                                <option value="">선택</option>
                                <option value="vest">vest</option>
                                <option value="blouse">blouse</option>
                                <option value="cardigan">cardigan</option>
                                <option value="hat">hat</option>
                                <option value="jacket">jacket</option>
                                <option value="night wear">night wear</option>
                                <option value="one piece">one piece</option>
                                <option value="scarf">scarf</option>
                                <option value="shorts">shorts</option>
                                <option value="skirt">skirt</option>
                                <option value="slippers">slippers</option>
                                <option value="t-shirt">t-shirt</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  
                  <div className="drawer-actions">
                    <button className="save-btn">저장</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceSave; 