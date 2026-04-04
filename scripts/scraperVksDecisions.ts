// ============================================================================
// scraperVksDecisions.ts
//
// PURPOSE
//   Downloads the full text of VKS (Върховен касационен съд) decisions
//   and stores them as structured plain text in a JSONL file.
//   Supports both Commercial and Civil departments via the --department flag.
//
// SYSTEM OVERVIEW
//   1. METADATA SOURCE
//      The list of decisions to download comes from the links scraper output:
//        downloads/vks/department_commercial/decisions/decisionsLinksMetadataCommercial.ts
//        downloads/vks/department_civil/decisions/decisionsLinksMetadataCivil.ts
//      That file is produced by scraperVksDecisionsLinks.ts.
//
//   2. WHAT THIS SCRIPT DOES
//      For each decision in the metadata list it:
//        a) Fetches the decision HTML from the VKS website
//        b) Extracts the decision text from the HTML (the site uses very old HTML —
//           table-based layouts, font tags, windows-1251 encoding)
//        c) Cleans and structures the text into a consistent format
//        d) Validates the result (Cyrillic present, sufficient length, no HTML leftovers)
//        e) Appends one JSON line to the output JSONL file
//
//   3. OUTPUT FORMAT (one JSON object per line in the JSONL file)
//      {
//        actType:     string   — always "decision"
//        actId:       string   — unique hash ID from the VKS URL
//        actNumber:   string   — e.g. "42"
//        actDate:     string   — e.g. "15.03.2023"
//        caseNumber:  string   — e.g. "1234"
//        caseYear:    string   — e.g. "2022"
//        department:  string   — "commercial" or "civil"
//        actTitle:    string   — original page title from the search index
//        actUrl:      string   — original source URL
//        actPlainText: string  — cleaned, structured decision text (see PLAIN TEXT FORMAT)
//        validation:  object   — isValid, contentHash, wordCount
//        processedAt: string   — ISO timestamp
//      }
//
//   4. PLAIN TEXT FORMAT (the `actPlainText` field)
//      Every decision is structured as:
//
//        Р Е Ш Е Н И Е          ← title line (as printed in the original, may be letter-spaced)
//
//        № N                     ← decision number
//
//        В ИМЕНОТО НА НАРОДА    ← "In the Name of the People" (separated out when merged)
//
//        гр. София, дата…        ← city + date (own paragraph)
//        Върховният касационен съд…  ← court description (own paragraph)
//
//        ПРЕДСЕДАТЕЛ: X          ← court composition block — all on consecutive lines,
//        ЧЛЕНОВЕ: Y              ←   NO blank lines between them
//        Name2                   ←
//        при секретаря …         ←
//        като изслуша докладваното …  ←
//        т.дело № …              ←
//        за да се произнесе, взе предвид:  ← last procedural line before body
//
//        [BODY / REASONING]      ← substantive legal reasoning, multiple paragraphs,
//                                   blank lines preserved as-is (never merged or removed)
//
//        Р Е Ш И :               ← ruling marker (kept as part of body)
//        ОТМЕНЯ / ОТХВЪРЛЯ…      ← operative ruling paragraphs
//        Решението е окончателно.
//
//        ПРЕДСЕДАТЕЛ:            ← footer signature placeholders (kept as-is)
//        ЧЛЕНОВЕ: 1.
//        2.
//
//   5. RESUME / IDEMPOTENT OPERATION
//      The script reads the existing JSONL output on startup and skips any
//      actId that is already present. Run with --resume to continue an
//      interrupted batch. Safe to run multiple times.
//
//   6. IGNORE LIST
//      decisions/ignorelist.json contains actIds that should never be
//      attempted (e.g. decisions that consistently return garbage, redirect
//      to an error page, or have known encoding corruption). Add IDs there
//      manually if needed. Missing file is handled gracefully (empty set).
//
//   NOTE: decisionsDataCivil.jsonl is a new file — civil content has never
//         been fetched before. Run with --department civil to create it.
//
// USAGE (run from project root)
//   npx ts-node scripts/scraperVksDecisions.ts --department commercial           # process all
//   npx ts-node scripts/scraperVksDecisions.ts --department commercial --limit 10  # test run
//   npx ts-node scripts/scraperVksDecisions.ts --department commercial --limit 10 --verbose
//   npx ts-node scripts/scraperVksDecisions.ts --department commercial --resume   # continue interrupted run
//   npx ts-node scripts/scraperVksDecisions.ts --department civil --limit 10      # first civil test run
//
// OUTPUT FILES (per department)
//   decisions/decisionsDataCommercial.jsonl  — one decision per line (append-only)
//   decisions/decisionsDataCivil.jsonl       — one decision per line (append-only, new)
//   decisions/processingReport.json          — live stats, failure log, ETA
//
// RELATED SCRIPTS
//   scripts/scraperVksDecisionsLinks.ts  — builds the metadata input file
//   scripts/test-clean-content.js        — validates the actPlainText structuring
//                                          logic against the existing JSONL
//   scripts/chunk-for-rag.js             — next step: chunks the actPlainText
//                                          for embedding / RAG pipeline
// ============================================================================

import http from 'http';           // Node built-in — VKS uses plain HTTP (not HTTPS)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';       // Used to create a short content hash for dedup / change detection
import { fileURLToPath } from 'url';
import iconv from 'iconv-lite';    // CRITICAL: VKS website uses Windows-1251 encoding (old Bulgarian
                                   // government site). Node's built-in http returns raw bytes; we must
                                   // decode with iconv-lite. Using utf-8 here produces mojibake.

// ============================================================================
// Types
// ============================================================================

/** One entry from the metadata file produced by scraperVksDecisionsLinks.ts. */
interface IActMetadata {
  actType: string;        // always "decision"
  actId: string;          // SHA-based unique ID derived from the VKS URL
  actUrl: string;         // Direct URL to the decision on the VKS site (plain HTTP)
  actTitle: string;       // Page title as it appeared in the search index
  actNumber: string;      // e.g. "1", "42" — the sequential number for that year
  actDate: string;        // e.g. "21.05.2014" — Bulgarian date format
  caseNumber: string;     // e.g. "592" — the case docket number
  caseYear: string;       // e.g. "2012" — year the case was filed
  department: string;     // "commercial" or "civil"
}

/** One fully processed decision ready to be written to the JSONL output file. */
interface IProcessedAct {
  actType: string;
  actId: string;
  actNumber: string;
  actDate: string;
  caseNumber: string;
  caseYear: string;
  department: string;
  actTitle: string;
  actUrl: string;
  actPlainText: string;   // Structured plain text — see PLAIN TEXT FORMAT in the file header
  validation: {
    isValid: boolean;
    contentHash: string;  // First 8 chars of SHA-256 of the actPlainText — used for change detection
    wordCount: number;
  };
  processedAt: string;    // ISO timestamp of when this decision was processed
}

/** Recorded when a decision consistently fails validation (bad HTML, wrong content, etc.). */
interface IFailureActRecord {
  actType: string;
  actId: string;
  department: string;
  reason: string;
  retries: number;
  firstAttempt: string;
  lastAttempt?: string;
}

/** Recorded when a decision fails due to network issues (timeout, connection reset, etc.).
 *  These are worth retrying later; validation failures are not. */
interface INetworkErrorActRecord {
  actType: string;
  actId: string;
  department: string;
  error: string;
  retries: number;
  firstAttempt: string;
  lastAttempt?: string;
}

/** Schema of the ignorelist.json file.
 *  Add actIds here manually for decisions that should always be skipped
 *  (e.g. permanently broken pages, known garbage content). */
interface IgnoreList {
  blacklistedIds: string[];
  reason: string;
  lastUpdated?: string;
}

/** Live processing report written to processingReport.json after every decision. */
interface ProcessingReport {
  scriptRun: {
    startTime: string;
    endTime?: string;
    duration?: string;
    resume: boolean;
    limitFlag?: number;
  };
  stats: {
    total: number;
    processed: number;
    successful: number;
    skipped: number;
    failed: number;
    percentComplete: number;
    estimatedTimeRemaining?: string;
  };
  failures: IFailureActRecord[];
  networkErrors: INetworkErrorActRecord[];
  blacklisted: number;
}

interface CLIOptions {
  limit?: number;
  resume: boolean;
  verbose: boolean;
  department: string;
}

// ============================================================================
// Configuration (built after CLI args are parsed — department is required)
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let CONFIG = {
  METADATA_FILE: '',
  OUTPUT_DIR: '',
  OUTPUT_FILE: '',
  REPORT_FILE: '',
  IGNORE_LIST_FILE: '',
  API_DELAY_MS: 3000,
  TIMEOUT_PER_REQUEST: 30000,
  MAX_RETRIES: 3,
  VALIDATION_MIN_CONTENT_LENGTH: 1000,
  VALIDATION_MIN_WORD_COUNT: 50,
};

function buildConfig(department: string): void {
  const dept = department.charAt(0).toUpperCase() + department.slice(1);
  const dir  = path.join(__dirname, `../downloads/vks/department_${department}/decisions`);
  CONFIG.METADATA_FILE    = path.join(dir, `decisionsLinksMetadata${dept}.ts`);
  CONFIG.OUTPUT_DIR       = dir;
  CONFIG.OUTPUT_FILE      = path.join(dir, `decisionsData${dept}.jsonl`);
  CONFIG.REPORT_FILE      = path.join(dir, 'processingReport.json');
  CONFIG.IGNORE_LIST_FILE = path.join(dir, 'ignorelist.json');
}

// ── Module-level state ────────────────────────────────────────────────────────

let cliOptions: CLIOptions = { limit: undefined, resume: false, verbose: false, department: '' };
let processingStartTime: number;
let decisionsFetched = 0;
let blacklistedCount = 0;
let ignoreList: Set<string>;

// ============================================================================
// Validation System
// ============================================================================

class DecisionValidator {
  validate(content: string): {
    isValid: boolean;
    issues: string[];
    contentLength: number;
    wordCount: number;
    hash: string;
  } {
    const issues: string[] = [];

    if (content.length < CONFIG.VALIDATION_MIN_CONTENT_LENGTH) {
      issues.push(`Content too short: ${content.length} chars (expected > ${CONFIG.VALIDATION_MIN_CONTENT_LENGTH})`);
    }

    const words = content.split(/\s+/).length;
    if (words < CONFIG.VALIDATION_MIN_WORD_COUNT) {
      issues.push(`Too few words: ${words} (expected > ${CONFIG.VALIDATION_MIN_WORD_COUNT})`);
    }

    if (!/[А-Яа-я]/.test(content)) {
      issues.push(`No Cyrillic text detected - possible encoding error`);
    }

    const HTML_TAG_RE = /<\/?\s*(div|span|p|br|font|table|tr|td|th|a|b|i|u|em|strong|img|script|style|link|head|body|html|form|input|select|option|textarea|button|h[1-6]|ul|ol|li|dl|dt|dd|blockquote|pre|code|hr|meta|title|header|footer|nav|section|article|aside|main|figure|figcaption|caption|col|colgroup|thead|tbody|tfoot)\b[^>]*>/i;
    if (HTML_TAG_RE.test(content) || /face=|align=|size=/.test(content)) {
      issues.push(`HTML artifacts found in cleaned content`);
    }

    if (!/\d/.test(content)) {
      issues.push(`No numbers detected - decision metadata missing`);
    }

    const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);

    return {
      isValid: issues.length === 0,
      issues,
      contentLength: content.length,
      wordCount: words,
      hash,
    };
  }
}

const validator = new DecisionValidator();

// ============================================================================
// Utility Functions
// ============================================================================

function log(message: string, verbose = false): void {
  if (!verbose || cliOptions.verbose) {
    console.log(message);
  }
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = { limit: undefined, resume: false, verbose: false, department: '' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--resume') {
      options.resume = true;
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    } else if (args[i] === '--department' && args[i + 1]) {
      options.department = args[i + 1];
      i++;
    }
  }

  return options;
}

function validateCLIOptions(options: CLIOptions): void {
  if (!options.department || !['commercial', 'civil'].includes(options.department)) {
    console.log('❌ --department flag is required and must be "commercial" or "civil"');
    console.log('\nUsage:');
    console.log('  npx ts-node scripts/scraperVksDecisions.ts --department commercial');
    console.log('  npx ts-node scripts/scraperVksDecisions.ts --department civil');
    console.log('  npx ts-node scripts/scraperVksDecisions.ts --department commercial --limit 10');
    console.log('  npx ts-node scripts/scraperVksDecisions.ts --department commercial --resume');
    console.log('  npx ts-node scripts/scraperVksDecisions.ts --department commercial --limit 10 --verbose');
    process.exit(1);
  }
}

function getEstimatedTimeRemaining(processed: number, total: number): string {
  if (processed === 0) return 'calculating...';
  const elapsed = Date.now() - processingStartTime;
  const avgTimePerDecision = elapsed / processed;
  const remaining = (total - processed) * avgTimePerDecision;
  const seconds = Math.floor(remaining / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Metadata Loading
// ============================================================================

/**
 * Loads the decision metadata from the TypeScript array literal file produced
 * by scraperVksDecisionsLinks.ts.
 *
 * Reads the file as plain text and extracts the embedded JSON links array
 * with a regex — no need to compile/import.
 */
function loadMetadata(): IActMetadata[] {
  if (!fs.existsSync(CONFIG.METADATA_FILE)) {
    throw new Error(`Metadata file not found: ${CONFIG.METADATA_FILE}`);
  }

  const fileContent = fs.readFileSync(CONFIG.METADATA_FILE, 'utf-8');

  // The file contains: export const ${department}DecisionsLinksList = { ..., links: [...], };
  // We extract only the [...] array portion and parse it as JSON.
  const arrayMatch = fileContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!arrayMatch) {
    throw new Error('Could not find links array in metadata file');
  }

  try {
    const metadata = JSON.parse(arrayMatch[0]);
    log(`✅ Loaded ${metadata.length} decisions from metadata`, true);
    return metadata;
  } catch (err) {
    throw new Error(`Failed to parse metadata JSON: ${(err as Error).message}`);
  }
}

// ============================================================================
// Report Management & Resume Logic
// ============================================================================

function loadIgnoreList(): Set<string> {
  if (!fs.existsSync(CONFIG.IGNORE_LIST_FILE)) {
    return new Set();
  }
  try {
    const content = fs.readFileSync(CONFIG.IGNORE_LIST_FILE, 'utf-8');
    const ignoreList: IgnoreList = JSON.parse(content);
    return new Set(ignoreList.blacklistedIds || []);
  } catch {
    return new Set();
  }
}

function loadReport(): ProcessingReport {
  if (!fs.existsSync(CONFIG.REPORT_FILE)) {
    return {
      scriptRun: { startTime: new Date().toISOString(), resume: false },
      stats: { total: 0, processed: 0, successful: 0, skipped: 0, failed: 0, percentComplete: 0 },
      failures: [],
      networkErrors: [],
      blacklisted: 0,
    };
  }
  const content = fs.readFileSync(CONFIG.REPORT_FILE, 'utf-8');
  const report = JSON.parse(content);
  if (!report.blacklisted) report.blacklisted = 0;
  return report;
}

/**
 * Reads the existing JSONL output file and returns the set of actIds
 * that have already been successfully processed.
 *
 * This is the core of the resume mechanism: the output file is the single
 * source of truth — even if the report file is lost or corrupted,
 * resume still works correctly.
 */
function getProcessedActIds(): Set<string> {
  if (!fs.existsSync(CONFIG.OUTPUT_FILE)) {
    return new Set();
  }
  const processedIds = new Set<string>();
  const lines = fs.readFileSync(CONFIG.OUTPUT_FILE, 'utf-8').split('\n');
  for (const line of lines) {
    if (line.trim()) {
      try {
        const obj = JSON.parse(line);
        processedIds.add(obj.actId);
      } catch {
        // Skip malformed lines (e.g. partial write from a previous crash)
      }
    }
  }
  return processedIds;
}

function saveReport(report: ProcessingReport): void {
  fs.writeFileSync(CONFIG.REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');
}

function updateReportStats(
  report: ProcessingReport,
  total: number,
  processed: number,
  successful: number,
  failed: number,
  blacklisted: number,
): void {
  report.stats.total = total;
  report.stats.processed = processed;
  report.stats.successful = successful;
  report.stats.failed = failed;
  report.stats.skipped = processed - successful - failed;
  report.blacklisted = blacklisted;
  report.stats.percentComplete = total > 0 ? Math.round((processed / total) * 100 * 10) / 10 : 0;
  report.stats.estimatedTimeRemaining = getEstimatedTimeRemaining(processed, total);
}

// ============================================================================
// HTTP Fetching
// ============================================================================

async function fetchDecision(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, CONFIG.TIMEOUT_PER_REQUEST);

    http.get(url, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => chunks.push(chunk));

      res.on('end', () => {
        clearTimeout(timeoutHandle);
        try {
          const buffer = Buffer.concat(chunks);
          const html = iconv.decode(buffer, 'windows-1251');
          resolve(html);
        } catch (err) {
          reject(new Error(`Decoding error: ${(err as Error).message}`));
        }
      });

      res.on('error', (err) => {
        clearTimeout(timeoutHandle);
        reject(err);
      });
    }).on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });
  });
}

// ============================================================================
// HTML Content Extraction (Multiple Pattern Support)
// ============================================================================

/**
 * Extracts the raw decision text region from the full page HTML.
 *
 * WHY multiple patterns:
 *   The VKS system has been running since the early 2000s and the HTML
 *   structure has changed several times. We try patterns in order of likelihood
 *   and return the first match that contains enough content (> 500 chars).
 */
/**
 * Strips HTML tags and entities to measure actual text content length.
 * Used by extractContentFromHtml to decide whether a pattern match contains
 * enough real text (not just HTML markup) to be accepted.
 */
function stripHtmlForLengthCheck(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractContentFromHtml(html: string): string | null {
  const minTextLen = CONFIG.VALIDATION_MIN_CONTENT_LENGTH; // 1000 — same as validation

  // Pattern 1: Most common layout — decision body inside <font size="4">
  let match = html.match(/<font size="4"([\s\S]*?)<\/div><\/td><\/tr>\s*<\/table>/);
  if (match && stripHtmlForLengthCheck(match[1]).length > minTextLen) return match[1];

  // Pattern 2: Variation with different <font> attribute quoting
  match = html.match(/<font[^>]*size="?4"?[^>]*>([\s\S]*?)<\/font>\s*<\/div>/i);
  if (match && stripHtmlForLengthCheck(match[1]).length > minTextLen) return match[1];

  // Pattern 3: Older decisions stored in <pre> tags
  match = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (match && stripHtmlForLengthCheck(match[1]).length > minTextLen) return match[1];

  // Pattern 4: Layout variant using a table cell with colspan="2"
  match = html.match(/<td[^>]*colspan="2"[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<\/table>/i);
  if (match && stripHtmlForLengthCheck(match[1]).length > minTextLen) return match[1];

  // Pattern 5: Content in a <textarea> field (rare)
  match = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
  if (match && stripHtmlForLengthCheck(match[1]).length > minTextLen) return match[1];

  // Pattern 6: Full <body> fallback
  match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (match) {
    let content = match[1];
    content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    content = content.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    if (content.length > 500) return content;
  }

  // Pattern 7: Last resort — find the largest <div> block on the page
  const blocks = html.match(/<div[^>]*>([\s\S]{1000,}?)<\/div>/g);
  if (blocks) {
    const largest = blocks.reduce((a, b) => (a.length > b.length ? a : b));
    if (largest.length > 500) return largest;
  }

  return null;
}

// ============================================================================
// Content Structuring Helpers
// ============================================================================

function normalizeInlineSpaces(str: string): string {
  return str.replace(/[ \t]+/g, ' ').trim();
}

const ITNON_LINE_RE = /^В\s+(?:[А-Яа-я]\s*){3,10}Н\s*А\s+Н\s*А\s*Р\s*О\s*Д\s*А\s*$/;
const ITNON_EMBEDDED_RE = /В\s+(?:[А-Яа-я]\s*){3,10}Н\s*А\s+Н\s*А\s*Р\s*О\s*Д\s*А/;

/**
 * WHY \s+ between every word (not a single literal space):
 *   These phrases come from decisions that were originally Word or PDF documents.
 *   When exported to HTML, word spacing is sometimes represented as 2–3 consecutive
 *   space characters instead of a single space. After stripping HTML tags those
 *   multi-space runs survive in the text. \s+ matches any number of whitespace
 *   characters so the patterns work regardless of how many spaces appear between words.
 *   The phrase may also have no trailing space at all — none of the patterns require
 *   one, so they match whether or not a space follows the last word.
 */
const BODY_START_PATTERNS: RegExp[] = [
  /^Производство(то)?\s+(е\s+)?по(\s+реда\s+на)?\s+чл\./,
  /^Производство(то)?\s+се\s+развива\s+по\s+чл\./,
  /^Производство(то)?\s+(е\s+)?образувано/,
  /^Производство(то)?\s+по\s+делото\s+(е\s+)?образувано/,
  /^Производство(то)?\s+(е\s+)?по\s+делото/,
  /^Производство(то)?\s+(е\s+)?по\s+Глава/,
  /^Предявен(ият)?\s+иск\s+е\s+с\s+правно\s+основание/,
  /^Предявен\s+е\s+иск(\s+по\s+чл\.|\s+с\s+правно)/,
  /^Образувано\s+е\s+по\s+(касационн|молб|искан|жалб|иск)/,
  /^Производство(то)?\s+е\s+/,
  /^Предявени\s+са\s+искове/,
];

function isBodyStart(normalizedLine: string): boolean {
  return BODY_START_PATTERNS.some((p) => p.test(normalizedLine));
}

function processHeader(rawLines: string[]): string {
  const lines = rawLines.map(normalizeInlineSpaces).filter((l) => l.length > 0);

  const expanded: string[] = [];
  for (const line of lines) {
    const m = ITNON_EMBEDDED_RE.exec(line);
    if (m && (m.index > 0 || m[0].length < line.length)) {
      const before = line.substring(0, m.index).replace(/В\s*$/, '').trim();
      const itnon  = 'В ИМЕТО НА НАРОДА';
      const after  = line.substring(m.index + m[0].length).trim();
      if (before) expanded.push(before);
      expanded.push(itnon);
      if (after)  expanded.push(after);
    } else {
      expanded.push(line);
    }
  }

  const TITLE_RE          = /^Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+Е\s*$/;
  const TITLE_FRAGMENT_RE = /^[РЕШНИЕ](\s+[РЕШНИЕ]){0,8}\s*$/;
  const NUMBER_RE         = /^№\s*\d+/;
  const CHAIR_RE          = /^ПРЕДСЕДАТЕЛ\s*:/i;
  const MEMBERS_RE        = /^ЧЛЕНОВЕ\s*:/i;
  const PROCEDURAL_RE     = /^(при(\s|,|$)|и\s+в(\s|$)|изслуша|като\s+изслуша|за\s+да|т\.(\s|$)|търг\.|в\s+откр)/i;

  const blocks: string[]          = [];
  let   judgeLines: string[]      = [];
  let   proceduralLines: string[] = [];
  let   inComposition             = false;
  let   inProcedural              = false;
  let   titleSeen                 = false;

  function flushComposition(): void {
    if (judgeLines.length > 0) {
      blocks.push(judgeLines.join('\n'));
      judgeLines = [];
    }
    if (proceduralLines.length > 0) {
      blocks.push(proceduralLines.join('\n'));
      proceduralLines = [];
    }
    inComposition = false;
    inProcedural  = false;
  }

  for (const line of expanded) {
    if (TITLE_RE.test(line)) {
      if (!titleSeen) {
        flushComposition();
        blocks.push(line);
        titleSeen = true;
      }
    } else if (NUMBER_RE.test(line)) {
      flushComposition();
      blocks.push(line);
    } else if (ITNON_LINE_RE.test(line)) {
      flushComposition();
      blocks.push('В ИМЕТО НА НАРОДА');
    } else if (CHAIR_RE.test(line) || MEMBERS_RE.test(line)) {
      inComposition = true;
      judgeLines.push(line);
    } else if (inComposition) {
      if (inProcedural || PROCEDURAL_RE.test(line)) {
        inProcedural = true;
        proceduralLines.push(line);
      } else {
        judgeLines.push(line);
      }
    } else if (titleSeen && TITLE_FRAGMENT_RE.test(line)) {
      // Leftover fragment from a duplicate letter-spaced title → skip silently
    } else {
      flushComposition();
      blocks.push(line);
    }
  }
  flushComposition();

  return blocks.join('\n\n');
}

function processBody(rawLines: string[]): string {
  const result: string[] = [];
  let lastWasBlank = false;

  for (const line of rawLines) {
    const normalized = normalizeInlineSpaces(line);
    if (normalized === '') {
      if (!lastWasBlank) {
        result.push('');
        lastWasBlank = true;
      }
    } else {
      result.push(normalized);
      lastWasBlank = false;
    }
  }

  while (result.length > 0 && result[0] === '')                 result.shift();
  while (result.length > 0 && result[result.length - 1] === '') result.pop();

  return result.join('\n');
}

function cleanContent(rawHtml: string): string {
  // ── Step 1: Block-level HTML tags → newlines ───────────────────────────────
  let text = rawHtml
    .replace(/<\/p>/gi,      '\n')
    .replace(/<p[^>]*>/gi,   '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi,    '\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi,     '\n')
    .replace(/<\/td>/gi,     ' ');

  // ── Step 2: Strip remaining tags; decode entities ─────────────────────────
  text = text
    .replace(/<[^>]+>/g,       '')
    .replace(/face="[^"]*">/g, '')
    .replace(/size="[^"]*"/g,  '')
    .replace(/align="[^"]*"/g, '')
    .replace(/[>]/g,           '')
    .replace(/&nbsp;/g,  ' ')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&amp;/g,   '&')
    .replace(/&quot;/g,  '"');

  // ── Step 3: Split and normalize inline whitespace ─────────────────────────
  const allLines = text.split('\n').map(normalizeInlineSpaces);

  // ── Step 4: Find decision/order title line; discard everything before it ──
  //   Handles: letter-spaced "Р Е Ш Е Н И Е", non-spaced "РЕШЕНИЕ",
  //            letter-spaced "О П Р Е Д Е Л Е Н И Е", non-spaced "ОПРЕДЕЛЕНИЕ"
  const TITLE_SPACED_RE      = /^Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+Е\s*$/;
  const TITLE_NONSPACED_RE   = /^РЕШЕНИЕ\s*$/;
  const ORDER_SPACED_RE      = /^О\s+П\s+Р\s+Е\s+Д\s+Е\s+Л\s+Е\s+Н\s+И\s+Е\s*$/;
  const ORDER_NONSPACED_RE   = /^ОПРЕДЕЛЕНИЕ\s*$/;

  let titleIdx = allLines.findIndex((l) => TITLE_SPACED_RE.test(l));
  if (titleIdx === -1) {
    titleIdx = allLines.findIndex((l) => TITLE_NONSPACED_RE.test(l));
  }
  if (titleIdx === -1) {
    titleIdx = allLines.findIndex((l) => ORDER_SPACED_RE.test(l));
  }
  if (titleIdx === -1) {
    titleIdx = allLines.findIndex((l) => ORDER_NONSPACED_RE.test(l));
  }
  if (titleIdx === -1) {
    // Fallback: embedded (not standalone) letter-spaced РЕШЕНИЕ
    titleIdx = allLines.findIndex((l) => /Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+Е/.test(l));
  }
  const relevantLines = titleIdx >= 0 ? allLines.slice(titleIdx) : allLines;

  // ── Step 5: Find first body/reasoning line ────────────────────────────────
  let bodyIdx = relevantLines.findIndex((l) => l.length > 0 && isBodyStart(l));
  if (bodyIdx === -1) bodyIdx = Math.min(15, relevantLines.length);

  const headerLines = relevantLines.slice(0, bodyIdx);
  const bodyLines   = relevantLines.slice(bodyIdx);

  // ── Step 6: Format and join ───────────────────────────────────────────────
  const headerText = processHeader(headerLines);
  const bodyText   = processBody(bodyLines);
  return [headerText, bodyText].filter(Boolean).join('\n\n');
}

// ============================================================================
// Decision Processing
// ============================================================================

/**
 * Fetches, extracts, cleans, validates and returns a single processed decision.
 *
 * Pipeline:
 *   fetchDecision()          → raw HTML (windows-1251 decoded)
 *   extractContentFromHtml() → isolate the decision text region from the page
 *   cleanContent()           → structured plain text
 *   validator.validate()     → sanity checks
 *
 * Returns success:false on both validation failures and network errors.
 * The caller (main loop) distinguishes them via isNetworkError to decide
 * whether to retry. Validation failures are NOT retried — retrying the same
 * URL will not fix bad HTML or wrong page content.
 */
async function processDecision(
  metadata: IActMetadata,
): Promise<{
  success: boolean;
  processed?: IProcessedAct;
  error?: string;
  isNetworkError?: boolean;
}> {
  try {
    log(`  Fetching from API...`, true);
    const html = await fetchDecision(metadata.actUrl);

    log(`  Extracting content...`, true);
    const rawContent = extractContentFromHtml(html);
    if (!rawContent) {
      return {
        success: false,
        error: 'Could not extract content region from HTML (tried 7 patterns)',
        isNetworkError: false,
      };
    }

    const cleanedContent = cleanContent(rawContent);

    log(`  Validating content...`, true);
    const validation = validator.validate(cleanedContent);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Validation failed: ${validation.issues.join('; ')}`,
        isNetworkError: false,
      };
    }

    const processed: IProcessedAct = {
      actType:      metadata.actType,
      actId:        metadata.actId,
      actNumber:    metadata.actNumber,
      actDate:      metadata.actDate,
      caseNumber:   metadata.caseNumber,
      caseYear:     metadata.caseYear,
      department:   metadata.department,
      actTitle:     metadata.actTitle,
      actUrl:       metadata.actUrl,
      actPlainText: cleanedContent,
      validation: {
        isValid:     validation.isValid,
        contentHash: validation.hash,
        wordCount:   validation.wordCount,
      },
      processedAt: new Date().toISOString(),
    };

    return { success: true, processed };
  } catch (err) {
    const errorMsg = (err as Error).message;
    const isNetworkError = /ECONNRESET|ENOTFOUND|ETIMEDOUT|timeout|Connection/.test(errorMsg);
    return { success: false, error: errorMsg, isNetworkError };
  }
}

// ============================================================================
// Output
// ============================================================================

function saveActToJsonl(act: IProcessedAct): void {
  const line = JSON.stringify(act);
  fs.appendFileSync(CONFIG.OUTPUT_FILE, line + '\n', 'utf-8');
}

// ============================================================================
// Main Processing Loop
// ============================================================================

async function main(): Promise<void> {
  processingStartTime = Date.now();
  cliOptions = parseArgs();
  validateCLIOptions(cliOptions);
  buildConfig(cliOptions.department);

  const dept = cliOptions.department.toUpperCase();
  console.log(`\n🚀 VKS DECISIONS BATCH DOWNLOADER - ${dept} DEPARTMENT`);
  console.log('═'.repeat(70));

  log('\n📋 Loading ignore list...', false);
  ignoreList = loadIgnoreList();
  if (ignoreList.size > 0) {
    log(`   Found ${ignoreList.size} blacklisted decisions`, true);
  }

  log('📋 Loading metadata...', false);
  let metadata: IActMetadata[];
  try {
    metadata = loadMetadata();
  } catch (err) {
    console.error('❌ Error loading metadata:', (err as Error).message);
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  }

  const report      = loadReport();
  const processedIds = getProcessedActIds();
  const totalMetadata = metadata.length;

  if (cliOptions.resume && processedIds.size > 0) {
    log(`\n⏸️  RESUME MODE: Found ${processedIds.size} already processed decisions`, false);
    report.scriptRun.resume = true;
  }

  let decisionsToProcess = metadata.filter(
    (d) => !processedIds.has(d.actId) && !ignoreList.has(d.actId),
  );
  blacklistedCount = metadata.filter((d) => ignoreList.has(d.actId)).length;

  if (cliOptions.limit && cliOptions.limit > 0) {
    decisionsToProcess = decisionsToProcess.slice(0, cliOptions.limit);
    log(`⏳ LIMIT MODE: Processing max ${cliOptions.limit} decisions`, false);
  }

  const totalToProcess = decisionsToProcess.length;
  log(`\n📊 Processing ${totalToProcess} decisions (${processedIds.size} already done, ${blacklistedCount} blacklisted)`, false);
  log(`═`.repeat(70), false);

  for (let i = 0; i < decisionsToProcess.length; i++) {
    const decision     = decisionsToProcess[i];
    let   retryCount      = 0;
    let   success         = false;
    let   isNetworkError  = false;
    let   lastError       = '';
    const firstAttemptTime = new Date().toISOString();

    while (retryCount < CONFIG.MAX_RETRIES && !success) {
      const logPrefix = `[${i + 1}/${totalToProcess}] ${decision.actId} (${decision.actNumber}/${decision.actDate})`;
      log(retryCount > 0 ? `\n${logPrefix} - RETRY ${retryCount}/${CONFIG.MAX_RETRIES}` : `\n${logPrefix}`, false);

      const result = await processDecision(decision);

      if (result.success && result.processed) {
        saveActToJsonl(result.processed);
        log(`  ✅ Saved to JSONL`, true);
        success = true;
        decisionsFetched++;
      } else {
        lastError      = result.error || 'Unknown error';
        isNetworkError = result.isNetworkError || false;

        if (isNetworkError && retryCount < CONFIG.MAX_RETRIES - 1) {
          log(`  ⚠️  Network error: ${lastError}`, false);
          log(`  ⏳ Waiting before retry...`, true);
          await delay(2000);
          retryCount++;
        } else {
          break;
        }
      }
    }

    if (!success) {
      if (isNetworkError) {
        report.networkErrors.push({
          actType:      'decision',
          actId:        decision.actId,
          department:   cliOptions.department,
          error:        lastError,
          retries:      retryCount,
          firstAttempt: firstAttemptTime,
          lastAttempt:  new Date().toISOString(),
        });
        log(`  ❌ Network error after ${retryCount} retries: ${lastError}`, false);
      } else {
        report.failures.push({
          actType:      'decision',
          actId:        decision.actId,
          department:   cliOptions.department,
          reason:       lastError,
          retries:      retryCount,
          firstAttempt: firstAttemptTime,
          lastAttempt:  new Date().toISOString(),
        });
        log(`  ❌ Validation error: ${lastError}`, false);
      }
    }

    // Pass actual failure counts so processingReport.json stays accurate during the run
    updateReportStats(report, totalMetadata, processedIds.size + decisionsFetched, decisionsFetched, report.failures.length + report.networkErrors.length, blacklistedCount);
    saveReport(report);

    const percentComplete = ((processedIds.size + decisionsFetched) / totalMetadata) * 100;
    const eta = getEstimatedTimeRemaining(decisionsFetched, decisionsToProcess.length);
    log(`  📈 Progress: ${processedIds.size + decisionsFetched}/${totalMetadata} (${percentComplete.toFixed(1)}%) | ETA: ${eta}`, false);

    if (i < decisionsToProcess.length - 1) {
      await delay(CONFIG.API_DELAY_MS);
    }
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  const elapsedSeconds = Math.floor((Date.now() - processingStartTime) / 1000);
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  report.scriptRun.endTime  = new Date().toISOString();
  report.scriptRun.duration = `${elapsedMinutes}m ${elapsedSeconds % 60}s`;
  report.scriptRun.limitFlag = cliOptions.limit;

  updateReportStats(report, totalMetadata, processedIds.size + decisionsFetched, decisionsFetched, report.failures.length, blacklistedCount);
  saveReport(report);

  console.log('\n' + '═'.repeat(70));
  console.log('✅ BATCH PROCESSING COMPLETE!');
  console.log('═'.repeat(70));
  console.log(`Department:                   ${cliOptions.department}`);
  console.log(`Total decisions in database:  ${totalMetadata}`);
  console.log(`Already processed (before):   ${processedIds.size}`);
  console.log(`Processed this session:       ${decisionsFetched}`);
  console.log(`Successful:                   ${decisionsFetched - report.failures.length - report.networkErrors.length}`);
  console.log(`Validation errors:            ${report.failures.length}`);
  console.log(`Network errors (to retry):    ${report.networkErrors.length}`);
  console.log(`Blacklisted (no content):     ${blacklistedCount}`);
  console.log(`Total processed now:          ${processedIds.size + decisionsFetched}/${totalMetadata}`);
  console.log(`Completion:                   ${report.stats.percentComplete.toFixed(1)}%`);
  console.log(`Duration:                     ${report.scriptRun.duration}`);
  console.log('═'.repeat(70));
  console.log(`\n📁 Outputs:`);
  console.log(`  • Decisions: ${CONFIG.OUTPUT_FILE}`);
  console.log(`  • Report:    ${CONFIG.REPORT_FILE}`);
  console.log(`\n💡 Next steps:`);
  if (report.stats.percentComplete < 100) {
    console.log(`  Continue:   npx ts-node scripts/scraperVksDecisions.ts --department ${cliOptions.department} --resume`);
  }
  if (report.networkErrors.length > 0) {
    console.log(`  Retry network errors: npx ts-node scripts/scraperVksDecisions.ts --department ${cliOptions.department} --resume`);
    console.log(`  (${report.networkErrors.length} decisions failed with network errors — they were not saved,`);
    console.log(`   so --resume will attempt them again)`);
  }
  if (report.stats.percentComplete >= 100 && report.networkErrors.length === 0) {
    console.log(`  ✅ All decisions processed! Next: node scripts/chunk-for-rag.js`);
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
