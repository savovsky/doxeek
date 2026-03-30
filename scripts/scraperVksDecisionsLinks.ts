// ============================================================================
// scraperVksDecisionsLinks.ts
//
// PURPOSE
//   Collects the URLs and metadata for all VKS decisions in a given department
//   by walking the VKS search index number by number. The output is a TypeScript
//   file containing a structured list of links — used as the input for
//   scraperVksDecisions.ts which fetches the full decision text.
//
// SYSTEM OVERVIEW
//   1. HOW THE VKS SEARCH WORKS
//      The VKS website (http://domino.vks.bg) stores decisions in a Domino/Notes
//      database. Each decision has an internal field `un0_Number` which is its
//      sequential decision number within the year (e.g. 1, 2, 3 … N).
//      The same number exists across multiple years — decision №1 was issued in
//      2010, 2011, 2012, etc. — so querying un0_Number = 1 returns ALL decisions
//      numbered 1 across every year for the given department (~20–35 results).
//
//      The search query structure (Domino full-text search syntax):
//        (FIELD DocType = 15)               — decisions/rulings only (not motions, orders)
//        AND FIELD ut0_Kolegia = <KOLEGIA>  — department filter:
//                                               3 = Търговска колегия (Commercial)
//                                               2 = Гражданска колегия (Civil)
//        AND FIELD un0_Number = <N>         — decision number N across all years
//
//      This script loops un0_Number from 1 upward, collecting all decisions at
//      each number. It stops automatically when 5 consecutive numbers return zero
//      results — a reliable signal that the indexed range is exhausted.
//
//   2. WHAT THIS SCRIPT DOES
//      For each un0_Number from 1 to --limit:
//        a) Sends a GET request to the VKS search endpoint with the encoded query
//        b) Decodes the response from Windows-1251 to UTF-8 (the site is old)
//        c) Parses the <a href="...Keywords/HEX_ID..."> result links from the HTML
//        d) Extracts the actId (hex UNID) from each URL — the unique decision key
//        e) Parses the decision title to extract actNumber, actDate, caseNumber, caseYear
//        f) Writes all collected metadata to the output TypeScript file
//
//   3. OUTPUT FORMAT
//      A TypeScript module written to the department-specific downloads folder:
//
//        export const ${department}DecisionsLinksList = {
//          downloadedLinksCount:          number,   — total unique links collected
//          downloadedNumbers:             number[], — un0Numbers successfully queried
//          failedToDownloadNumbers:       number[], — numbers that failed all retries
//          failedToParseLinksFromNumbers: number[], — numbers with unparseable titles
//          downloadedActsIds:             string[], — all actIds (for dedup on resume)
//          links: IActLinkMetadata[],               — full metadata per decision
//        }
//
//      The file is overwritten (not appended) after every un0_Number so progress
//      is never lost even if the process is killed mid-run.
//
//   4. DEPARTMENT CONFIGURATION
//      --department commercial  →  KOLEGIA = 3, output: department_commercial/decisions/
//      --department civil       →  KOLEGIA = 2, output: department_civil/decisions/
//
//   5. RESUME / IDEMPOTENT OPERATION
//      Run with --resume to continue an interrupted collection. The script loads
//      the existing output file, reads the highest processed un0_Number, and
//      resumes from the next one. All previously collected actIds are loaded into
//      memory so duplicates are still detected correctly across runs.
//      Safe to run multiple times — re-running without --resume starts fresh.
//
//   6. STOP CONDITION
//      The loop stops automatically when MAX_CONSECUTIVE_EMPTY_NUMBERS (5)
//      consecutive un0_Numbers return zero results. This reliably signals the
//      end of the indexed range without needing to know the total count upfront.
//      The --limit flag is a hard upper bound on un0_Number, not on total decisions.
//
//   7. DUPLICATE DETECTION
//      Each actId is a 32-character hex Domino UNID — globally unique per decision.
//      An in-memory Set<string> provides O(1) duplicate checks during the run.
//      The same Set is initialised from downloadedActsIds on resume so dedup works
//      correctly across interrupted and continued runs.
//
// USAGE (run from project root: cd C:\work\personal\projects\doxeek)
//   # Test run (small batch first — verify output before going full scale)
//   npx ts-node scripts/scraperVksDecisionsLinks.ts --department commercial --limit 10
//   npx ts-node scripts/scraperVksDecisionsLinks.ts --department civil --limit 10
//
//   # Full collection
//   npx ts-node scripts/scraperVksDecisionsLinks.ts --department commercial --limit 5000
//   npx ts-node scripts/scraperVksDecisionsLinks.ts --department civil --limit 5000
//
//   # Resume an interrupted run
//   npx ts-node scripts/scraperVksDecisionsLinks.ts --department commercial --resume --limit 5000
//
//   # Verbose output (prints per-result detail and parse warnings)
//   npx ts-node scripts/scraperVksDecisionsLinks.ts --department commercial --limit 10 --verbose
//
// OUTPUT FILES
//   downloads/vks/department_commercial/decisions/decisionsLinksMetadataCommercial.ts
//   downloads/vks/department_civil/decisions/decisionsLinksMetadataCivil.ts
//
// RELATED SCRIPTS
//   scripts/scraperVksDecisions.ts  — reads this file's output to fetch full decision text
// ============================================================================

import http from 'http';           // Node built-in — VKS serves over plain HTTP (not HTTPS)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import iconv from 'iconv-lite';    // CRITICAL: VKS uses Windows-1251 encoding (old Bulgarian
                                   // government site). Node's http returns raw Buffers; decoding
                                   // as UTF-8 produces mojibake. iconv-lite maps Windows-1251
                                   // bytes to correct Unicode Cyrillic code points.

// ============================================================================
// Types
// ============================================================================

/** Metadata for one collected decision link, parsed from the VKS search index. */
interface IActLinkMetadata {
  actType: string;              // always "decision"
  actId: string;                // 32-char hex Domino UNID — globally unique decision identifier
                                // extracted from the /Keywords/<HEX> path in the decision URL
  actUrl: string;               // full URL to the decision page on the VKS site
  actTitle: string;             // raw title as returned by the search index
                                // e.g. "Решение №139/12.03.2026 по дело №689/2025"
  actNumber: string;            // decision number parsed from title — e.g. "139"
                                // sequential per department per year, resets each January
  actDate: string;              // decision date parsed from title — e.g. "12.03.2026" (DD.MM.YYYY)
  caseNumber: string;           // case (docket) number parsed from title — e.g. "689"
  caseYear: string;             // year the case was filed, parsed from title — e.g. "2025"
  collectedAt: Date;            // timestamp when this link was collected by this script
  collectedFromNumber: number;  // the un0_Number loop value that returned this decision
                                // equals actNumber — stored for traceability and debugging
  department: string;           // "commercial" or "civil" — from the --department flag
}

/**
 * In-memory state for the current collection run.
 * Persisted to the output TypeScript file after every processed un0_Number.
 */
interface IActsLinksData {
  downloadedLinksCount: number;            // total unique links collected (= links.length)
  downloadedNumbers: number[];             // un0_Numbers successfully queried
  failedToDownloadNumbers: number[];       // un0_Numbers that failed after all retries
  failedToParseLinksFromNumbers: number[]; // un0_Numbers where ≥1 title field was unparseable
  downloadedActsIds: string[];             // all collected actIds — persisted for resume dedup
  links: IActLinkMetadata[];               // full metadata for every collected decision
}

interface CLIOptions {
  limit: number;      // max un0_Number to query (NOT max total decisions — one number returns ~30)
  resume: boolean;    // load existing data and continue from the last processed number
  verbose: boolean;   // print extra per-result detail and parse warnings
  department: string; // "commercial" or "civil" — required, no default
}

// ============================================================================
// Configuration (built after CLI args are parsed — department is required)
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * KOLEGIA is the Domino/Notes field value for the department/chamber filter.
 * 3 = Търговска колегия (Commercial Chamber)
 * 2 = Гражданска колегия (Civil Chamber)
 * Other values exist for criminal, military, etc. — not relevant to this project.
 */
const KOLEGIA_BY_DEPARTMENT: Record<string, number> = {
  commercial: 3,
  civil: 2,
};

/**
 * Runtime CONFIG is intentionally left empty at module load time.
 * buildConfig() fills it after the --department flag is parsed and validated.
 *
 * WHY late initialization:
 *   Output paths and KOLEGIA depend on --department, which isn't known until
 *   after CLI arg parsing. Initializing with empty strings and filling them
 *   in buildConfig() keeps the initialization order explicit and avoids
 *   global state that is "half ready" at import time.
 */
let CONFIG = {
  BASE_URL: 'http://domino.vks.bg/bcap/scc/webdata.nsf/Acts',
  OUTPUT_DIR: '',
  OUTPUT_FILE: '',
  DELAY_BETWEEN_REQUESTS: 1000, // ms — polite rate limit; VKS is a government server
  TIMEOUT_PER_REQUEST: 30000,   // ms — VKS is slow; 30s is generous but safe
  MAX_RETRIES: 3,
  DOC_TYPE: 15,       // Domino field value for "Решения и Определения" (Decisions & Rulings)
  KOLEGIA: 0,         // filled by buildConfig()
  SEARCH_ORDER: 4,    // 4 = reverse chronological (newest first)
};

/** Fills all department-dependent CONFIG fields. Must be called before collectLinks(). */
function buildConfig(department: string): void {
  const dept = department.charAt(0).toUpperCase() + department.slice(1);
  CONFIG.OUTPUT_DIR  = path.join(__dirname, `../downloads/vks/department_${department}/decisions`);
  CONFIG.OUTPUT_FILE = path.join(__dirname, `../downloads/vks/department_${department}/decisions/decisionsLinksMetadata${dept}.ts`);
  CONFIG.KOLEGIA     = KOLEGIA_BY_DEPARTMENT[department];
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Logs a message. Pass verbose=true for lines that only appear with --verbose. */
function log(message: string, verbose = false): void {
  if (!verbose || cliOptions.verbose) {
    console.log(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Creates the output directory if it does not exist yet. */
function ensureOutputDirectory(): void {
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
    log(`📁 Created directory: ${CONFIG.OUTPUT_DIR}`);
  }
}

// ============================================================================
// Query Building
// ============================================================================

/**
 * Builds the Domino/Notes full-text search query for a given un0_Number.
 *
 * The query filters to decisions (DocType=15) of the correct department
 * (ut0_Kolegia) and the specific decision number (un0_Number). One un0_Number
 * corresponds to all decisions bearing that number across all indexed years,
 * typically returning 20–35 results per query.
 */
function buildQuery(un0Number: number): string {
  return `(FIELD DocType = ${CONFIG.DOC_TYPE}) AND FIELD ut0_Kolegia = ${CONFIG.KOLEGIA} AND FIELD un0_Number = ${un0Number}`;
}

/**
 * Builds the full VKS search URL for a given un0_Number.
 * SearchOrder=4 returns results in reverse chronological order (newest first).
 * Start=1 fetches from the first result — the VKS index returns all matching
 * decisions in one page (no pagination needed for a single un0_Number).
 */
function buildUrl(un0Number: number): string {
  const query = encodeURIComponent(buildQuery(un0Number));
  return `${CONFIG.BASE_URL}?SearchView&query=${query}&SearchOrder=${CONFIG.SEARCH_ORDER}&Start=1`;
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Extracts the unique actId from a VKS decision URL.
 *
 * Decision URLs follow the pattern:
 *   http://domino.vks.bg/bcap/scc/webdata.nsf/Keywords/0D91E431AEFE2A2BC2257CDF00280965
 *
 * The trailing hex string is a Domino/Notes UNID (Universal Note ID) — a 32-char
 * hex value that uniquely identifies the document across the entire database.
 * This is used as the actId throughout the pipeline.
 *
 * Returns null if the URL does not match (navigation links, pagination, etc.).
 */
function extractActId(url: string): string | null {
  const match = url.match(/Keywords\/([A-F0-9]+)$/i);
  return match ? match[1] : null;
}

/**
 * Parses the four metadata fields from a VKS decision title string.
 *
 * Title format:  "Решение №<actNumber>/<actDate> по дело №<caseNumber>/<caseYear>"
 * Example:        "Решение №139/12.03.2026 по дело №689/2025"
 *
 * Returns 'not parsed' for any field the regex cannot extract. Parse failures
 * are logged as warnings (verbose) and the un0_Number is added to
 * failedToParseLinksFromNumbers — collection continues regardless.
 *
 * WHY actNumber ≠ caseNumber:
 *   actNumber  — sequential number assigned to THIS decision (resets each year)
 *   caseNumber — docket number of the underlying case (unique per case, never resets)
 *   They differ: the court issues one decision per case, but the numbering systems
 *   are independent.
 */
function parseTitle(title: string): {
  actNumber: string;
  actDate: string;
  caseNumber: string;
  caseYear: string;
} {
  // actNumber: first №digits in the title (before the date slash)
  const actNumberMatch = title.match(/№(\d+)/);
  const actNumber = actNumberMatch ? actNumberMatch[1] : 'not parsed';

  // actDate: first DD.MM.YYYY pattern
  const dateMatch = title.match(/(\d{2}\.\d{2}\.\d{4})/);
  const actDate = dateMatch ? dateMatch[1] : 'not parsed';

  // caseNumber: digits after "дело №"
  const caseNumberMatch = title.match(/дело\s+№(\d+)/);
  const caseNumber = caseNumberMatch ? caseNumberMatch[1] : 'not parsed';

  // caseYear: last 4-digit sequence at the end of the title (after the final /)
  const yearMatch = title.match(/(\d{4})$/);
  const caseYear = yearMatch ? yearMatch[1] : 'not parsed';

  return { actNumber, actDate, caseNumber, caseYear };
}

/**
 * Parses all decision links from a VKS search results page HTML.
 *
 * The VKS search results page renders each result as:
 *   <a href="...Keywords/HEX_ID..."><font...>Title text</font></a>
 *
 * WHY matching on "Keywords" in the href:
 *   The page also contains navigation and pagination anchors. Only decision
 *   links point to the /Keywords/ path, so this filter isolates real results.
 *
 * The HTML is already decoded from Windows-1251 to UTF-8 by fetchPage()
 * before reaching this function, so Cyrillic text in titles is correct Unicode.
 */
function parseResults(html: string): Array<{ url: string; title: string }> {
  const docs: Array<{ url: string; title: string }> = [];
  const linkRegex = /<a href="([^"]*Keywords[^"]*)"[^>]*>[\s\S]*?<font[^>]*>([^<]+)<\/font>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1].trim();
    const title = match[2].trim();
    if (url && title) {
      docs.push({ url, title });
    }
  }

  return docs;
}

// ============================================================================
// HTTP Fetching with Retry Logic
// ============================================================================

/**
 * Fetches the search results page for un0Number with exponential-ish backoff retry.
 *
 * Retries up to MAX_RETRIES times with increasing wait (1s, 2s, 3s).
 * Returns null if all attempts fail — the number is then recorded in
 * failedToDownloadNumbers and the loop continues to the next number.
 */
async function fetchPageWithRetry(un0Number: number, attempt: number = 1): Promise<string | null> {
  try {
    return await fetchPage(un0Number);
  } catch (error) {
    if (attempt < CONFIG.MAX_RETRIES) {
      const waitTime = attempt * 1000;
      log(`⚠️ Attempt ${attempt} failed, retrying in ${waitTime}ms...`, true);
      await sleep(waitTime);
      return fetchPageWithRetry(un0Number, attempt + 1);
    } else {
      log(`❌ Failed after ${CONFIG.MAX_RETRIES} attempts: ${error}`);
      return null;
    }
  }
}

/**
 * Fetches and decodes the raw HTML for a single VKS search results page.
 *
 * WHY plain http (not https):
 *   The VKS website serves its content over plain HTTP. Using the built-in
 *   `http` module avoids TLS overhead and keeps the dependency list minimal.
 *
 * WHY iconv-lite / windows-1251:
 *   The VKS site was built in the early 2000s and uses Windows-1251 encoding
 *   (the standard Windows Cyrillic codepage). Node's http module returns raw
 *   binary Buffers. Calling .toString() or decoding as UTF-8 produces mojibake
 *   for all Cyrillic text. iconv-lite correctly maps Windows-1251 bytes to the
 *   proper Unicode Cyrillic code points.
 */
function fetchPage(un0Number: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = buildUrl(un0Number);
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${CONFIG.TIMEOUT_PER_REQUEST}ms`));
    }, CONFIG.TIMEOUT_PER_REQUEST);

    http.get(url, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timeoutId);
        try {
          const buffer = Buffer.concat(chunks);
          const data = iconv.decode(buffer, 'windows-1251');
          resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

// ============================================================================
// Data Management
// ============================================================================

/**
 * Loads an existing collection from the output TypeScript file (resume mode).
 *
 * WHY eval() instead of JSON.parse():
 *   The output file is a TypeScript module with an exported const object literal,
 *   not pure JSON. eval() parses the JS object literal directly without needing
 *   to compile or import the TypeScript file. This is safe here because we control
 *   100% of the file content — it is only ever written by saveMetadata().
 *
 * WHY convert collectedAt strings back to Dates:
 *   JSON.stringify() serialises Date objects as ISO strings. When eval() reads
 *   them back, they arrive as plain strings. We convert them back to Date objects
 *   to honour the IActLinkMetadata type contract.
 *
 * The legacy field mappings handle files written by earlier versions of this
 * script (or its predecessors) that used different field names.
 */
function loadExistingMetadata(): IActsLinksData | null {
  if (!fs.existsSync(CONFIG.OUTPUT_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(CONFIG.OUTPUT_FILE, 'utf-8');
    const match = content.match(
      new RegExp(`export const ${cliOptions.department}DecisionsLinksList = ({[\\s\\S]*?});`)
    );
    if (!match) return null;

    const objectStr = match[1];
    // eslint-disable-next-line no-eval
    const data = eval(`(${objectStr})`);

    // Handle legacy field names from older script versions
    if (data.downloadedPages && !data.downloadedNumbers) {
      data.downloadedNumbers = data.downloadedPages;
      delete data.downloadedPages;
    }
    if (data.failedToDownloadPages && !data.failedToDownloadNumbers) {
      data.failedToDownloadNumbers = data.failedToDownloadPages;
      delete data.failedToDownloadPages;
    }
    if (data.failedToParseLinksFromPages && !data.failedToParseLinksFromNumbers) {
      data.failedToParseLinksFromNumbers = data.failedToParseLinksFromPages;
      delete data.failedToParseLinksFromPages;
    }

    // Convert collectedAt ISO strings back to Date objects
    if (data.links && Array.isArray(data.links)) {
      data.links = data.links.map((link: IActLinkMetadata & { collectedAt: string }) => ({
        ...link,
        collectedAt: new Date(link.collectedAt),
      }));
    }

    return data;
  } catch (error) {
    log(`⚠️  Could not load existing metadata: ${error}`, true);
    return null;
  }
}

/**
 * Persists the current collection state to the TypeScript output file.
 * Called after every processed un0_Number so at most one number's worth
 * of results (~30 links) is lost if the process is interrupted.
 *
 * WHY a .ts file and not .json:
 *   The output is a TypeScript module so it can be directly imported by other
 *   TypeScript files in the project (type-checked analysis scripts, tooling).
 *   scraperVksDecisions.ts reads this file as plain text and extracts the links
 *   array via regex — no TS compilation is needed at read time.
 */
function saveMetadata(data: IActsLinksData): void {
  const dept = cliOptions.department.charAt(0).toUpperCase() + cliOptions.department.slice(1);
  const tsContent = `
// ${dept} Department Decisions Links
// Generated: ${new Date().toISOString()}

export const ${cliOptions.department}DecisionsLinksList = {
  downloadedLinksCount: ${data.downloadedActsIds.length},
  downloadedNumbers: ${JSON.stringify(data.downloadedNumbers)},
  failedToDownloadNumbers: ${JSON.stringify(data.failedToDownloadNumbers)},
  failedToParseLinksFromNumbers: ${JSON.stringify(data.failedToParseLinksFromNumbers)},
  downloadedActsIds: ${JSON.stringify(data.downloadedActsIds)},
  links: ${JSON.stringify(data.links, null, 2)},
};
`;
  fs.writeFileSync(CONFIG.OUTPUT_FILE, tsContent, 'utf-8');
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseCLIArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    limit: 2000,
    resume: false,
    verbose: false,
    department: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && i + 1 < args.length) {
      options.limit = parseInt(args[i + 1], 10) || 2000;
      i++;
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--department' && i + 1 < args.length) {
      options.department = args[i + 1];
      i++;
    }
  }

  return options;
}

/** Validates CLI options and exits early with a usage message if invalid. */
function validateCLIOptions(options: CLIOptions): void {
  if (!options.department || !['commercial', 'civil'].includes(options.department)) {
    console.log('❌ --department flag is required and must be "commercial" or "civil"');
    console.log('\nUsage:');
    console.log('  npx ts-node scripts/scraperVksDecisionsLinks.ts --department commercial --limit 1000');
    console.log('  npx ts-node scripts/scraperVksDecisionsLinks.ts --department civil --limit 1000');
    console.log('  npx ts-node scripts/scraperVksDecisionsLinks.ts --department commercial --resume --limit 5000');
    console.log('  npx ts-node scripts/scraperVksDecisionsLinks.ts --department commercial --limit 1000 --verbose');
    process.exit(1);
  }

  if (options.limit <= 0) {
    console.log('❌ --limit must be greater than 0');
    process.exit(1);
  }
}

// ============================================================================
// Main Collection Logic
// ============================================================================

async function collectLinks(): Promise<void> {
  const dept = cliOptions.department.charAt(0).toUpperCase() + cliOptions.department.slice(1);
  log(`\n🚀 VCS ${dept} Department Decisions Links Scraper`);
  log('━'.repeat(60));

  ensureOutputDirectory();

  let data: IActsLinksData;
  let startNumber = 1;

  if (cliOptions.resume) {
    const existing = loadExistingMetadata();
    if (existing) {
      data = existing;
      // Use reduce instead of Math.max(...array) to avoid stack overflow on
      // large arrays — spread pushes every element onto the call stack.
      const maxNumber = data.downloadedNumbers.reduce((a, b) => Math.max(a, b), 0);
      startNumber = maxNumber + 1;
      log(`✅ Loaded existing metadata: ${data.links.length} links, ${data.downloadedNumbers.length} numbers processed`);
      log(`📄 Resuming from document number ${startNumber}`);
    } else {
      log('ℹ️ No existing metadata found, starting fresh');
      data = {
        downloadedLinksCount: 0,
        downloadedNumbers: [],
        failedToDownloadNumbers: [],
        failedToParseLinksFromNumbers: [],
        downloadedActsIds: [],
        links: [],
      };
    }
  } else {
    data = {
      downloadedLinksCount: 0,
      downloadedNumbers: [],
      failedToDownloadNumbers: [],
      failedToParseLinksFromNumbers: [],
      downloadedActsIds: [],
      links: [],
    };
    log('📄 Starting fresh collection');
  }

  // ── In-memory Set for O(1) duplicate detection ───────────────────────────
  // data.downloadedActsIds is an array (required for JSON serialisation), but
  // array.includes() is O(n) — too slow when called for every result across
  // thousands of numbers. This Set mirrors the array for fast lookups and is
  // kept in sync throughout the run. On resume it is pre-populated from the
  // loaded downloadedActsIds so cross-run dedup works correctly.
  const seenActIds = new Set<string>(data.downloadedActsIds);

  log('━'.repeat(60) + '\n');

  let un0Number = startNumber;
  let foundOnNumber = 0;
  let addedOnNumber = 0;
  let duplicatesOnNumber = 0;
  let failedToParseOnNumber = 0;
  let consecutiveEmptyNumbers = 0;
  const MAX_CONSECUTIVE_EMPTY_NUMBERS = 5; // Stop after 5 consecutive numbers with 0 results

  while (un0Number <= cliOptions.limit && consecutiveEmptyNumbers < MAX_CONSECUTIVE_EMPTY_NUMBERS) {
    log(`Fetching document number ${un0Number} (Start=1)...`);

    const html = await fetchPageWithRetry(un0Number);

    if (!html) {
      data.failedToDownloadNumbers.push(un0Number);
      log(`❌ Number ${un0Number} failed after ${CONFIG.MAX_RETRIES} retries`);
      un0Number++;
      await sleep(CONFIG.DELAY_BETWEEN_REQUESTS);
      continue;
    }

    const results = parseResults(html);
    foundOnNumber = results.length;
    addedOnNumber = 0;
    duplicatesOnNumber = 0;
    failedToParseOnNumber = 0;

    for (const result of results) {
      const actId = extractActId(result.url);

      if (!actId) {
        log(`⚠️ Could not extract actId from: ${result.url}`, true);
        failedToParseOnNumber++;
        continue;
      }

      // O(1) duplicate check via Set (not array.includes which is O(n))
      if (seenActIds.has(actId)) {
        duplicatesOnNumber++;
        continue;
      }

      const parsed = parseTitle(result.title);

      const failedFields: string[] = [];
      if (parsed.actNumber === 'not parsed') failedFields.push('actNumber');
      if (parsed.actDate === 'not parsed') failedFields.push('actDate');
      if (parsed.caseNumber === 'not parsed') failedFields.push('caseNumber');
      if (parsed.caseYear === 'not parsed') failedFields.push('caseYear');

      if (failedFields.length > 0) {
        log(`⚠️  Could not parse: [${failedFields.join(', ')}] in title: ${result.title}`, true);
      }

      const metadata: IActLinkMetadata = {
        actType: 'decision',
        actId,
        actUrl: result.url,
        actTitle: result.title,
        actNumber: parsed.actNumber,
        actDate: parsed.actDate,
        caseNumber: parsed.caseNumber,
        caseYear: parsed.caseYear,
        collectedAt: new Date(),
        collectedFromNumber: un0Number,
        department: cliOptions.department,
      };

      data.links.push(metadata);
      data.downloadedActsIds.push(actId);
      seenActIds.add(actId); // keep Set in sync with the array
      addedOnNumber++;
    }

    if (!data.downloadedNumbers.includes(un0Number)) {
      data.downloadedNumbers.push(un0Number);
    }

    if (failedToParseOnNumber > 0 && !data.failedToParseLinksFromNumbers.includes(un0Number)) {
      data.failedToParseLinksFromNumbers.push(un0Number);
    }

    log(`Found ${foundOnNumber} items, added ${addedOnNumber} (${duplicatesOnNumber} duplicates, ${failedToParseOnNumber} failed to parse)`);
    log(`Total downloaded: ${data.links.length}`);
    log(`Document number: ${un0Number} / ${cliOptions.limit}\n`);

    // Track consecutive empty numbers for the auto-stop condition
    if (foundOnNumber === 0) {
      consecutiveEmptyNumbers++;
    } else {
      consecutiveEmptyNumbers = 0;
    }

    if (consecutiveEmptyNumbers >= MAX_CONSECUTIVE_EMPTY_NUMBERS) {
      log(`⚠️ Stopping: ${MAX_CONSECUTIVE_EMPTY_NUMBERS} consecutive numbers with no new items`);
      break;
    }

    // Save after every number — at most ~30 links are lost if the process crashes
    saveMetadata(data);

    if (un0Number >= cliOptions.limit) {
      log(`✅ Reached document number limit: ${cliOptions.limit}`);
      break;
    }

    await sleep(CONFIG.DELAY_BETWEEN_REQUESTS);
    un0Number++;
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  log('━'.repeat(60));
  log(`✅ Successfully collected ${data.links.length} unique links`);
  log('📊 Statistics:');
  log(`   • Document numbers processed: ${data.downloadedNumbers.length}`);
  log(`   • Unique acts: ${data.links.length}`);
  log(`   • Failed numbers: ${data.failedToDownloadNumbers.length}`);
  log(`   • Numbers with failed parsing: ${data.failedToParseLinksFromNumbers.length}`);
  if (data.failedToParseLinksFromNumbers.length > 0) {
    log(`     Numbers: ${data.failedToParseLinksFromNumbers.join(', ')}`);
  }
  log(`   • Consecutive empty numbers before stop: ${consecutiveEmptyNumbers}/${MAX_CONSECUTIVE_EMPTY_NUMBERS}`);

  // Final uniqueness verification — catches any dedup logic bugs
  const uniqueIds = new Set(data.downloadedActsIds);
  if (uniqueIds.size !== data.downloadedActsIds.length) {
    const duplicateCount = data.downloadedActsIds.length - uniqueIds.size;
    log(`⚠️ WARNING: Found ${duplicateCount} duplicate actIds in collected data!`);

    const idCounts = new Map<string, number>();
    data.downloadedActsIds.forEach(id => {
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    });

    const duplicatedIds = Array.from(idCounts.entries())
      .filter(([, count]) => count > 1)
      .slice(0, 10); // Show first 10 duplicates

    log(`   Duplicated IDs found:`);
    duplicatedIds.forEach(([id, count]) => {
      const links = data.links.filter(l => l.actId === id);
      log(`   • ${id} appears ${count} times`);
      links.forEach(l => {
        log(`      - Number ${l.collectedFromNumber}: ${l.actTitle}`);
      });
    });
  } else {
    log(`✅ All ${data.downloadedActsIds.length} actIds are UNIQUE!`);
  }

  log(`📁 Output: ${CONFIG.OUTPUT_FILE}`);
  log('━'.repeat(60) + '\n');
}

// ============================================================================
// Main Execution
// ============================================================================

let cliOptions: CLIOptions;

async function main(): Promise<void> {
  try {
    cliOptions = parseCLIArgs();
    validateCLIOptions(cliOptions);
    buildConfig(cliOptions.department);
    await collectLinks();
    log('✅ Done!\n');
  } catch (error) {
    log(`❌ Error: ${error}`);
    process.exit(1);
  }
}

main();
