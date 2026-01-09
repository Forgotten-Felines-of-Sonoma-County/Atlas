/**
 * xlsx_reader.mjs
 *
 * Shared XLSX/XLS reading utility for Atlas ingest scripts.
 * Uses the 'xlsx' npm package to parse Excel files.
 *
 * Features:
 * - Reads first worksheet by default
 * - Handles empty headers (assigns _col_N)
 * - De-duplicates duplicate headers (adds _2, _3 suffix)
 * - Trims string values
 * - Returns { headers, rows } similar to csv_rfc4180.mjs
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

/**
 * Parse an XLSX or XLS file and return headers + rows.
 *
 * @param {string} filePath - Path to the Excel file
 * @param {object} options - Optional settings
 * @param {number} options.sheetIndex - Which sheet to read (0-based, default 0)
 * @param {string} options.sheetName - Sheet name to read (overrides sheetIndex)
 * @returns {{ headers: string[], rows: object[], sheetName: string }}
 */
export function parseXlsxFile(filePath, options = {}) {
  const { sheetIndex = 0, sheetName = null } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Read the workbook
  const workbook = XLSX.readFile(filePath, {
    type: 'file',
    cellDates: true,
    cellNF: false,
    cellText: false,
  });

  // Select sheet
  let targetSheetName;
  if (sheetName) {
    if (!workbook.SheetNames.includes(sheetName)) {
      throw new Error(`Sheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(', ')}`);
    }
    targetSheetName = sheetName;
  } else {
    if (sheetIndex >= workbook.SheetNames.length) {
      throw new Error(`Sheet index ${sheetIndex} out of range. Available: ${workbook.SheetNames.length} sheets`);
    }
    targetSheetName = workbook.SheetNames[sheetIndex];
  }

  const worksheet = workbook.Sheets[targetSheetName];

  // Convert to JSON with raw values
  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,  // Return array of arrays
    defval: '',
    blankrows: false,
    raw: false,  // Convert to strings
  });

  if (rawData.length === 0) {
    return { headers: [], rows: [], sheetName: targetSheetName };
  }

  // First row is headers
  const rawHeaders = rawData[0];
  const headers = normalizeHeaders(rawHeaders);

  // Remaining rows are data
  const rows = [];
  for (let i = 1; i < rawData.length; i++) {
    const rowArray = rawData[i];
    const rowObj = {};
    let hasData = false;

    for (let j = 0; j < headers.length; j++) {
      let value = j < rowArray.length ? rowArray[j] : '';

      // Trim strings
      if (typeof value === 'string') {
        value = value.trim();
      }

      // Convert dates to ISO strings
      if (value instanceof Date) {
        value = value.toISOString();
      }

      rowObj[headers[j]] = value;
      if (value !== '' && value !== null && value !== undefined) {
        hasData = true;
      }
    }

    // Skip completely empty rows
    if (hasData) {
      rows.push(rowObj);
    }
  }

  return { headers, rows, sheetName: targetSheetName };
}

/**
 * Normalize headers:
 * - Trim whitespace
 * - Replace empty headers with _col_N
 * - De-duplicate by adding _2, _3 suffix
 *
 * @param {any[]} rawHeaders
 * @returns {string[]}
 */
function normalizeHeaders(rawHeaders) {
  const seen = new Map();
  const headers = [];

  for (let i = 0; i < rawHeaders.length; i++) {
    let header = rawHeaders[i];

    // Convert to string and trim
    if (header === null || header === undefined || header === '') {
      header = `_col_${i + 1}`;
    } else {
      header = String(header).trim();
    }

    // De-duplicate
    if (seen.has(header)) {
      const count = seen.get(header) + 1;
      seen.set(header, count);
      header = `${header}_${count}`;
    } else {
      seen.set(header, 1);
    }

    headers.push(header);
  }

  return headers;
}

/**
 * Get list of sheet names in a workbook.
 *
 * @param {string} filePath
 * @returns {string[]}
 */
export function getSheetNames(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { bookSheets: true });
  return workbook.SheetNames;
}

/**
 * Check if a file can be read as Excel.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function canReadExcel(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    const workbook = XLSX.readFile(filePath, { bookSheets: true });
    return workbook.SheetNames.length > 0;
  } catch (e) {
    return false;
  }
}

export default {
  parseXlsxFile,
  getSheetNames,
  canReadExcel,
};
