'use client';

import React, { useRef, useState, useEffect } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import Card from '../../component/Card';
import SearchForm from '../../component/SearchForm';
import './ItemCheck.css';

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

interface ItemData {
  id: string;
  order_number: string;
  product_name: string | null;
  seller: string | null;
  total_price: number | null;
  order_qty: number | null;
  unit_price: number | null;
  received_qty: number | null;
  category: string | null;
  composition: string | null;
  note?: string; // 메모 추가
  img_url?: string; // 이미지 URL
  date?: string; // 날짜
  option_name?: string; // 옵션명
  china_option1?: string; // 중국 옵션1
  china_option2?: string; // 중국 옵션2
  price?: number; // 단가
  import_qty?: number; // 입고수량
  confirm_qty?: number; // 확인수량
  cancel_qty?: number; // 취소수량
  row_id?: string; // 구글 시트 행 번호 (UUID)
}

const ItemCheck: React.FC = () => {
  const cardData = ['전체', '미입고', '부분입고', '입고완료', '불량', '반품'];
  const [itemData, setItemData] = useState<ItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemData | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState<ItemData[]>([]);
  const [originalData, setOriginalData] = useState<ItemData[]>([]);
  const [activeStatus, setActiveStatus] = useState<string>('전체');
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<{[key: string]: string}>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  
  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [paginatedData, setPaginatedData] = useState<ItemData[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  
  // 셀 편집 상태
  const [editingCell, setEditingCell] = useState<{id: string, field: string} | null>(null);
  const [cellValue, setCellValue] = useState<string>('');
  
  // 수정된 데이터 추적
  const [modifiedData, setModifiedData] = useState<{[key: string]: {[field: string]: number | null}}>({});
  const [isSaving, setIsSaving] = useState(false);

  // 메모 저장 함수
  const saveNote = async (orderNumber: string, note: string) => {
    if (savingNote === orderNumber) return;
    
    try {
      setSavingNote(orderNumber);
      
      // 메모 저장 API 호출
      const response = await fetch('/api/save-item-note', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_number: orderNumber,
          note: note
        }),
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
        setItemData(prev => 
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
  
  // 디바운스된 저장 함수
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

  // 셀 편집 시작
  const startEditingCell = (id: string, field: string, value: number | null | undefined) => {
    setEditingCell({ id, field });
    setCellValue(value !== null && value !== undefined ? value.toString() : '');
  };

  // 셀 편집 완료
  const finishEditingCell = async () => {
    if (editingCell) {
      const { id, field } = editingCell;
      const numValue = cellValue === '' ? null : Number(cellValue);
      
      // 현재 아이템 찾기
      const currentItem = filteredData.find(item => item.id === id);
      const currentValue = currentItem ? currentItem[field as keyof ItemData] : null;
      
      // 값이 실제로 변경된 경우에만 처리
      const valueChanged = numValue !== currentValue;
      
      if (valueChanged) {
        // 데이터 업데이트
        const updatedData = filteredData.map(item => 
          item.id === id ? { ...item, [field]: numValue } : item
        );
        
        setFilteredData(updatedData);
        
        // 전체 데이터도 업데이트
        const updatedItemData = itemData.map(item => 
          item.id === id ? { ...item, [field]: numValue } : item
        );
        
        setItemData(updatedItemData);
        
        // 변경된 항목 찾기
        const updatedItem = updatedData.find(item => item.id === id);
        
        // 수정된 데이터 추적
        if (updatedItem && updatedItem.row_id) {
          const rowKey = updatedItem.row_id;
          setModifiedData(prev => ({
            ...prev,
            [rowKey]: {
              ...(prev[rowKey] || {}),
              [field]: numValue
            }
          }));
        }
      }
      
      setEditingCell(null);
    }
  };

  // 셀 값 변경
  const handleCellValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 숫자만 입력 가능하도록
    const value = e.target.value.replace(/[^0-9]/g, '');
    setCellValue(value);
  };

  // 셀 키 이벤트 처리
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      finishEditingCell();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  // 데이터 가져오기
  const fetchItemData = async () => {
    console.log('fetchItemData 시작');
    try {
      setLoading(true);
      
      // Supabase에서 데이터 가져오기
      const response = await fetch('/api/get-import-products', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('데이터를 불러오는데 실패했습니다.');
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        setOriginalData(result.data);
        setItemData(result.data);
        setFilteredData(result.data);
      } else {
        // 오류 또는 데이터가 없는 경우 빈 배열 설정
        setOriginalData([]);
        setItemData([]);
        setFilteredData([]);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('데이터 가져오기 오류:', error);
      setLoading(false);
      alert('데이터를 가져오는 중 오류가 발생했습니다.');
    }
  };

  useEffect(() => {
    fetchItemData();
  }, []);

  // 페이지네이션 처리 함수
  const updatePaginatedData = (data: ItemData[]) => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedData(data.slice(startIndex, endIndex));
    setTotalPages(Math.ceil(data.length / itemsPerPage));
  };

  // 페이지 변경 함수
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // 다음 페이지로 이동
  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // 이전 페이지로 이동
  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  // 필터링된 데이터가 변경될 때 페이지네이션 업데이트
  useEffect(() => {
    updatePaginatedData(filteredData);
  }, [filteredData, currentPage]);

  // 검색 함수
  const performSearch = async () => {
    if (!searchTerm.trim()) {
      setFilteredData(itemData); // 검색어가 없으면 모든 데이터 표시
      setCurrentPage(1); // 검색 시 첫 페이지로 이동
      return;
    }

    try {
      setLoading(true);
      
      // 배송번호로 검색하는 API 호출
      const response = await fetch(`/api/search-by-delivery-number?term=${encodeURIComponent(searchTerm)}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('검색 중 오류가 발생했습니다.');
      }
      
      const result = await response.json();
      
      if (result.success) {
        setFilteredData(result.data || []);
      } else {
        console.error('검색 오류:', result.error);
        alert(result.error || '검색 중 오류가 발생했습니다.');
        setFilteredData([]);
      }
    } catch (error) {
      console.error('검색 오류:', error);
      alert('검색 중 오류가 발생했습니다.');
      setFilteredData([]);
    } finally {
      setLoading(false);
      setCurrentPage(1); // 검색 시 첫 페이지로 이동
    }
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

  const handleLoadGoogleSheet = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/load-google-sheet', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      let result;
      try {
        result = await response.json();
        console.log('구글 시트 API 응답:', result);
      } catch (parseError: any) {
        const errorText = await response.text();
        console.error('응답 파싱 오류:', parseError);
        console.error('원본 응답 텍스트:', errorText);
        throw new Error('API 응답을 파싱할 수 없습니다.');
      }
      
      if (response.ok && result.success) {
        alert(`${result.message}`);
        // 페이지 새로고침으로 간단하게 해결
        window.location.reload();
      } else {
        const errorMessage = result.error || result.details || '구글 시트 데이터를 불러오는데 실패했습니다.';
        console.error('구글 시트 API 오류:', errorMessage);
        alert(errorMessage);
        setLoading(false);
      }
    } catch (error) {
      console.error('구글 시트 데이터 불러오기 오류:', error);
      alert(`구글 시트 데이터를 불러오는데 실패했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setLoading(false);
    }
  };

  const handleItemClick = (item: ItemData) => {
    setSelectedItem(item);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedItem(null);
  };

  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  
  // 마우스 위치 추적 함수
  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  };

  // 바코드 버튼 클릭 핸들러
  const handleBarcodeClick = () => {
    if (selectedRows.size === 0) {
      alert('바코드를 생성할 항목을 선택해주세요.');
      return;
    }
    
    // 선택된 항목들의 바코드 정보 수집
    const selectedItems = filteredData.filter(item => selectedRows.has(item.id));
    console.log('바코드 생성 대상:', selectedItems);
    
    // 여기에 바코드 생성 로직 추가
    alert(`${selectedItems.length}개 항목의 바코드를 생성합니다.`);
    // TODO: 바코드 생성 API 호출 또는 페이지 이동
  };

  // 저장 버튼 클릭 핸들러
  const handleSaveClick = async () => {
    if (Object.keys(modifiedData).length === 0) return;
    
    setIsSaving(true);
    console.log('저장 시작, 수정된 데이터:', modifiedData);
    
    try {
      // 수정된 모든 데이터에 대해 API 호출
      const savePromises = Object.entries(modifiedData).map(async ([id, fields]) => {
        const item = itemData.find(item => item.id === id);
        if (!item) {
          console.error('아이템을 찾을 수 없음:', id);
          return null;
        }
        
        // id가 row_id 값의 문자열이므로 row_id를 직접 사용
        const rowId = id;
        if (!rowId) {
          console.error('유효하지 않은 행 번호:', id);
          return { id, error: '유효하지 않은 행 번호입니다.' };
        }
        
        console.log(`아이템 ${id} 저장 중, 행 번호: ${rowId}, 필드:`, fields);
        
        const results = await Promise.all(
          Object.entries(fields).map(async ([field, value]) => {
            try {
              const requestBody = {
                row_id: rowId,
                field,
                value
              };
              
              console.log('API 요청 데이터:', requestBody);
              
              const response = await fetch('/api/save-cell-value', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              });
              
              console.log(`${field} API 응답 상태:`, response.status, response.statusText);
              
              if (!response.ok) {
                const errorData = await response.json();
                console.error(`${field} 저장 실패:`, errorData);
                return { success: false, field, error: errorData };
              }
              
              const responseData = await response.json();
              console.log(`${field} 저장 성공:`, responseData);
              
              return { success: true, field, data: responseData };
            } catch (error) {
              console.error(`${field} 저장 오류:`, error);
              return { success: false, field, error };
            }
          })
        );
        
        return { id, results };
      });
      
      const results = await Promise.all(savePromises);
      console.log('모든 저장 작업 완료:', results);
      
      // 저장 완료 후 수정 데이터 초기화
      setModifiedData({});
      
      // 오류가 있는 경우 확인
      const hasErrors = results.some(result => 
        result && result.results && result.results.some((r: any) => !r.success)
      );
      
      if (hasErrors) {
        alert('일부 데이터 저장 중 오류가 발생했습니다. 콘솔을 확인해주세요.');
      } else {
        alert('모든 변경사항이 저장되었습니다.');
      }
      
    } catch (error) {
      console.error('저장 중 오류 발생:', error);
      alert('일부 데이터 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="item-layout" onMouseMove={handleMouseMove}>
      <TopsideMenu />
      <div className="item-main-content">
        <LeftsideMenu />
        <main className="item-content">
          <div className="item-container">
            <h1 className="item-title">상품 입고</h1>
            
            {/* 시트 불러오기 버튼 - 카드 위로 이동 */}
            <div className="excel-upload-section">
              <button className="excel-upload-btn" onClick={handleLoadGoogleSheet}>
                시트 불러오기
              </button>
            </div>
            
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

            {/* 검색 영역 */}
            <div className="search-section">
              <div className="search-board">
                <div className="search-form-container">
                  <select className="search-dropdown">
                    <option value="">전체</option>
                    <option value="미입고">미입고</option>
                    <option value="부분입고">부분입고</option>
                    <option value="입고완료">입고완료</option>
                    <option value="불량">불량</option>
                    <option value="반품">반품</option>
                  </select>
                  <input 
                    type="text" 
                    placeholder="배송번호를 입력하세요" 
                    className="search-input"
                    value={searchTerm}
                    onChange={handleSearchInputChange}
                    onKeyPress={handleSearchKeyPress}
                  />
                  <button className="search-button" onClick={handleSearchClick}>검색</button>
                </div>
              </div>
            </div>

            {/* 저장 버튼 - 테이블 바로 위로 이동 */}
            <div className="excel-save-section">
              <button 
                className={`excel-download-btn ${Object.keys(modifiedData).length > 0 ? 'active' : ''}`}
                onClick={handleSaveClick}
                disabled={Object.keys(modifiedData).length === 0 || isSaving}
              >
                {isSaving ? '저장 중...' : '저장'}
              </button>
              <button className="barcode-btn" onClick={handleBarcodeClick}>바코드 생성</button>
            </div>

            {/* 테이블 */}
            <div className="table-board">
              <table className="item-table">
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
                    <th>이미지</th>
                    <th>글번호</th>
                    <th>상품명</th>
                    <th>주문옵션</th>
                    <th>개수</th>
                    <th>단가</th>
                    <th>총금액</th>
                    <th>입고</th>
                    <th>확인</th>
                    <th>취소</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={11} className="empty-data">로딩 중...</td>
                    </tr>
                  ) : paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="empty-data">검색 결과가 없습니다.</td>
                    </tr>
                  ) : (
                    paginatedData.map((item) => (
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
                          {item.img_url ? (
                            <div className="image-preview-container">
                              <img 
                                src={item.img_url} 
                                alt="상품 이미지" 
                                className="product-thumbnail"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = '/placeholder.png';
                                }}
                              />
                              <div 
                                className="image-preview"
                                style={{
                                  top: `${mousePosition.y - 300}px`,
                                  left: `${mousePosition.x + 30}px`
                                }}
                              >
                                <img 
                                  src={item.img_url} 
                                  alt="상품 이미지 미리보기" 
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/placeholder.png';
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="no-image">이미지 없음</div>
                          )}
                        </td>
                        <td>
                          <span 
                            className="order-number-text"
                            onClick={() => handleItemClick(item)}
                          >
                            {item.date ? item.date : ''}<br />
                            {item.order_number}
                          </span>
                        </td>
                        <td>
                          <div className="product-name">
                            {item.product_name || '-'}
                            {item.option_name && (
                              <>
                                <br />
                                {item.option_name}
                              </>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="china-options">
                            {item.china_option1 || '-'}
                            {item.china_option2 && (
                              <>
                                <br />
                                {item.china_option2}
                              </>
                            )}
                          </div>
                        </td>
                        <td>
                          {item.order_qty || 0}
                        </td>
                        <td>
                          {item.price ? item.price.toLocaleString() : '0'}
                        </td>
                        <td>
                          {item.total_price ? item.total_price.toLocaleString() : '0'}
                        </td>
                        <td 
                          className="editable-cell"
                          onClick={() => startEditingCell(item.id, 'import_qty', item.import_qty)}
                        >
                          {editingCell && editingCell.id === item.id && editingCell.field === 'import_qty' ? (
                            <input
                              type="text"
                              value={cellValue}
                              onChange={handleCellValueChange}
                              onKeyDown={handleCellKeyDown}
                              onBlur={finishEditingCell}
                              autoFocus
                              className="cell-input"
                            />
                          ) : (
                            item.import_qty || ''
                          )}
                        </td>
                        <td 
                          className="editable-cell"
                          onClick={() => startEditingCell(item.id, 'confirm_qty', item.confirm_qty)}
                        >
                          {editingCell && editingCell.id === item.id && editingCell.field === 'confirm_qty' ? (
                            <input
                              type="text"
                              value={cellValue}
                              onChange={handleCellValueChange}
                              onKeyDown={handleCellKeyDown}
                              onBlur={finishEditingCell}
                              autoFocus
                              className="cell-input"
                            />
                          ) : (
                            item.confirm_qty || ''
                          )}
                        </td>
                        <td 
                          className="editable-cell"
                          onClick={() => startEditingCell(item.id, 'cancel_qty', item.cancel_qty)}
                        >
                          {editingCell && editingCell.id === item.id && editingCell.field === 'cancel_qty' ? (
                            <input
                              type="text"
                              value={cellValue}
                              onChange={handleCellValueChange}
                              onKeyDown={handleCellKeyDown}
                              onBlur={finishEditingCell}
                              autoFocus
                              className="cell-input"
                            />
                          ) : (
                            item.cancel_qty || ''
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            {/* 페이지네이션 */}
            {!loading && filteredData.length > 0 && (
              <div className="pagination">
                <button 
                  onClick={goToPrevPage} 
                  disabled={currentPage === 1}
                  className="pagination-button"
                >
                  이전
                </button>
                
                <div className="page-numbers">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    // 현재 페이지 주변의 페이지 번호만 표시
                    let pageNum;
                    if (totalPages <= 5) {
                      // 전체 페이지가 5개 이하면 모든 페이지 번호 표시
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      // 현재 페이지가 1, 2, 3인 경우 1~5 표시
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      // 현재 페이지가 마지막에 가까운 경우
                      pageNum = totalPages - 4 + i;
                    } else {
                      // 그 외의 경우 현재 페이지 중심으로 표시
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                
                <button 
                  onClick={goToNextPage} 
                  disabled={currentPage === totalPages}
                  className="pagination-button"
                >
                  다음
                </button>
                
                <span className="page-info">
                  {currentPage} / {totalPages} 페이지 (총 {filteredData.length}개)
                </span>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Drawer */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={closeDrawer}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>상품 상세 정보</h2>
              <button className="close-btn" onClick={closeDrawer}>×</button>
            </div>
            <div className="drawer-content">
              {selectedItem && (
                <div>
                  <h3>주문번호: {selectedItem.order_number}</h3>
                  <table className="detail-table">
                    <thead>
                      <tr>
                        <th>상품명</th>
                        <th>주문수량</th>
                        <th>단가</th>
                        <th>총금액</th>
                        <th>입고수량</th>
                        <th>카테고리</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div className="product-name-display">
                            {selectedItem.product_name}
                          </div>
                        </td>
                        <td>{selectedItem.order_qty || 0}</td>
                        <td>{selectedItem.unit_price?.toLocaleString() || 0}</td>
                        <td>
                          {selectedItem.total_price?.toLocaleString() || 0}
                        </td>
                        <td>
                          <input
                            type="number"
                            className="received-input"
                            defaultValue={selectedItem.received_qty || ''}
                          />
                        </td>
                        <td>
                          <select 
                            className="category-select"
                            defaultValue={selectedItem.category || ''}
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

export default ItemCheck; 