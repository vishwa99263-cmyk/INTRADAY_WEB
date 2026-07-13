import { StockData, OptionStrike } from "./types.js";

// Excel Formula Engine mapped to JavaScript logic
export const EXCEL_FUNCTIONS = {
  SUM: (arr: number[]): number => arr.reduce((acc, curr) => acc + (curr || 0), 0),
  
  AVERAGE: (arr: number[]): number => {
    if (arr.length === 0) return 0;
    return EXCEL_FUNCTIONS.SUM(arr) / arr.length;
  },

  ABS: (num: number): number => Math.abs(num),

  ROUND: (num: number, decimals: number = 0): number => {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  },

  COUNTIF: (arr: number[], criterion: string): number => {
    if (criterion.startsWith(">")) {
      const val = parseFloat(criterion.substring(1));
      return arr.filter(v => v > val).length;
    } else if (criterion.startsWith("<")) {
      const val = parseFloat(criterion.substring(1));
      return arr.filter(v => v < val).length;
    }
    const val = parseFloat(criterion);
    return arr.filter(v => v === val).length;
  },

  SUMIF: (items: any[], checkKey: string, valKey: string, criterionUrl: string): number => {
    // Criterion e.g. ">0"
    let checkFn = (val: number) => true;
    if (criterionUrl.startsWith(">")) {
      const threshold = parseFloat(criterionUrl.substring(1));
      checkFn = (val: number) => val > threshold;
    } else if (criterionUrl.startsWith("<")) {
      const threshold = parseFloat(criterionUrl.substring(1));
      checkFn = (val: number) => val < threshold;
    } else {
      const threshold = parseFloat(criterionUrl);
      checkFn = (val: number) => val === threshold;
    }

    return items.reduce((acc, item) => {
      const checkVal = parseFloat(item[checkKey]);
      const value = parseFloat(item[valKey]);
      if (checkFn(checkVal)) {
        return acc + (isNaN(value) ? 0 : value);
      }
      return acc;
    }, 0);
  }
};

// Evaluate formula inputs
export const parseAndEvaluateFormula = (input: string, stocks: StockData[]): string => {
  if (!input.startsWith("=")) return input;

  try {
    const clean = input.substring(1).toUpperCase().trim();

    // Check custom Excel functions
    if (clean.startsWith("SUM(")) {
      const insideObj = clean.substring(4, clean.length - 1);
      // If it's a field like SCORE
      if (insideObj === "SCORE") {
        return EXCEL_FUNCTIONS.SUM(stocks.map(s => s.score)).toFixed(3);
      }
      if (insideObj === "WEIGHTAGE") {
        return EXCEL_FUNCTIONS.SUM(stocks.map(s => s.weightage)).toFixed(2);
      }
    }

    if (clean.startsWith("AVERAGE(")) {
      const insideObj = clean.substring(8, clean.length - 1);
      if (insideObj === "LTP") {
        return EXCEL_FUNCTIONS.AVERAGE(stocks.map(s => s.ltp)).toFixed(2);
      }
    }

    if (clean.startsWith("COUNTIF(")) {
      const matched = clean.match(/COUNTIF\(([^,]+)\s*,\s*\"([^\"]+)\"\)/);
      if (matched) {
        const fieldName = matched[1].trim();
        const criterion = matched[2].trim();
        let targetVals: number[] = [];
        if (fieldName === "CHANGEPERCENT" || fieldName === "CHANGERANGE") {
          targetVals = stocks.map(s => s.changePercent);
        } else if (fieldName === "SCORE") {
          targetVals = stocks.map(s => s.score);
        }
        return EXCEL_FUNCTIONS.COUNTIF(targetVals, criterion).toString();
      }
    }

    // Direct arithmetic e.g. "HDFCBANK*LTP" or "SYMBOL1*SCORE"
    const parts = clean.split("*");
    if (parts.length === 2) {
      const stockName = parts[0].trim();
      const variable = parts[1].trim();
      const st = stocks.find(s => s.symbol.toUpperCase() === stockName);
      if (st) {
        if (variable === "LTP") return (st.ltp).toFixed(2);
        if (variable === "WEIGHTAGE") return (st.weightage).toFixed(2);
        if (variable === "%CHANGE" || variable === "CHANGEPERCENT") return (st.changePercent).toFixed(2);
      }
    }

    return "ERR: Syntax";
  } catch (err) {
    return "ERR: Formula";
  }
};

// Export to CSV
export const exportToCSV = (filename: string, headers: string[], rows: any[][]) => {
  const csvContent = "data:text/csv;charset=utf-8," 
    + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Export to Print / PDF Structure (we utilize native page-break styled PDF-preview/print flow which matches perfect typography without huge dependencies)
export const printReport = (title: string, selectorId: string) => {
  const content = document.getElementById(selectorId);
  if (!content) return;

  const originalBody = document.body.innerHTML;
  const printWindow = window.open('', '', 'height=800,width=1200');
  
  if (printWindow) {
    printWindow.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: 'Inter', sans-serif; padding: 20px; color: #1e293b; background: white; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; font-size: 11px; }
            th { background-color: #f1f5f9; font-weight: 600; }
            h1 { font-size: 20px; margin-bottom: 5px; color: #0f172a; }
            .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 10px; }
            .bg-green { background-color: #d1fae5; color: #065f46; }
            .bg-red { background-color: #fee2e2; color: #991b1b; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <p style="font-size: 12px; color: #64748b; margin-bottom: 20px;">Generated on: ${new Date().toLocaleString()}</p>
          ${content.outerHTML}
          <script>
            window.onload = function() {
              window.print();
              window.close();
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
};
