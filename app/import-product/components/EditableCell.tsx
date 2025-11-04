'use client';

import React from 'react';

interface EditableCellProps {
  id: string;
  field: string;
  value: number | string | null | undefined;
  isEditing: boolean;
  editValue: string;
  type: 'number' | 'text';
  onStartEdit: (id: string, field: string, value: number | string | null | undefined) => void;
  onValueChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFinishEdit: (moveToNext: boolean) => void;
  className?: string;
}

const EditableCell: React.FC<EditableCellProps> = ({
  id,
  field,
  value,
  isEditing,
  editValue,
  type,
  onStartEdit,
  onValueChange,
  onKeyDown,
  onFinishEdit,
  className = ''
}) => {
  // 마우스 휠 스크롤로 숫자 변경 방지
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur(); // 포커스 해제하여 스크롤 변경 방지
  };

  return (
    <td className={className} onClick={() => onStartEdit(id, field, value)}>
      {isEditing ? (
        <input
          type={type}
          value={editValue}
          onChange={onValueChange}
          onKeyDown={onKeyDown}
          onBlur={() => onFinishEdit(false)}
          onWheel={handleWheel}
          className={type === 'number' ? 'qty-input-seamless' : 'note-input-seamless'}
          autoFocus
        />
      ) : (
        <div className={type === 'number' ? 'qty-display-seamless' : 'note-display-seamless'}>
          {value || ''}
        </div>
      )}
    </td>
  );
};

export default EditableCell;
