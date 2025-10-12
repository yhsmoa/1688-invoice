'use client';

import React, { useState, useEffect, useRef } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import * as XLSX from 'xlsx';
import './customs-info.css';

interface CustomsInfoData {
  HS_code: string;
  item_name_ko?: string;
  item_name_en?: string;
  CO?: string;
}

const CustomsInfo: React.FC = () => {
  const [customsData, setCustomsData] = useState<CustomsInfoData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState<CustomsInfoData[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [paginatedData, setPaginatedData] = useState<CustomsInfoData[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  const updatePaginatedData = (data: CustomsInfoData[]) => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedData(data.slice(startIndex, endIndex));
    setTotalPages(Math.ceil(data.length / itemsPerPage));
  };

  useEffect(() => {
    updatePaginatedData(filteredData);
  }, [filteredData, currentPage]);

  useEffect(() => {
    loadCustomsData();
  }, []);

  const loadCustomsData = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/get-customs-data', {
        method: 'GET',
      });

      const result = await response.json();
      if (result.success && result.data) {
        setCustomsData(result.data);
        setFilteredData(result.data);
      }
    } catch (error) {
      console.error('데이터 로드 오류:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const performSearch = () => {
    if (!searchTerm.trim()) {
      setFilteredData(customsData);
      setCurrentPage(1);
      return;
    }

    const filtered = customsData.filter((item) => {
      const searchLower = searchTerm.toLowerCase();
      return (
        item.item_name_ko?.toLowerCase().includes(searchLower) ||
        item.item_name_en?.toLowerCase().includes(searchLower) ||
        item.HS_code?.toLowerCase().includes(searchLower) ||
        item.CO?.toLowerCase().includes(searchLower)
      );
    });

    setFilteredData(filtered);
    setCurrentPage(1);
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleSearchClick = () => {
    performSearch();
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };


  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(paginatedData.map(item => item.HS_code));
      setSelectedRows(allIds);
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleSelectRow = (hsCode: string, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(hsCode);
    } else {
      newSelected.delete(hsCode);
    }
    setSelectedRows(newSelected);
  };

  const isAllSelected = paginatedData.length > 0 && selectedRows.size === paginatedData.length;

  const handleCopyToClipboard = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setShowCopyToast(true);
      setTimeout(() => setShowCopyToast(false), 1500);
    }).catch(err => {
      console.error('복사 실패:', err);
    });
  };

  // 엑셀 다운로드 핸들러
  const handleExcelDownload = () => {
    // 헤더 데이터
    const headers = ['품명(한글)', '품명(영문)', 'HS CODE', '원산지발급'];

    // 워크시트 생성
    const ws = XLSX.utils.aoa_to_sheet([headers]);

    // 워크북 생성
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '통관정보');

    // 파일 다운로드
    XLSX.writeFile(wb, '통관정보_템플릿.xlsx');
  };

  // 엑셀 업로드 버튼 클릭
  const handleExcelUploadClick = () => {
    excelFileInputRef.current?.click();
  };

  // 엑셀 파일 선택 시 처리
  const handleExcelFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 엑셀 파일 형식 확인
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      alert('엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.');
      return;
    }

    setIsUploadingExcel(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      console.log('엑셀 파일 업로드 시작:', file.name);

      const response = await fetch('/api/upload-customs-excel', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert(`${result.count}건의 통관정보가 저장되었습니다.`);
        // 파일 입력 초기화
        if (excelFileInputRef.current) {
          excelFileInputRef.current.value = '';
        }
        // 데이터 새로고침
        loadCustomsData();
      } else {
        alert(`업로드 실패: ${result.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('엑셀 업로드 오류:', error);
      alert('엑셀 업로드 중 오류가 발생했습니다.');
    } finally {
      setIsUploadingExcel(false);
    }
  };

  return (
    <div className="customs-info-layout">
      <TopsideMenu />
      <div className="customs-info-main-content">
        <LeftsideMenu />
        <main className="customs-info-content">
          <div className="customs-info-container">
            <h1 className="customs-info-title">통관정보</h1>

            <div className="customs-info-control-section">
              <div className="customs-info-left-controls"></div>
              <div className="customs-info-right-controls">
                <button className="customs-info-excel-download-btn" onClick={handleExcelDownload}>
                  ↓ 엑셀 다운
                </button>
                <button
                  className="customs-info-excel-upload-btn"
                  onClick={handleExcelUploadClick}
                  disabled={isUploadingExcel}
                >
                  {isUploadingExcel ? '업로드 중...' : '↑ 엑셀 업로드'}
                </button>
                {/* 숨겨진 파일 입력 */}
                <input
                  type="file"
                  ref={excelFileInputRef}
                  onChange={handleExcelFileChange}
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            <div className="customs-info-section">
              <div className="customs-info-board">
                <div className="customs-info-form-container">
                  <input
                    type="text"
                    placeholder="품명, HS CODE, 원산지로 검색하세요..."
                    value={searchTerm}
                    onChange={handleSearchInputChange}
                    onKeyPress={handleSearchKeyPress}
                    className="customs-info-input"
                  />
                  <button onClick={handleSearchClick} className="customs-info-button">
                    검색
                  </button>
                </div>
              </div>
            </div>

            <div className="customs-info-table-board">
              {isLoading ? (
                <div className="customs-info-empty-data">데이터를 불러오는 중...</div>
              ) : filteredData.length === 0 ? (
                <div className="customs-info-empty-data">데이터가 없습니다.</div>
              ) : (
                <table className="customs-info-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="customs-info-table-checkbox"
                        />
                      </th>
                      <th>품명(한글)</th>
                      <th>품명(영문)</th>
                      <th>HS CODE</th>
                      <th>원산지발급</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.map((item) => (
                      <tr key={item.HS_code}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedRows.has(item.HS_code)}
                            onChange={(e) => handleSelectRow(item.HS_code, e.target.checked)}
                            className="customs-info-table-checkbox"
                          />
                        </td>
                        <td
                          className="customs-info-item-name-ko"
                          onClick={() => handleCopyToClipboard(item.item_name_ko || '', '품명(한글)')}
                          title="클릭하여 복사"
                        >
                          {item.item_name_ko || ''}
                        </td>
                        <td
                          className="customs-info-item-name-en"
                          onClick={() => handleCopyToClipboard(item.item_name_en || '', '품명(영문)')}
                          title="클릭하여 복사"
                        >
                          {item.item_name_en || ''}
                        </td>
                        <td
                          className="customs-info-hs-code"
                          onClick={() => handleCopyToClipboard(item.HS_code || '', 'HS CODE')}
                          title="클릭하여 복사"
                        >
                          {item.HS_code || ''}
                        </td>
                        <td
                          className="customs-info-co"
                          onClick={() => handleCopyToClipboard(item.CO || '', '원산지발급')}
                          title="클릭하여 복사"
                        >
                          {item.CO || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {totalPages > 1 && (
              <div className="customs-info-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="customs-info-pagination-button"
                >
                  이전
                </button>
                <div className="customs-info-page-numbers">
                  {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
                    const startPage = Math.max(1, currentPage - 5);
                    const pageNum = startPage + i;
                    if (pageNum <= totalPages) {
                      return (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`customs-info-page-number ${currentPage === pageNum ? 'active' : ''}`}
                        >
                          {pageNum}
                        </button>
                      );
                    }
                    return null;
                  })}
                </div>
                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="customs-info-pagination-button"
                >
                  다음
                </button>
                <div className="customs-info-page-info">
                  {currentPage} / {totalPages}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {showCopyToast && (
        <div className="customs-info-copy-toast">
          복사되었습니다!
        </div>
      )}
    </div>
  );
};

export default CustomsInfo;
