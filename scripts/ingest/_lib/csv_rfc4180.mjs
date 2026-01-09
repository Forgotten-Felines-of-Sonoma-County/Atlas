/**
 * csv_rfc4180.mjs
 *
 * RFC 4180 compliant CSV parser
 * Handles: quoted fields, embedded newlines, escaped quotes, BOM
 *
 * Usage:
 *   import { parseCsvFile, parseCsvString } from './_lib/csv_rfc4180.mjs';
 *   const { headers, rows } = parseCsvFile('/path/to/file.csv');
 */

import fs from 'fs';

/**
 * Parse CSV content following RFC 4180 spec
 * @param {string} content - Raw CSV content
 * @returns {string[][]} Array of rows, each row is array of field values
 */
export function parseCsvRfc4180(content) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote ("") -> single quote
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        // Any character inside quotes (including newlines)
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
        i++;
      } else if (char === ',') {
        // End of field
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
      } else if (char === '\r' && nextChar === '\n') {
        // CRLF line ending
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i += 2;
      } else if (char === '\n') {
        // LF line ending
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else if (char === '\r') {
        // CR line ending (old Mac)
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Handle last field/row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  // Filter out empty rows
  return rows.filter(row => row.length > 0 && row.some(cell => cell !== ''));
}

/**
 * Parse CSV string into header + row objects
 * @param {string} content - Raw CSV content
 * @returns {{ headers: string[], rows: object[] }}
 */
export function parseCsvString(content) {
  // Remove BOM if present
  const cleanContent = content.charCodeAt(0) === 0xFEFF
    ? content.slice(1)
    : content;

  const rawRows = parseCsvRfc4180(cleanContent);

  if (rawRows.length < 1) {
    return { headers: [], rows: [] };
  }

  const headers = rawRows[0];
  const dataRows = rawRows.slice(1);

  // Convert to objects
  const rows = dataRows.map(values => {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    return row;
  });

  return { headers, rows };
}

/**
 * Parse CSV file into header + row objects
 * @param {string} filePath - Path to CSV file
 * @returns {{ headers: string[], rows: object[] }}
 */
export function parseCsvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return parseCsvString(content);
}

/**
 * Get row count from CSV file (without full parse)
 * Note: This does a full parse for accuracy with embedded newlines
 * @param {string} filePath - Path to CSV file
 * @returns {number} Number of data rows (excluding header)
 */
export function getCsvRowCount(filePath) {
  const { rows } = parseCsvFile(filePath);
  return rows.length;
}
