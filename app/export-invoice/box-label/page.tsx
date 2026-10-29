'use client';

import React, { useState, useRef } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import * as XLSX from 'xlsx';
import { downloadBoxLabelPdf } from '../../../lib/boxLabelPdf';
import './box-label.css';

interface BoxLabelData {
  id: string;
  date: string;
  location: string;
  weight: string;
}

const BoxLabel: React.FC = () => {
  // 상태 관리
  const [dateInput, setDateInput] = useState('');
  const [tableData, setTableData] = useState<BoxLabelData[]>([]);
  const [isExcelUploaded, setIsExcelUploaded] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // 파일 입력 ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 날짜 입력 유효성 검사 (6자리 숫자만)
  const isDateValid = dateInput.length === 6 && /^\d{6}$/.test(dateInput);

  // 버튼 활성화 상태
  const isUploadEnabled = isDateValid;
  const isPrintEnabled = isExcelUploaded && tableData.length > 0 && !isGeneratingPdf;

  // 날짜 입력 핸들러
  const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setDateInput(value);

    // 날짜가 변경되면 업로드 상태 초기화
    if (isExcelUploaded) {
      setIsExcelUploaded(false);
      setTableData([]);
    }
  };

  // 엑셀 업로드 버튼 클릭
  const handleUploadClick = () => {
    if (!isUploadEnabled) return;
    fileInputRef.current?.click();
  };

  // 엑셀 파일 처리
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 파일 확장자 검증
    const validExtensions = ['.xlsx', '.xls'];
    const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!validExtensions.includes(fileExtension)) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }

    try {
      const data = await readExcelFile(file);
      setTableData(data);
      setIsExcelUploaded(true);
    } catch (error) {
      console.error('엑셀 파일 읽기 오류:', error);
      alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
    }

    // 파일 입력 초기화 (같은 파일 재선택 가능하도록)
    e.target.value = '';
  };

  // 엑셀 파일 읽기
  const readExcelFile = (file: File): Promise<BoxLabelData[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });

          // '품목별' 시트 찾기
          const sheetName = workbook.SheetNames.find(name => name.includes('품목별')) || workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];

          // 시트 데이터를 배열로 변환 (병합 셀 처리)
          const parsedData = parseSheetData(worksheet);
          resolve(parsedData);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsArrayBuffer(file);
    });
  };

  // 시트 데이터 파싱 (F열, J열 추출, 9행부터)
  const parseSheetData = (worksheet: XLSX.WorkSheet): BoxLabelData[] => {
    const result: BoxLabelData[] = [];
    const merges = worksheet['!merges'] || [];

    // 병합 셀 맵 생성 (병합된 셀의 시작 위치와 값 매핑)
    const mergeMap: Record<string, string> = {};

    // 범위 가져오기
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

    // F열(5), J열(9) 의 병합 정보 처리
    merges.forEach(merge => {
      const startCell = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
      const cellValue = worksheet[startCell]?.v?.toString() || '';

      // 병합 범위 내 모든 셀에 시작 셀 값 매핑
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r, c });
          mergeMap[cellAddr] = cellValue;
        }
      }
    });

    // 9행(인덱스 8)부터 데이터 읽기
    const startRow = 8;
    let currentLocation = '';
    let currentWeight = '';

    for (let row = startRow; row <= range.e.r; row++) {
      const fCellAddr = XLSX.utils.encode_cell({ r: row, c: 5 }); // F열 (0-indexed: 5)
      const iCellAddr = XLSX.utils.encode_cell({ r: row, c: 9 }); // J열 (0-indexed: 9)

      // 병합 맵에서 값 가져오기, 없으면 직접 셀에서 가져오기
      const fValue = mergeMap[fCellAddr] || worksheet[fCellAddr]?.v?.toString() || '';
      const iValue = mergeMap[iCellAddr] || worksheet[iCellAddr]?.v?.toString() || '';

      // 값이 변경될 때만 새 행 추가 (병합된 셀 중복 방지)
      if (fValue && (fValue !== currentLocation || iValue !== currentWeight)) {
        currentLocation = fValue;
        currentWeight = iValue;

        result.push({
          id: `row-${row}`,
          date: dateInput,
          location: fValue,
          weight: iValue
        });
      }
    }

    return result;
  };

  // PDF 생성 및 다운로드 — 레이아웃은 lib/boxLabelPdf.ts (쉽먼트 V2 [박스라벨] 과 공유)
  const generatePdf = async () => {
    if (!isPrintEnabled) return;

    setIsGeneratingPdf(true);

    try {
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadBoxLabelPdf(
        tableData.map((item) => ({ date: item.date, location: item.location, weight: item.weight })),
        `박스라벨_${dateInput}_${timestamp}.pdf`
      );
    } catch (error) {
      console.error('PDF 생성 오류:', error);
      alert('PDF 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // 인쇄 버튼 클릭
  const handlePrintClick = () => {
    generatePdf();
  };

  return (
    <div className="box-label-layout">
      <TopsideMenu />
      <div className="box-label-main-content">
        <LeftsideMenu />
        <main className="box-label-content">
          <div className="box-label-container">
            <h1 className="box-label-title">박스 라벨</h1>

            {/* 컨트롤 섹션 */}
            <div className="box-label-control-section">
              <div className="box-label-left-controls">
                <input
                  type="text"
                  className="box-label-date-input"
                  placeholder="YYMMDD"
                  value={dateInput}
                  onChange={handleDateInputChange}
                  maxLength={6}
                />
              </div>
              <div className="box-label-right-controls">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <button
                  className={`box-label-upload-btn ${isUploadEnabled ? 'active' : ''}`}
                  onClick={handleUploadClick}
                  disabled={!isUploadEnabled}
                >
                  엑셀 업로드
                </button>
                <button
                  className={`box-label-print-btn ${isPrintEnabled ? 'active' : ''}`}
                  onClick={handlePrintClick}
                  disabled={!isPrintEnabled}
                >
                  {isGeneratingPdf ? 'PDF 생성 중...' : '인쇄'}
                </button>
              </div>
            </div>

            {/* 테이블 영역 */}
            <div className="box-label-table-section">
              {tableData.length === 0 ? (
                <div className="box-label-empty-data">
                  {!isDateValid
                    ? '날짜를 입력해주세요. (예: 241224)'
                    : '엑셀 파일을 업로드해주세요.'}
                </div>
              ) : (
                <div className="box-label-table-board">
                  <table className="box-label-table">
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>위치</th>
                        <th>부피</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.map((item) => (
                        <tr key={item.id}>
                          <td>{item.date}</td>
                          <td>{item.location}</td>
                          <td>{item.weight}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default BoxLabel;
