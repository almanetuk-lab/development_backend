/**
 * csvUpdater.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads the QA CSV, updates Actual Result + Status columns for matched Test
 * Case IDs, then writes the file back.
 *
 * The CSV columns (0-indexed) are:
 *   0  = (empty leader)
 *   1  = Test Case ID
 *   2  = Module
 *   3  = Feature
 *   4  = Test Scenario
 *   5  = Preconditions
 *   6  = Test Steps
 *   7  = Expected Result
 *   8  = Actual Result   ← we write here
 *   9  = Status          ← we write here
 *   10 = Severity / Priority
 *   11 = Bug / Issue Details
 *   12 = Evidence / PR Reference
 *   13 = Remarks
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve path to the CSV at /home/ravinder/almanet/
// tests/helpers/ → tests/ → development_backend/ → almanet/
const CSV_PATH = path.resolve(__dirname, "../../../Client QA & Test Report - Sheet1.csv");


/**
 * Parse a CSV line respecting double-quoted fields that may contain commas.
 */
function parseLine(line) {
  const cols = [];
  let inQuotes = false;
  let cell = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cols.push(cell);
  return cols;
}

/**
 * Serialise a column value safely — wraps in quotes if it contains commas,
 * quotes, or newlines.
 */
function serializeCell(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * @param {Array<{id: string, status: string, actual: string}>} results
 */
export async function updateCsvResult(results) {
  if (!results || results.length === 0) return;

  let raw;
  try {
    raw = fs.readFileSync(CSV_PATH, "utf8");
  } catch (err) {
    console.error(`⚠️  Could not read CSV at ${CSV_PATH}: ${err.message}`);
    return;
  }

  // Build a fast lookup map: testId → result
  const map = new Map(results.map((r) => [r.id.trim().toUpperCase(), r]));

  const lines = raw.split("\n");
  let updatedCount = 0;

  const updatedLines = lines.map((line) => {
    const cols = parseLine(line);

    // Test Case ID is in column 1
    const rawId = (cols[1] ?? "").trim().toUpperCase();
    const result = map.get(rawId);

    if (!result) return line; // No match — leave line unchanged

    // Ensure the row has at least 14 columns
    while (cols.length < 14) cols.push("");

    // Update Actual Result (col 8) and Status (col 9)
    cols[8] = result.actual ?? "";
    cols[9] = result.status ?? "";

    updatedCount++;
    return cols.map(serializeCell).join(",");
  });

  try {
    fs.writeFileSync(CSV_PATH, updatedLines.join("\n"), "utf8");
    console.log(`\n📝  CSV updated — ${updatedCount} row(s) written to:\n    ${CSV_PATH}`);
  } catch (err) {
    console.error(`❌  Could not write CSV: ${err.message}`);
  }
}
