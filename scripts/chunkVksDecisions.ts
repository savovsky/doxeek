/**
 * =============================================================================
 * chunkVksDecisions.ts
 * =============================================================================
 *
 * PURPOSE
 * -------
 * Reads a VKS decisions JSONL file (produced by scraperVksDecisions.ts) and
 * outputs a chunks JSONL file. Each output line is one self-contained embeddable
 * text unit with rich metadata, ready to be passed to @convex-dev/rag rag.add().
 *
 *
 * HOW TO RUN
 * ----------
 *   npx tsx scripts/chunkVksDecisions.ts --input <path> [options]
 *
 *   Options:
 *     --input   <path>   Path to input JSONL file  (required)
 *     --output  <path>   Path to output JSONL file (default: auto-derived, see below)
 *     --limit   <n>      Process only the first N decisions — useful for quick testing
 *     --dry-run          Run the full pipeline but do NOT write the output file;
 *                        prints statistics only
 *
 *   Default output path:
 *     Same directory as --input, filename prefixed with "chunks_".
 *     e.g. input  → downloads/vks/department_commercial/decisions/decisionsDataCommercial.jsonl
 *          output → downloads/vks/department_commercial/decisions/chunks_decisionsDataCommercial.jsonl
 *
 *   Examples:
 *     # Full run — commercial decisions
 *     npx tsx scripts/chunkVksDecisions.ts \
 *       --input downloads/vks/department_commercial/decisions/decisionsDataCommercial.jsonl
 *
 *     # Quick sanity check — first 20 decisions, no file written
 *     npx tsx scripts/chunkVksDecisions.ts \
 *       --input downloads/vks/department_commercial/decisions/decisionsDataCommercial.jsonl \
 *       --limit 20 --dry-run
 *
 *     # Explicit output path
 *     npx tsx scripts/chunkVksDecisions.ts \
 *       --input  downloads/vks/department_commercial/decisions/decisionsDataCommercial.jsonl \
 *       --output chunks/commercial.jsonl
 *
 *
 * INPUT FORMAT
 * ------------
 * JSONL — one JSON object per line. Produced by scraperVksDecisions.ts.
 * Required fields on each record:
 *
 *   actId        string   Globally unique decision identifier
 *                         e.g. "E135FB44DE7FC2257F9D002B2787"
 *
 *   actNumber    string   Decision number — NOT globally unique.
 *                         The same number (e.g. "1") repeats every year and every
 *                         department. Always use actId as the primary key.
 *
 *   actDate      string   Decision date in Bulgarian format: DD.MM.YYYY
 *                         e.g. "22.04.2016"
 *                         Converted to ISO 8601 (YYYY-MM-DD) on output so that
 *                         dates are lexicographically sortable.
 *
 *   actTitle     string   Human-readable title string
 *                         e.g. "Решение №1/22.04.2016 по дело №2750/2014"
 *                         Prepended to the FIRST chunk of each decision.
 *
 *   actUrl       string   Canonical source URL on domino.vks.bg
 *                         Stored as metadata only — never embedded in chunk text.
 *
 *   caseNumber   string   Case number within the filing year, e.g. "2750"
 *
 *   caseYear     string   Year the case was FILED, e.g. "2014"
 *
 *   department   string   Court department slug, e.g. "commercial" or "civil"
 *
 *   actPlainText string   Full structured plain text of the decision.
 *
 *
 * OUTPUT FORMAT
 * -------------
 * JSONL — one JSON object per line. Each object represents one chunk:
 *
 *   text         string   The text content to embed.
 *                         First chunk: actTitle prepended to the text.
 *                         All other chunks: paragraph text only.
 *
 *   metadata     object
 *     actId        string   Unique decision key
 *     actNumber    string   Non-unique decision number
 *     actDate      string   ISO 8601 date "YYYY-MM-DD"
 *     actTitle     string   Human-readable title (for display in search results)
 *     actUrl       string   Source URL (for linking back to original)
 *     caseNumber   string   Case number within the filing year
 *     caseYear     string   Case filing year
 *     department   string   Court department
 *     chunkIndex   number   0-based sequential position within this decision's chunks.
 *
 *
 * ALGORITHM (flat chunks)
 * -----------------------
 *
 * For each decision:
 *   1. Strip footer  — find last "ПРЕДСЕДАТЕЛ:" line that appears in the last
 *                      20% of the text; discard it and everything after.
 *   2. Split by \n\n — get raw paragraph array (empty paragraphs discarded).
 *   3. Merge pass    — walk paragraphs left to right:
 *                        if paragraph < MIN_MERGE_SIZE (150 chars):
 *                          if a previous chunk exists → append to it (join \n\n)
 *                          else                       → carry forward (prepend to next)
 *                        else:
 *                          apply any pending carry-forward, then emit this paragraph
 *                        After loop: flush any remaining carry into last chunk or alone.
 *   4. Split pass    — paragraphs > MAX_CHUNK_SIZE (1,400 chars) split at sentence
 *                      boundaries with OVERLAP_SENTENCES = 2 carry-over.
 *   5. Prepend actTitle to the FIRST chunk of this decision only.
 *   6. Assign chunkIndex (0-based sequential within decision).
 *
 *
 * FOOTER STRIPPING
 * ----------------
 *   Strategy: find the LAST occurrence of /^ПРЕДСЕДАТЕЛ\s*:/m in the full text.
 *   If that match appears in the last 20% of the text → strip from there to end.
 *   If it appears earlier (i.e., it is the header composition block) → keep full text.
 *
 *   This avoids false-matching the header's "ПРЕДСЕДАТЕЛ: Ваня Алексиева" line,
 *   which always appears near the top. The footer signature block always appears
 *   at the very end.
 *
 *
 * CHUNK SIZING
 * ------------
 *   MIN_MERGE_SIZE  = 150 chars  — paragraphs below this are merged into neighbour
 *   MAX_CHUNK_SIZE  = 1,400 chars — paragraphs above this are split at sentence boundaries
 *   OVERLAP_SENTENCES = 2        — sentences carried over between split sub-chunks
 *
 *
 * STATISTICS OUTPUT
 * -----------------
 *   Printed to stdout on completion:
 *     • Decisions processed, parse errors, total chunks
 *     • Footer-not-found count (footer ran to end of text)
 *     • Oversized paragraph split count
 *     • Chunks per decision: min / max / avg
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as rl   from 'readline';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Paragraphs shorter than this are merged into the previous (or next) paragraph
 * rather than emitted as standalone chunks.
 */
const MIN_MERGE_SIZE = 150;

/**
 * Maximum character length for a single chunk.
 * Paragraphs longer than this are split at sentence boundaries.
 */
const MAX_CHUNK_SIZE = 1_400;

/**
 * Number of sentences carried over from the end of one sub-chunk to the
 * beginning of the next when splitting an oversized paragraph.
 */
const OVERLAP_SENTENCES = 2;

// ============================================================================
// TYPES
// ============================================================================

/** One record from the input JSONL (produced by scraperVksDecisions.ts). */
interface InputRecord {
  actType:      string;
  actId:        string;
  actNumber:    string;
  actDate:      string;        // "DD.MM.YYYY" — Bulgarian format
  actTitle:     string;
  actUrl:       string;
  caseNumber:   string;
  caseYear:     string;
  department:   string;
  actPlainText: string;
  validation:   { isValid: boolean; contentHash: string; wordCount: number };
  processedAt:  string;
}

/** Metadata attached to every output chunk. */
interface ChunkMetadata {
  actId:      string;
  actNumber:  string;
  actDate:    string;         // ISO 8601 "YYYY-MM-DD"
  actTitle:   string;
  actUrl:     string;
  caseNumber: string;
  caseYear:   string;
  department: string;
  chunkIndex: number;         // 0-based sequential position within this decision
}

/** One output chunk — maps directly to one rag.add() call. */
interface Chunk {
  text:     string;
  metadata: ChunkMetadata;
}

/** Mutable counters accumulated across all decisions for the final stats print. */
interface Stats {
  decisions:         number;
  parseErrors:       number;
  totalChunks:       number;
  noFooter:          number;   // footer signature not found — text ran to end
  oversizedSplits:   number;
  chunksPerDecision: number[];
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Converts a Bulgarian date string (DD.MM.YYYY) to ISO 8601 (YYYY-MM-DD).
 * ISO 8601 strings are lexicographically sortable — required for Convex date filters.
 *
 * @example toISODate("22.04.2016") → "2016-04-22"
 */
function toISODate(dateBG: string): string {
  const m = dateBG.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return dateBG;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ============================================================================
// FOOTER STRIPPING
// ============================================================================

/**
 * Strips the footer signature block from the end of a decision's plain text.
 *
 * Strategy: find the LAST occurrence of /^ПРЕДСЕДАТЕЛ\s*:/m in the full text.
 * If it appears in the last 20% of the text → it is the footer → strip from there.
 * If it appears earlier (header composition block) → leave text unchanged.
 *
 * WHY last-20% heuristic:
 *   The header also contains "ПРЕДСЕДАТЕЛ: X" (the presiding judge's name).
 *   It always appears near the top of the text (~first 10%). The footer signature
 *   block always appears at the very end. By checking only the final 20%, we avoid
 *   false-matching the header line.
 *
 * @returns  { text: stripped text, footerFound: boolean }
 */
function stripFooter(text: string): { text: string; footerFound: boolean } {
  // Collect all match positions of /^ПРЕДСЕДАТЕЛ\s*:/m
  const pattern = /^ПРЕДСЕДАТЕЛ\s*:/gm;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    lastMatch = m;
  }

  if (lastMatch === null) {
    return { text, footerFound: false };
  }

  const pos = lastMatch.index;
  if (pos >= text.length * 0.8) {
    // Footer found in the last 20% → strip it (and any trailing whitespace)
    return { text: text.slice(0, pos).trimEnd(), footerFound: true };
  }

  // The only ПРЕДСЕДАТЕЛ: line is the header composition block → no footer to strip
  return { text, footerFound: false };
}

// ============================================================================
// SENTENCE SPLITTING
// ============================================================================

/**
 * Splits a paragraph into individual Bulgarian sentences.
 *
 * Sentence boundary: a period, question mark, or exclamation mark followed by
 * one or more whitespace characters and an uppercase letter (Cyrillic or Latin).
 *
 * Does NOT split on common abbreviations like "чл.290", "т.д.", "ал.1" — these
 * are not followed by space + uppercase letter.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z])/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ============================================================================
// CHUNK SIZING
// ============================================================================

/**
 * Splits an oversized paragraph (length > MAX_CHUNK_SIZE) into smaller chunks
 * with OVERLAP_SENTENCES sentences of carry-over context between adjacent chunks.
 *
 * ALGORITHM:
 *   1. Split paragraph into sentences.
 *   2. Greedily accumulate sentences into a buffer.
 *   3. When adding the next sentence would push the buffer over maxSize:
 *      a. Emit the current buffer as a completed chunk.
 *      b. Seed the next buffer with the last `overlapCount` sentences.
 *      c. Trim the seed from the front until (seed + next sentence) fits.
 *   4. Emit whatever remains in the buffer as the final chunk.
 *
 * Edge cases:
 *   A single sentence > maxSize is emitted as-is (cannot be split further).
 */
function splitOversizedParagraph(
  text:         string,
  maxSize:      number = MAX_CHUNK_SIZE,
  overlapCount: number = OVERLAP_SENTENCES,
): string[] {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return [text];

  const chunks: string[] = [];
  let   buffer: string[] = [];

  for (const sentence of sentences) {
    const candidate = buffer.length > 0
      ? `${buffer.join(' ')} ${sentence}`
      : sentence;

    if (candidate.length <= maxSize) {
      buffer.push(sentence);
    } else {
      if (buffer.length > 0) {
        chunks.push(buffer.join(' '));

        // Seed overlap: trim from front until (seed + next sentence) fits within maxSize
        buffer = buffer.slice(-overlapCount);
        while (buffer.length > 0 && `${buffer.join(' ')} ${sentence}`.length > maxSize) {
          buffer = buffer.slice(1);
        }
      }
      buffer.push(sentence);
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer.join(' '));
  }

  return chunks.length > 0 ? chunks : [text];
}

// ============================================================================
// MERGE PASS
// ============================================================================

/**
 * Merges short paragraphs (< MIN_MERGE_SIZE) into their neighbours.
 *
 * RULES (left-to-right walk):
 *   - If paragraph < MIN_MERGE_SIZE AND a previous result exists:
 *       append to the previous result (join with '\n\n')
 *   - If paragraph < MIN_MERGE_SIZE AND no previous result exists:
 *       carry forward — prepend to the next paragraph instead
 *   - If paragraph >= MIN_MERGE_SIZE:
 *       prepend any pending carry (short paragraph waiting for a home),
 *       then emit as a new entry in the result list
 *
 * After the loop, any remaining carry is appended to the last result, or
 * emitted as a standalone entry if the result is empty (single-paragraph decision).
 *
 * NOTE: after this pass, individual entries may still exceed MAX_CHUNK_SIZE —
 * those are handled by the split pass that follows.
 */
function mergeParagraphs(paragraphs: string[]): string[] {
  const result: string[] = [];
  let   carry = '';

  for (const para of paragraphs) {
    const effective = carry ? `${carry}\n\n${para}` : para;
    carry = '';

    if (effective.length < MIN_MERGE_SIZE) {
      if (result.length > 0) {
        // Merge backward into the previous chunk
        result[result.length - 1] += `\n\n${effective}`;
      } else {
        // No previous chunk — carry forward to prepend to the next paragraph
        carry = effective;
      }
    } else {
      result.push(effective);
    }
  }

  // Flush any remaining carry
  if (carry) {
    if (result.length > 0) {
      result[result.length - 1] += `\n\n${carry}`;
    } else {
      // Edge case: entire decision is a single short paragraph
      result.push(carry);
    }
  }

  return result;
}

// ============================================================================
// DECISION PROCESSING
// ============================================================================

/**
 * Processes one InputRecord into an ordered array of Chunk objects.
 *
 * STEPS:
 *   1. Strip footer (last-20% ПРЕДСЕДАТЕЛ: heuristic)
 *   2. Split by \n\n, discard empty paragraphs
 *   3. Merge short paragraphs (< MIN_MERGE_SIZE) into neighbours
 *   4. Split oversized paragraphs (> MAX_CHUNK_SIZE) at sentence boundaries
 *   5. Prepend actTitle to chunk 0 only
 *   6. Assign sequential chunkIndex (0-based)
 */
function chunkDecision(record: InputRecord, statsRef: Stats): Chunk[] {
  // ── Step 1: Strip footer ──────────────────────────────────────────────────
  const { text: cleanText, footerFound } = stripFooter(record.actPlainText);
  if (!footerFound) statsRef.noFooter++;

  // ── Step 2: Split into paragraphs ─────────────────────────────────────────
  const rawParagraphs = cleanText
    .split('\n\n')
    .map(p => p.trim())
    .filter(Boolean);

  if (rawParagraphs.length === 0) {
    // Pathological empty decision — emit a single chunk with just the title
    const chunks: Chunk[] = [{
      text: record.actTitle,
      metadata: {
        actId:      record.actId,
        actNumber:  record.actNumber,
        actDate:    toISODate(record.actDate),
        actTitle:   record.actTitle,
        actUrl:     record.actUrl,
        caseNumber: record.caseNumber,
        caseYear:   record.caseYear,
        department: record.department,
        chunkIndex: 0,
      },
    }];
    statsRef.totalChunks += chunks.length;
    statsRef.chunksPerDecision.push(chunks.length);
    return chunks;
  }

  // ── Step 3: Merge pass — short paragraphs (<150 chars) ───────────────────
  const merged = mergeParagraphs(rawParagraphs);

  // ── Step 4: Split pass — oversized paragraphs (>1,400 chars) ─────────────
  const chunkTexts: string[] = [];
  for (const paragraph of merged) {
    if (paragraph.length <= MAX_CHUNK_SIZE) {
      chunkTexts.push(paragraph);
    } else {
      statsRef.oversizedSplits++;
      chunkTexts.push(...splitOversizedParagraph(paragraph));
    }
  }

  // ── Step 5 & 6: Prepend actTitle to first chunk; assign chunkIndex ────────
  const isoDate  = toISODate(record.actDate);
  const baseMeta = {
    actId:      record.actId,
    actNumber:  record.actNumber,
    actDate:    isoDate,
    actTitle:   record.actTitle,
    actUrl:     record.actUrl,
    caseNumber: record.caseNumber,
    caseYear:   record.caseYear,
    department: record.department,
  };

  const chunks: Chunk[] = chunkTexts.map((text, i) => ({
    text:     i === 0 ? `${record.actTitle}\n\n${text}` : text,
    metadata: { ...baseMeta, chunkIndex: i },
  }));

  statsRef.totalChunks += chunks.length;
  statsRef.chunksPerDecision.push(chunks.length);

  return chunks;
}

// ============================================================================
// STATISTICS
// ============================================================================

function printStats(stats: Stats): void {
  const cpd = stats.chunksPerDecision;
  const min = cpd.length ? Math.min(...cpd) : 0;
  const max = cpd.length ? Math.max(...cpd) : 0;
  const avg = cpd.length
    ? (cpd.reduce((a, b) => a + b, 0) / cpd.length).toFixed(1)
    : '0';

  const line = '═'.repeat(58);
  console.log(`\n${line}`);
  console.log('CHUNKING COMPLETE');
  console.log(line);
  console.log(`Decisions processed  :  ${stats.decisions.toLocaleString()}`);
  if (stats.parseErrors > 0) {
    console.log(`Parse errors skipped :  ${stats.parseErrors}`);
  }
  console.log(`Total chunks         :  ${stats.totalChunks.toLocaleString()}`);
  console.log('');
  console.log('Footer stats:');
  console.log(`  Footer not found (text ran to end) : ${stats.noFooter}`);
  console.log('');
  console.log(`Oversized paragraphs split           : ${stats.oversizedSplits}`);
  console.log('');
  console.log('Chunks per decision:');
  console.log(`  min ${min}   max ${max}   avg ${avg}`);
  console.log(`${line}\n`);
}

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

interface CliArgs {
  input:  string;
  output: string;
  limit:  number;    // 0 = no limit
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);

  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };

  const input = flag('--input');
  if (!input) {
    console.error(
      'Error: --input <path> is required.\n\n' +
      'Usage:\n' +
      '  npx tsx scripts/chunkVksDecisions.ts --input <path> [--output <path>] [--limit <n>] [--dry-run]\n'
    );
    process.exit(1);
  }

  const defaultOutput = path.join(
    path.dirname(input),
    'chunks_' + path.basename(input),
  );

  return {
    input,
    output:  flag('--output') ?? defaultOutput,
    limit:   Math.max(0, parseInt(flag('--limit') ?? '0', 10) || 0),
    dryRun:  argv.includes('--dry-run'),
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(`Input  : ${args.input}`);
  console.log(`Output : ${args.dryRun ? '(dry-run — no file written)' : args.output}`);
  if (args.limit > 0) console.log(`Limit  : first ${args.limit} decisions`);
  console.log('');

  if (!fs.existsSync(args.input)) {
    console.error(`Error: input file not found: ${args.input}`);
    process.exit(1);
  }

  if (!args.dryRun) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  }

  const stats: Stats = {
    decisions:         0,
    parseErrors:       0,
    totalChunks:       0,
    noFooter:          0,
    oversizedSplits:   0,
    chunksPerDecision: [],
  };

  const outStream = args.dryRun
    ? null
    : fs.createWriteStream(args.output, { encoding: 'utf8' });

  const lineReader = rl.createInterface({
    input:     fs.createReadStream(args.input, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let progressLineOpen = false;

  for await (const line of lineReader) {
    if (!line.trim()) continue;
    if (args.limit > 0 && stats.decisions >= args.limit) break;

    let record: InputRecord;
    try {
      record = JSON.parse(line) as InputRecord;
    } catch {
      stats.parseErrors++;
      console.warn(`Warning: skipping unparseable line ${stats.decisions + stats.parseErrors}`);
      continue;
    }

    stats.decisions++;

    // Progress indicator — one dot per 100 decisions, count + newline every 1,000
    if (stats.decisions % 1_000 === 0) {
      process.stdout.write(` ${stats.decisions}\n`);
      progressLineOpen = false;
    } else if (stats.decisions % 100 === 0) {
      process.stdout.write('.');
      progressLineOpen = true;
    }

    const chunks = chunkDecision(record, stats);

    if (outStream) {
      for (const chunk of chunks) {
        outStream.write(JSON.stringify(chunk) + '\n');
      }
    }
  }

  if (progressLineOpen) process.stdout.write('\n');

  if (outStream) {
    await new Promise<void>((resolve, reject) => {
      outStream.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
    console.log(`\nWrote ${stats.totalChunks.toLocaleString()} chunks → ${args.output}`);
  }

  printStats(stats);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
