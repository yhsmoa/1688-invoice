'use client';

import React, { useMemo, useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import {
  PAGE_TABLE_MAP,
  MISSING_TABLES,
  EXTERNAL_TABLES,
  tablesOfPage,
  buildTableIndex,
  type PageEntry,
} from './pageTableMap';
import './DatabaseManage.css';

// ============================================================
// 데이터베이스 관리
//   프로젝트의 각 페이지가 사용하는 Supabase 테이블을 정리한 문서 화면.
//   · 페이지 기준 / 테이블 기준 두 가지 뷰 제공
//   · 정적 매핑(pageTableMap.ts) 기반 — DB 조회 없음
// ============================================================

type ViewMode = 'page' | 'table';

// ── 테이블 칩 ──
const TableChip: React.FC<{ table: string }> = ({ table }) => {
  const missing = MISSING_TABLES.has(table);
  const external = EXTERNAL_TABLES.has(table);
  const cls = missing ? 'dm-chip dm-chip-missing' : external ? 'dm-chip dm-chip-external' : 'dm-chip';
  const title = missing
    ? 'DB(manage-item)에 존재하지 않는 테이블'
    : external
    ? '별도 Supabase 프로젝트(stock_management)의 테이블'
    : undefined;

  return (
    <span className={cls} title={title}>
      {table}
      {missing && <span className="dm-chip-mark">없음</span>}
      {external && <span className="dm-chip-mark">외부</span>}
    </span>
  );
};

const DatabaseManage: React.FC = () => {
  const [view, setView] = useState<ViewMode>('page');
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tableIndex = useMemo(() => buildTableIndex(), []);
  const kw = keyword.trim().toLowerCase();

  // ── 페이지 기준 필터 ──
  const filteredGroups = useMemo(() => {
    if (!kw) return PAGE_TABLE_MAP;
    return PAGE_TABLE_MAP.map((g) => ({
      ...g,
      pages: g.pages.filter(
        (p) =>
          p.name.toLowerCase().includes(kw) ||
          p.route.toLowerCase().includes(kw) ||
          tablesOfPage(p).some((t) => t.toLowerCase().includes(kw)) ||
          p.apis.some((a) => a.route.toLowerCase().includes(kw))
      ),
    })).filter((g) => g.pages.length > 0);
  }, [kw]);

  // ── 테이블 기준 필터 ──
  const filteredTables = useMemo(() => {
    if (!kw) return tableIndex;
    return tableIndex.filter(
      (t) => t.table.toLowerCase().includes(kw) || t.pages.some((p) => p.name.toLowerCase().includes(kw))
    );
  }, [kw, tableIndex]);

  // ── 통계 ── (미존재는 실제 페이지에서 참조되는 것만 집계)
  const stats = useMemo(() => {
    const pageCount = PAGE_TABLE_MAP.reduce((n, g) => n + g.pages.length, 0);
    const missingCount = tableIndex.filter((t) => MISSING_TABLES.has(t.table)).length;
    return { pageCount, tableCount: tableIndex.length, missingCount };
  }, [tableIndex]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── 페이지 카드 ──
  const renderPage = (page: PageEntry, groupName: string) => {
    const key = `${groupName}::${page.route}`;
    const tables = tablesOfPage(page);
    const isOpen = expanded.has(key);

    return (
      <div className="dm-card" key={key}>
        <div className="dm-card-head" onClick={() => toggle(key)}>
          <div className="dm-card-title">
            <span className="dm-card-name">{page.name}</span>
            <code className="dm-card-route">{page.route}</code>
          </div>
          <div className="dm-card-meta">
            <span className="dm-count">테이블 {tables.length}</span>
            <span className={`dm-arrow ${isOpen ? 'open' : ''}`}>▼</span>
          </div>
        </div>

        <div className="dm-card-tables">
          {tables.length > 0 ? (
            tables.map((t) => <TableChip key={t} table={t} />)
          ) : (
            <span className="dm-none">사용 테이블 없음</span>
          )}
          {page.external?.map((e) => (
            <span className="dm-chip dm-chip-source" key={e}>
              {e}
            </span>
          ))}
        </div>

        {page.note && <p className="dm-note">{page.note}</p>}

        {isOpen && (
          <div className="dm-detail">
            <div className="dm-detail-file">
              <span className="dm-detail-label">파일</span>
              <code>{page.file}</code>
            </div>
            {page.apis.length > 0 && (
              <table className="dm-api-table">
                <thead>
                  <tr>
                    <th>API route</th>
                    <th>사용 테이블</th>
                  </tr>
                </thead>
                <tbody>
                  {page.apis.map((api) => (
                    <tr key={api.route}>
                      <td>
                        <code>{api.route}</code>
                      </td>
                      <td>
                        {api.tables.length > 0 ? (
                          api.tables.map((t) => <TableChip key={t} table={t} />)
                        ) : (
                          <span className="dm-none">— (Sheets / 외부 API)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="dm-main">
          {/* ── 페이지 헤더 ── */}
          <div className="dm-page-header">
            <h1 className="dm-page-title">데이터베이스 관리</h1>
            <div className="dm-stats">
              <span>페이지 {stats.pageCount}</span>
              <span>테이블 {stats.tableCount}</span>
              {stats.missingCount > 0 && (
                <span className="dm-stat-warn">미존재 {stats.missingCount}</span>
              )}
            </div>
          </div>

          {/* ── DB 연결 정보 ── */}
          <div className="dm-db-info">
            <div className="dm-db-row">
              <span className="dm-db-label">기본 DB</span>
              <code>manage-item</code>
              <span className="dm-db-desc">lib/supabase.ts · SUPABASE_URL — ft_*, invoiceManager_*, 1688_* 등</span>
            </div>
            <div className="dm-db-row">
              <span className="dm-db-label dm-db-label-sub">보조 DB</span>
              <code>stock_management</code>
              <span className="dm-db-desc">
                lib/stockSupabase.ts · STOCK_SUPABASE_URL — si_users + 개인통관 PDF Storage
              </span>
            </div>
          </div>

          {/* ── 뷰 전환 + 검색 ── */}
          <div className="dm-toolbar">
            <div className="dm-tabs">
              <button
                className={`dm-tab ${view === 'page' ? 'active' : ''}`}
                onClick={() => setView('page')}
              >
                페이지 기준
              </button>
              <button
                className={`dm-tab ${view === 'table' ? 'active' : ''}`}
                onClick={() => setView('table')}
              >
                테이블 기준
              </button>
            </div>
            <input
              className="dm-search"
              type="text"
              placeholder="페이지명 · 경로 · 테이블명 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>

          {/* ============================================================ */}
          {/* 페이지 기준 뷰                                              */}
          {/* ============================================================ */}
          {view === 'page' && (
            <div className="dm-content">
              {filteredGroups.length === 0 && <div className="dm-empty">검색 결과가 없습니다.</div>}
              {filteredGroups.map((group) => (
                <section className="dm-group" key={group.group}>
                  <div className="dm-group-head">
                    <h2 className="dm-group-title">{group.group}</h2>
                    <span className="dm-group-desc">{group.desc}</span>
                  </div>
                  {group.pages.map((page) => renderPage(page, group.group))}
                </section>
              ))}
            </div>
          )}

          {/* ============================================================ */}
          {/* 테이블 기준 뷰                                              */}
          {/* ============================================================ */}
          {view === 'table' && (
            <div className="dm-content">
              {filteredTables.length === 0 && <div className="dm-empty">검색 결과가 없습니다.</div>}
              {filteredTables.length > 0 && (
                <table className="dm-table-view">
                  <thead>
                    <tr>
                      <th className="dm-col-table">테이블</th>
                      <th className="dm-col-count">사용</th>
                      <th>사용 페이지</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTables.map((row) => (
                      <tr key={row.table}>
                        <td>
                          <TableChip table={row.table} />
                        </td>
                        <td className="dm-col-count">{row.pages.length}</td>
                        <td>
                          <div className="dm-page-links">
                            {row.pages.map((p) => (
                              <span className="dm-page-link" key={`${row.table}-${p.route}`}>
                                {p.name}
                                <code>{p.route}</code>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── 안내 ── */}
          <p className="dm-footer-note">
            코드에서 도출한 정적 매핑입니다 (페이지 → 호출 API → <code>.from(&apos;테이블&apos;)</code>). API route 를
            추가·변경하면 <code>app/db/database/pageTableMap.ts</code> 도 함께 갱신해주세요.
          </p>
        </main>
      </div>
    </div>
  );
};

export default DatabaseManage;
