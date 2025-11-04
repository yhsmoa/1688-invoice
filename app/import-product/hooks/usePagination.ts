import { useState, useEffect } from 'react';
import { ItemData } from './useItemData';

export const usePagination = (filteredData: ItemData[], itemsPerPage: number = 20) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [paginatedData, setPaginatedData] = useState<ItemData[]>([]);
  const [totalPages, setTotalPages] = useState(1);

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

  return {
    currentPage,
    setCurrentPage,
    paginatedData,
    totalPages,
    handlePageChange,
    goToNextPage,
    goToPrevPage
  };
};
