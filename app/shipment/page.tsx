'use client';

import React, { useState, useEffect } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import * as XLSX from 'xlsx';
import './Shipment.css';

interface ShipmentData {
  id: string;
  box_number: string;
  barcode: string;
  product_name: string;
  order_option: string;
  quantity: number;
}

const Shipment: React.FC = () => {
  const [shipmentData, setShipmentData] = useState<ShipmentData[]>([]);
  const [filteredData, setFilteredData] = useState<ShipmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchDropdown, setSearchDropdown] = useState('박스번호');
  const [searchTerm, setSearchTerm] = useState('');

  // 전체 쉽먼트 데이터 가져오기
  const fetchAllShipmentData = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/get-all-shipment-data', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('쉽먼트 데이터를 불러오는데 실패했습니다.');
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        // 박스번호 순으로 정렬하여 저장
        const sortedData = sortByBoxNumber(result.data);
        setShipmentData(sortedData);
        setFilteredData(sortedData);
        console.log('전체 쉽먼트 데이터 로드 완료:', sortedData.length, '개 항목');
      } else {
        setShipmentData([]);
        setFilteredData([]);
      }
      
    } catch (error) {
      console.error('쉽먼트 데이터 가져오기 오류:', error);
      setShipmentData([]);
      setFilteredData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllShipmentData();
  }, []);

  // 검색 처리
  const handleSearch = () => {
    if (!searchTerm.trim()) {
      setFilteredData(sortByBoxNumber([...shipmentData]));
      return;
    }

    const filtered = shipmentData.filter((item) => {
      switch (searchDropdown) {
        case '박스번호':
          return item.box_number?.toLowerCase().includes(searchTerm.toLowerCase());
        case '바코드':
          return item.barcode?.toLowerCase().includes(searchTerm.toLowerCase());
        case '상품명':
          return item.product_name?.toLowerCase().includes(searchTerm.toLowerCase());
        default:
          return true;
      }
    });

    // 검색 결과도 박스번호 순으로 정렬
    setFilteredData(sortByBoxNumber(filtered));
  };

  // Enter 키 처리
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // 박스번호 정렬 함수
  const sortByBoxNumber = (data: ShipmentData[]) => {
    return data.sort((a, b) => {
      // "Box 1", "Box 2" 형태에서 숫자 부분 추출
      const getBoxNumber = (boxString: string) => {
        const match = boxString.match(/Box\s+(\d+)/i);
        return match ? parseInt(match[1]) : 0;
      };
      
      const aNum = getBoxNumber(a.box_number);
      const bNum = getBoxNumber(b.box_number);
      
      return aNum - bNum;
    });
  };

  // Excel 다운로드 함수
  const downloadExcel = () => {
    if (filteredData.length === 0) {
      alert('다운로드할 데이터가 없습니다.');
      return;
    }

    // 박스번호 순으로 정렬된 데이터 준비
    const sortedData = sortByBoxNumber([...filteredData]);

    // Excel 데이터 준비 (정확한 컬럼명으로 매핑)
    const excelData = sortedData.map(item => ({
      'box': item.box_number,
      'barcode': item.barcode,
      'product_name': item.product_name,
      'option_name': item.order_option,
      'qty': item.quantity
    }));

    // 워크시트 생성
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "쉽먼트 데이터");

    // 파일명 생성 (로켓그로스 입고요청-MMDD-HHMM)
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const fileName = `로켓그로스 입고요청-${month}${day}-${hour}${minute}.xlsx`;

    // 파일 다운로드
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="shipment-page-layout">
      <TopsideMenu />
      <div className="shipment-page-main-content">
        <LeftsideMenu />
        <main className="shipment-page-content">
          <div className="shipment-page-container">
            <h1 className="shipment-page-title">쉽먼트</h1>
            
            {/* 다운로드 버튼 영역 */}
            <div className="shipment-download-section">
              <button 
                className="shipment-download-button"
                onClick={downloadExcel}
              >
                📥 xlsx 다운
              </button>
            </div>

            {/* 검색 영역 */}
            <div className="shipment-search-section">
              <div className="shipment-search-board">
                <div className="shipment-search-form-container">
                  <select 
                    className="shipment-search-dropdown"
                    value={searchDropdown}
                    onChange={(e) => setSearchDropdown(e.target.value)}
                  >
                    <option value="박스번호">박스번호</option>
                    <option value="바코드">바코드</option>
                    <option value="상품명">상품명</option>
                  </select>
                  <input
                    type="text"
                    placeholder="검색어를 입력하세요"
                    className="shipment-search-input"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyPress={handleKeyPress}
                  />
                  <button 
                    className="shipment-search-button"
                    onClick={handleSearch}
                  >
                    검색
                  </button>
                </div>
              </div>
            </div>

            {/* 쉽먼트 테이블 */}
            <div className="shipment-page-table-board">
              <table className="shipment-page-table">
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
                  {loading ? (
                    <tr><td colSpan={5} className="shipment-page-empty-data">로딩 중...</td></tr>
                  ) : filteredData.length === 0 ? (
                    <tr><td colSpan={5} className="shipment-page-empty-data">데이터 없음</td></tr>
                  ) : (
                    filteredData.map((item) => (
                      <tr key={item.id}>
                        <td>{item.box_number}</td>
                        <td>{item.barcode}</td>
                        <td style={{ whiteSpace: 'pre-line' }}>{item.product_name}</td>
                        <td style={{ whiteSpace: 'pre-line' }}>{item.order_option}</td>
                        <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Shipment;