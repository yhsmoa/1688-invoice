'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface SaveContextType {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
  checkUnsavedChanges: () => boolean;
}

const SaveContext = createContext<SaveContextType | undefined>(undefined);

export const SaveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const checkUnsavedChanges = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('저장하시겠습니까？\n你想保存吗？');
      if (confirmed) {
        // OK 클릭 시 - 저장하지 않고 이동 취소
        return false;
      }
      // NO 클릭 시 - 저장하지 않고 이동
      setHasUnsavedChanges(false);
      return true;
    }
    return true;
  }, [hasUnsavedChanges]);

  return (
    <SaveContext.Provider value={{ hasUnsavedChanges, setHasUnsavedChanges, checkUnsavedChanges }}>
      {children}
    </SaveContext.Provider>
  );
};

export const useSaveContext = () => {
  const context = useContext(SaveContext);
  if (context === undefined) {
    // Provider 외부에서 호출되면 기본값 반환 (다른 페이지에서 사용 시)
    return {
      hasUnsavedChanges: false,
      setHasUnsavedChanges: () => {},
      checkUnsavedChanges: () => true
    };
  }
  return context;
};
