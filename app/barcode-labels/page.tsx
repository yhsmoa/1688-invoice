'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import jsPDF from 'jspdf';
import './BarcodeLabels.css';

interface ProductData {
  id: string;
  product_name: string | null;
  option_name: string | null;
  barcode: string | null;
  china_option1?: string | null;
  china_option2?: string | null;
}

const BarcodeLabels: React.FC = () => {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const productIds = searchParams.get('ids');
    if (productIds) {
      fetchSelectedProducts(productIds.split(','));
    } else {
      setLoading(false);
    }
  }, [searchParams]);

  const fetchSelectedProducts = async (ids: string[]) => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/get-selected-products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });
      
      if (!response.ok) {
        throw new Error('상품 데이터를 불러오는데 실패했습니다.');
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        console.log('받은 상품 데이터:', result.data);
        setProducts(result.data);
        // 데이터 로드 완료 후 자동으로 인쇄 대화상자 열기
        setTimeout(() => {
          window.print();
        }, 500);
      } else {
        setProducts([]);
      }
      
    } catch (error) {
      console.error('상품 데이터 가져오기 오류:', error);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const generateBarcodeUrl = (barcode: string) => {
    // Code 128 바코드 생성 - 텍스트 표시 포함
    return `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(barcode)}&code=Code128&dpi=300&multiplebarcodes=false&translate-esc=false&unit=Mm&eclevel=L`;
  };

  const getProductLabel = (product: ProductData) => {
    const parts = [];
    if (product.product_name) parts.push(product.product_name);
    if (product.option_name) parts.push(product.option_name);
    return parts.join(' ');
  };

  const getChinaOptions = (product: ProductData) => {
    const parts = [];
    if (product.china_option1) parts.push(product.china_option1);
    if (product.china_option2) parts.push(product.china_option2);
    return parts.join(' ');
  };

  const handlePrint = () => {
    window.print();
  };

  // 더 간단한 방법: HTML을 이미지로 변환해서 PDF 생성
  const generatePDF = async () => {
    try {
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm', 
        format: [60, 40]
      });

      let isFirstPage = true;

      // 각 상품에 대해 PDF 페이지 생성
      for (const product of products) {
        if (!isFirstPage) {
          pdf.addPage([60, 40], 'landscape');
        }
        isFirstPage = false;

        // 테두리
        pdf.setLineWidth(0.3);
        pdf.rect(2, 2, 56, 36);

        // 상품명 (영어로 변환하거나 단순화)
        const productLabel = getProductLabel(product);
        const simpleLabel = productLabel || 'Product';
        
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'bold');
        
        // 텍스트 길이에 따라 줄바꿈
        const lines = pdf.splitTextToSize(simpleLabel, 50);
        let yPos = 15;
        
        lines.forEach((line: string, index: number) => {
          if (index < 3) { // 최대 3줄만
            pdf.text(line, 30, yPos + (index * 4), { align: 'center' });
          }
        });

        // 바코드 번호 텍스트 (바코드 이미지 대신)
        if (product.barcode) {
          pdf.setFontSize(6);
          pdf.setFont('helvetica', 'normal');
          pdf.text('Barcode:', 30, 30, { align: 'center' });
          pdf.text(product.barcode, 30, 34, { align: 'center' });
        }
      }

      pdf.save('barcode-labels.pdf');
      
    } catch (error) {
      console.error('PDF 생성 오류:', error);
      alert('PDF 생성 중 오류가 발생했습니다.');
    }
  };

  if (loading) {
    return (
      <div className="barcode-loading">
        <p>바코드 라벨을 생성하는 중...</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="barcode-error">
        <p>표시할 상품이 없습니다.</p>
        <button onClick={() => window.history.back()} className="back-btn">
          돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="barcode-labels-container">
      {/* 인쇄 버튼 (인쇄 시에는 숨겨짐) */}
      <div className="barcode-controls no-print">
        <button onClick={generatePDF} className="print-btn">
          PDF 생성
        </button>
        <button onClick={handlePrint} className="print-btn" style={{backgroundColor: '#6c757d'}}>
          웹 인쇄
        </button>
        <button onClick={() => window.history.back()} className="back-btn">
          돌아가기
        </button>
      </div>

      {/* 바코드 라벨들 */}
      <div className="barcode-labels-grid">
        {products.map((product) => (
          <div key={product.id} className="barcode-label">
            <div className="product-info">
              <h3 className="product-name">
                {getProductLabel(product)}
              </h3>
            </div>
            <div className="barcode-section">
              {product.barcode ? (
                <>
                  <img 
                    src={generateBarcodeUrl(product.barcode)} 
                    alt={`바코드: ${product.barcode}`}
                    className="barcode-image"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                      img.parentElement!.innerHTML += '<div class="barcode-error-text">바코드 생성 실패</div>';
                    }}
                  />
                </>
              ) : (
                <div className="no-barcode">바코드 없음</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BarcodeLabels;