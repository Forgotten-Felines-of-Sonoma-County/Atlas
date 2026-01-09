/**
 * ingest_paths.mjs
 *
 * Centralized path configuration for Atlas ingest scripts.
 * Provides default base folders and RUN_DATE detection.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Default base ingest folder
export const DEFAULT_INGEST_BASE = process.env.LOCAL_INGEST_PATH ||
  path.join(os.homedir(), 'Desktop', 'AI_Ingest');

// Default run date (can be overridden via --date flag)
export const DEFAULT_RUN_DATE = process.env.INGEST_RUN_DATE || '2026-01-09';

/**
 * Get the run date from args or default.
 *
 * @param {string[]} args - Command line args
 * @returns {string} - Date string (YYYY-MM-DD)
 */
export function getRunDate(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return DEFAULT_RUN_DATE;
}

/**
 * Source path configurations by source system.
 */
export const SOURCE_PATHS = {
  airtable: {
    base: path.join(DEFAULT_INGEST_BASE, 'airtable'),
    tables: {
      trapping_requests: {
        subdir: 'trapping_requests',
        pattern: /^trapping.*\.csv$/i,
      },
      appointment_requests: {
        subdir: 'appointment_requests',
        pattern: /^appointment.*\.csv$/i,
      },
      project75_survey: {
        subdir: 'project75_after_clinic',
        pattern: /^project75.*\.csv$/i,
      },
      trappers: {
        subdir: 'trappers',
        pattern: /^trappers.*\.csv$/i,
      },
    },
  },
  clinichq: {
    base: path.join(DEFAULT_INGEST_BASE, 'clinichq'),
    useDateSubdir: true,
    tables: {
      appointment_info: {
        filename: 'appointment_info.xlsx',
      },
      cat_info: {
        filename: 'cat_info.xlsx',
      },
      owner_info: {
        filename: 'owner_info.xlsx',
      },
    },
  },
  volunteerhub: {
    base: path.join(DEFAULT_INGEST_BASE, 'volunteerhub'),
    useDateSubdir: true,
    tables: {
      users: {
        pattern: /^volunteerhub.*\.xlsx$/i,
      },
    },
  },
  shelterluv: {
    base: path.join(DEFAULT_INGEST_BASE, 'shelterluv'),
    useDateSubdir: true,
    tables: {
      animals: {
        pattern: /^shelterluv_animals.*\.xlsx$/i,
      },
      people: {
        pattern: /^shelterluv_people.*\.xlsx$/i,
      },
      outcomes: {
        pattern: /^shelterluv_outcomes.*\.xlsx$/i,
      },
    },
  },
  petlink: {
    base: path.join(DEFAULT_INGEST_BASE, 'petlink'),
    useDateSubdir: true,
    tables: {
      pets: {
        pattern: /^petlink_pet.*\.xls$/i,
      },
      owners: {
        pattern: /^petlink_owner.*\.xls$/i,
      },
    },
  },
  etapestry: {
    base: path.join(DEFAULT_INGEST_BASE, 'etapestry'),
    useDateSubdir: true,
    tables: {
      mailchimp_export: {
        pattern: /^etapestry_mailchimp.*\.csv$/i,
      },
    },
  },
};

/**
 * Find a file in a directory matching a pattern.
 *
 * @param {string} dir - Directory to search
 * @param {RegExp} pattern - Pattern to match
 * @returns {string|null} - Full path to file or null
 */
export function findFileByPattern(dir, pattern) {
  if (!fs.existsSync(dir)) {
    return null;
  }

  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (pattern.test(file)) {
      return path.join(dir, file);
    }
  }
  return null;
}

/**
 * Get the path for a source table's data file.
 *
 * @param {string} sourceSystem - e.g., 'clinichq'
 * @param {string} sourceTable - e.g., 'appointment_info'
 * @param {string} runDate - e.g., '2026-01-09'
 * @returns {string|null} - Full path or null if not found
 */
export function getSourceFilePath(sourceSystem, sourceTable, runDate = DEFAULT_RUN_DATE) {
  const systemConfig = SOURCE_PATHS[sourceSystem];
  if (!systemConfig) {
    return null;
  }

  const tableConfig = systemConfig.tables[sourceTable];
  if (!tableConfig) {
    return null;
  }

  let baseDir = systemConfig.base;
  if (systemConfig.useDateSubdir) {
    baseDir = path.join(baseDir, runDate);
  }

  // If exact filename specified
  if (tableConfig.filename) {
    const fullPath = path.join(baseDir, tableConfig.filename);
    return fs.existsSync(fullPath) ? fullPath : null;
  }

  // If subdir specified
  if (tableConfig.subdir) {
    baseDir = path.join(systemConfig.base, tableConfig.subdir);
  }

  // Pattern match
  if (tableConfig.pattern) {
    return findFileByPattern(baseDir, tableConfig.pattern);
  }

  return null;
}

/**
 * Get all available files for a source system on a given date.
 *
 * @param {string} sourceSystem
 * @param {string} runDate
 * @returns {Array<{sourceTable: string, filePath: string}>}
 */
export function getAvailableFiles(sourceSystem, runDate = DEFAULT_RUN_DATE) {
  const systemConfig = SOURCE_PATHS[sourceSystem];
  if (!systemConfig) {
    return [];
  }

  const available = [];
  for (const [sourceTable, tableConfig] of Object.entries(systemConfig.tables)) {
    const filePath = getSourceFilePath(sourceSystem, sourceTable, runDate);
    if (filePath) {
      available.push({ sourceTable, filePath });
    }
  }

  return available;
}

export default {
  DEFAULT_INGEST_BASE,
  DEFAULT_RUN_DATE,
  SOURCE_PATHS,
  getRunDate,
  getSourceFilePath,
  getAvailableFiles,
  findFileByPattern,
};
