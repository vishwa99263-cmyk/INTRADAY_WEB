import React, { FC } from 'react';

type Align = 'left' | 'right' | 'center';

export interface TETableColumn<T = any> {
  key: string;
  label: string;
  align?: Align;
  render?: (row: T) => React.ReactNode;
}

interface TETableProps<T = any> {
  columns: TETableColumn<T>[];
  data: T[];
  maxHeight?: string;
  emptyMessage?: string;
  className?: string;
}

const alignClass: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

const TETable: FC<TETableProps> = ({
  columns,
  data,
  maxHeight = '360px',
  emptyMessage = 'No data available.',
  className = '',
}) => {
  return (
    <div
      className={`relative w-full rounded-xl border border-slate-700/30 overflow-hidden bg-slate-900/90 ${className}`}
    >
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full text-sm border-collapse">
          {/* Sticky Header */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-950/90 backdrop-blur-sm border-b border-slate-700/40">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`
                    px-4 py-2.5
                    text-sm font-semibold tracking-wider uppercase
                    text-slate-400
                    ${alignClass[col.align ?? 'left']}
                    whitespace-nowrap
                  `}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-slate-500 text-sm italic"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className={`
                    border-b border-slate-700/20
                    transition-colors duration-100
                    hover:bg-slate-800/50
                    ${rowIdx % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/70'}
                  `}
                >
                  {columns.map((col) => {
                    const cellValue = (row as any)[col.key];
                    return (
                      <td
                        key={col.key}
                        className={`
                          px-4 py-2.5
                          text-slate-200
                          ${alignClass[col.align ?? 'left']}
                          whitespace-nowrap
                        `}
                      >
                        {col.render ? col.render(row) : (cellValue ?? '—')}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TETable;

