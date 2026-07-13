import React, { FC } from 'react';
import { ChevronRight } from 'lucide-react';

interface TEBreadcrumbProps {
  pages: string[];
  current: string;
}

const TEBreadcrumb: FC<TEBreadcrumbProps> = ({ pages, current }) => {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center flex-wrap gap-1"
    >
      {pages.map((page, idx) => {
        const isActive = page === current;
        const isLast = idx === pages.length - 1;

        return (
          <React.Fragment key={page}>
            <span
              aria-current={isActive ? 'page' : undefined}
              className={`
                inline-flex items-center
                px-3 py-1 rounded-full
                text-sm font-medium
                select-none transition-colors duration-150
                ${
                  isActive
                    ? 'bg-indigo-500 text-white shadow-[0_0_8px_1px_rgba(99,102,241,0.35)]'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-300 hover:bg-slate-700/70'
                }
              `}
            >
              {page}
            </span>

            {!isLast && (
              <ChevronRight
                size={12}
                className="text-slate-600 flex-shrink-0"
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export default TEBreadcrumb;

