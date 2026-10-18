'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import './ComboboxInput.css';

// ============================================================
// 입력형 + 드롭박스 (콤보박스)
//   · 타이핑하면 선택지를 부분일치로 걸러 드롭다운에 표시
//   · 클릭 또는 키보드(↑ ↓ Enter Esc)로 선택
//   · 선택지에 없는 값도 그대로 입력·저장 가능 — 기존 저장 값과 호환
//   · IME(중국어·한국어) 조합 중 Enter 는 조합 확정용이므로 선택으로 처리하지 않는다
// ============================================================
interface ComboboxInputProps {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  className?: string;
}

// ── 부분일치 필터 — 영문은 대소문자 무시 ──
const filterOptions = (options: readonly string[], query: string): readonly string[] => {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.toLowerCase().includes(q));
};

// ── 일치 구간 강조 ──
const renderHighlighted = (text: string, query: string) => {
  const q = query.trim();
  if (!q) return text;
  const start = text.toLowerCase().indexOf(q.toLowerCase());
  if (start < 0) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark className="cb-match">{text.slice(start, start + q.length)}</mark>
      {text.slice(start + q.length)}
    </>
  );
};

const ComboboxInput: React.FC<ComboboxInputProps> = ({ value, options, onChange, className }) => {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  /** 키보드로 가리킨 항목 — -1 이면 없음(Enter 시 입력값 그대로 유지) */
  const [activeIndex, setActiveIndex] = useState(-1);
  /** ▾ 버튼 등으로 연 경우 전체 목록 — 다시 타이핑하면 부분일치 필터로 돌아간다 */
  const [showAll, setShowAll] = useState(false);

  const matched = useMemo(() => filterOptions(options, value), [options, value]);
  const filtered = showAll ? options : matched;
  const showList = isOpen && filtered.length > 0;

  // ============================================================
  // 열기 · 닫기 · 선택
  // ============================================================
  const open = () => {
    setIsOpen(true);
    setShowAll(false);
    setActiveIndex(-1);
  };

  /** 전체 목록 열기 — 현재 값이 목록에 있으면 그 항목을 가리킨다 */
  const openAll = () => {
    setIsOpen(true);
    setShowAll(true);
    setActiveIndex(options.indexOf(value));
  };

  const close = () => {
    setIsOpen(false);
    setShowAll(false);
    setActiveIndex(-1);
  };

  /** 닫힌 상태에서 ↑↓ — 일치 항목이 없으면 전체 목록으로 연다 */
  const openByArrow = (dir: 'up' | 'down') => {
    const list = matched.length > 0 ? matched : options;
    setIsOpen(true);
    setShowAll(matched.length === 0);
    setActiveIndex(dir === 'down' ? 0 : list.length - 1);
  };

  const select = (option: string) => {
    onChange(option);
    close();
  };

  // ── 가리킨 항목이 목록 밖이면 스크롤 ──
  useEffect(() => {
    if (!showList || activeIndex < 0) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [showList, activeIndex]);

  // ============================================================
  // 키보드
  // ============================================================
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // ── IME 조합 중(keyCode 229 는 Safari 대응) ──
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!showList) {
          openByArrow('down');
        } else {
          setActiveIndex((i) => (i + 1) % filtered.length);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!showList) {
          openByArrow('up');
        } else {
          setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
        }
        break;
      case 'Enter':
        if (showList && activeIndex >= 0 && activeIndex < filtered.length) {
          e.preventDefault();
          select(filtered[activeIndex]);
        } else if (showList) {
          close();
        }
        break;
      case 'Escape':
        if (showList) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        close();
        break;
    }
  };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="cb-wrap">
      <input
        ref={inputRef}
        type="text"
        className={`${className ?? ''} cb-input`}
        value={value}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          open();
        }}
        onFocus={open}
        onClick={() => !isOpen && open()}
        onBlur={close}
        onKeyDown={handleKeyDown}
      />

      {/* ── 드롭다운 열기/닫기 버튼 — 입력값과 무관하게 전체 목록, 포커스는 입력칸에 유지 ── */}
      <button
        type="button"
        className="cb-toggle"
        tabIndex={-1}
        aria-hidden="true"
        onMouseDown={(e) => {
          e.preventDefault();
          if (showList) {
            close();
          } else {
            inputRef.current?.focus();
            openAll();
          }
        }}
      >
        ▾
      </button>

      {/* ── 선택지 목록 — mousedown 기본동작을 막아 blur 로 닫히기 전에 선택되게 한다 ── */}
      {showList && (
        <ul ref={listRef} id={listId} className="cb-list" role="listbox">
          {filtered.map((option, i) => (
            <li
              key={option}
              id={`${listId}-${i}`}
              role="option"
              title={option}
              aria-selected={i === activeIndex}
              className={`cb-option ${i === activeIndex ? 'cb-option-active' : ''} ${option === value ? 'cb-option-current' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => select(option)}
            >
              {renderHighlighted(option, showAll ? '' : value)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ComboboxInput;
