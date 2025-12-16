'use client';

import React, { useState, useRef } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import { PDFDocument } from 'pdf-lib';
import './pdf-split.css';

const PdfSplit: React.FC = () => {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pageCount, setPageCount] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 파일 유효성 검사 및 설정
  const validateAndSetFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('PDF 파일만 업로드 가능합니다.');
      return;
    }

    try {
      // PDF 페이지 수 확인
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const pages = pdfDoc.getPageCount();
      setPageCount(pages);
      setPdfFile(file);
    } catch (error) {
      console.error('PDF 파일 읽기 오류:', error);
      alert('PDF 파일을 읽을 수 없습니다.');
    }
  };

  // 파일 선택 핸들러
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndSetFile(file);
      e.target.value = '';
    }
  };

  // 드래그앤드롭 핸들러
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  // 업로드 영역 클릭
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // PDF 4분할 처리
  const handleSplitPdf = async () => {
    if (!pdfFile) {
      alert('PDF 파일을 먼저 업로드해주세요.');
      return;
    }

    setIsProcessing(true);

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const srcDoc = await PDFDocument.load(arrayBuffer);
      const srcPages = srcDoc.getPages();

      // 새 PDF 문서 생성
      const newPdfDoc = await PDFDocument.create();

      for (let i = 0; i < srcPages.length; i++) {
        const srcPage = srcPages[i];
        const { width, height } = srcPage.getSize();

        // 각 페이지를 4등분 (2x2)
        // 좌상단, 우상단, 좌하단, 우하단 순서
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        const quadrants = [
          { x: 0, y: halfHeight, w: halfWidth, h: halfHeight },           // 좌상단
          { x: halfWidth, y: halfHeight, w: halfWidth, h: halfHeight },   // 우상단
          { x: 0, y: 0, w: halfWidth, h: halfHeight },                     // 좌하단
          { x: halfWidth, y: 0, w: halfWidth, h: halfHeight },             // 우하단
        ];

        for (const quad of quadrants) {
          // 원본 페이지를 embed
          const [embeddedPage] = await newPdfDoc.embedPdf(srcDoc, [i]);

          // 새 페이지 추가 (분할된 영역 크기로)
          const newPage = newPdfDoc.addPage([quad.w, quad.h]);

          // 분할된 영역만 표시되도록 위치 조정
          newPage.drawPage(embeddedPage, {
            x: -quad.x,
            y: -quad.y,
            width: width,
            height: height,
          });
        }
      }

      // PDF 저장
      const pdfBytes = await newPdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      // 다운로드
      const a = document.createElement('a');
      a.href = url;
      const originalName = pdfFile.name.replace('.pdf', '');
      a.download = `${originalName}_4분할.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert(`PDF 4분할 완료! (${srcPages.length}페이지 → ${srcPages.length * 4}페이지)`);

    } catch (error) {
      console.error('PDF 분할 오류:', error);
      alert('PDF 분할 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  // 파일 초기화
  const handleClearFile = () => {
    setPdfFile(null);
    setPageCount(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="pdf-split-layout">
      <TopsideMenu />
      <div className="pdf-split-main-content">
        <LeftsideMenu />
        <main className="pdf-split-content">
          <div className="pdf-split-container">
            <h1 className="pdf-split-title">PDF 분할</h1>

            <div className="pdf-split-section">
              <div className="pdf-split-board">
                <div
                  className={`pdf-split-upload-box ${isDragging ? 'drag-over' : ''} ${pdfFile ? 'has-file' : ''}`}
                  onClick={handleUploadClick}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  <div className="pdf-split-upload-icon">
                    {pdfFile ? '✅' : '📄'}
                  </div>
                  <div className="pdf-split-upload-text">
                    {pdfFile ? pdfFile.name : '클릭하여 PDF 파일을 선택하세요'}
                  </div>
                  <div className="pdf-split-upload-hint">
                    {pdfFile
                      ? `${pageCount}페이지 → 4분할 시 ${pageCount * 4}페이지`
                      : '클릭 또는 드래그앤드롭으로 파일을 업로드하세요'}
                  </div>
                </div>

                {pdfFile && (
                  <div className="pdf-split-file-info">
                    <span className="pdf-split-file-name">{pdfFile.name}</span>
                    <button
                      className="pdf-split-clear-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClearFile();
                      }}
                    >
                      삭제
                    </button>
                  </div>
                )}

                <button
                  className={`pdf-split-download-btn ${pdfFile ? 'active' : ''}`}
                  onClick={handleSplitPdf}
                  disabled={!pdfFile || isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <span style={{ marginRight: '8px' }}>처리 중...</span>
                      <span className="spinner"></span>
                    </>
                  ) : (
                    'PDF 4분할 다운로드'
                  )}
                </button>
              </div>
            </div>

            <div className="pdf-split-info-section">
              <div className="pdf-split-info-board">
                <h3>PDF 4분할 안내</h3>
                <ul>
                  <li>하나의 페이지를 4등분(2x2)하여 4개의 페이지로 만듭니다.</li>
                  <li>예: 2페이지 PDF → 8페이지 PDF</li>
                  <li>분할 순서: 좌상단 → 우상단 → 좌하단 → 우하단</li>
                </ul>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default PdfSplit;
