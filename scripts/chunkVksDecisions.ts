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
 *   npx ts-node scripts/chunkVksDecisions.ts --input <path> [options]
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
 *     npx ts-node scripts/chunkVksDecisions.ts \
 *       --input downloads/vks/department_commercial/decisions/decisionsDataCommercial.jsonl
 *
 *     # Quick sanity check — first 20 decisions, no file written
 *     npx ts-node scripts/chunkVksDecisions.ts \
 *       --input downloads/vks/department_commercial/decisions/decisionsDataCommercial.jsonl \
 *       --limit 20 --dry-run
 *
 *     # Explicit output path
 *     npx ts-node scripts/chunkVksDecisions.ts \
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
 *                         dates are lexicographically sortable and range-filterable
 *                         in Convex vector search metadata filters.
 *
 *   actTitle     string   Human-readable title string
 *                         e.g. "Решение №1/22.04.2016 по дело №2750/2014"
 *                         Embedded in the header chunk text (see CHUNK TYPES).
 *                         Stored as metadata on all other chunks (for display).
 *
 *   actUrl       string   Canonical source URL on domino.vks.bg
 *                         Stored as metadata only — never embedded in chunk text.
 *
 *   caseNumber   string   Case number within the filing year, e.g. "2750"
 *                         NOT the full reference — the full reference is
 *                         caseNumber + "/" + caseYear (e.g. "2750/2014").
 *                         The actTitle field contains the full human-readable form.
 *
 *   caseYear     string   Year the case was FILED, e.g. "2014"
 *                         NOTE: caseYear is the case filing year, not the decision
 *                         year. These can differ — a case filed in 2014 may be
 *                         decided in 2016.
 *
 *   department   string   Court department slug, e.g. "commercial" or "civil"
 *
 *   actPlainText string   Full structured plain text of the decision.
 *                         Produced by scraperVksDecisions.ts → cleanContent()
 *                         → processHeader() + processBody() pipeline.
 *                         Structure: header block \n\n body paragraphs \n\n ruling
 *                         See ACTPLAINTEXT STRUCTURE below for the exact layout.
 *
 *
 * OUTPUT FORMAT
 * -------------
 * JSONL — one JSON object per line. Each object represents one chunk:
 *
 *   text         string   The text content to embed.
 *                         Header chunks: actTitle prepended to header paragraphs.
 *                         Reasoning/ruling chunks: the paragraph text only.
 *
 *   metadata     object
 *     actId        string   Unique decision key
 *     actNumber    string   Non-unique decision number
 *     actDate      string   ISO 8601 date "YYYY-MM-DD"
 *     actTitle     string   Human-readable title (for display in search results)
 *     actUrl       string   Source URL (for linking back to original)
 *     caseNumber   string   Case number within the filing year (e.g. "2750")
 *                           Combine with caseYear for the full reference: "2750/2014"
 *     caseYear     string   Case filing year (e.g. "2014")
 *     department   string   Court department
 *     sectionType  string   "header" | "reasoning" | "ruling"
 *     chunkIndex   number   0-based sequential position within this decision's chunks.
 *                           header=0, then reasoning chunks, then ruling chunks —
 *                           all in document order. Allows reconstructing document
 *                           order from search results.
 *
 *
 * CHUNK TYPES  (sectionType)
 * --------------------------
 *
 * ① "header"  —  1 per decision
 *
 *   Text content:
 *     actTitle prepended to the structured header block (title line "Р Е Ш Е Н И Е",
 *     decision number, date, "В ИМЕТО НА НАРОДА", court description, judges block,
 *     clerk/session block ending with "за да се произнесе, взе предвид:").
 *
 *   Why embed actTitle in the text:
 *     So that identity searches ("Решение №1/22.04.2016", judge name "Ваня Алексиева",
 *     case reference "т.дело № 2750/2014") reliably surface this chunk via semantic
 *     similarity. Without it, a user searching by judge name would get zero results
 *     from the header chunk because the judge name appears only in the structured
 *     header block, not as a standalone searchable phrase.
 *
 *   Size: always exactly one chunk — the header block is compact by nature and is
 *   never split.
 *
 *
 * ② "reasoning"  —  ~5–25 per decision
 *
 *   Text content:
 *     Individual paragraphs of the substantive legal reasoning body — everything
 *     between the header and the ruling section.
 *
 *   Purpose:
 *     Primary search target for legal doctrine, legal concepts, and precedent.
 *     Most user queries ("основателност на касационна жалба", "чл.290 ГПК") will
 *     be answered by reasoning chunks.
 *
 *   Note on short paragraphs:
 *     Short standalone lines (< 300 chars) are kept as individual chunks and never
 *     merged with neighbours. In Bulgarian legal text these are often the most
 *     important sentences: "Решението е неправилно.", "Касационната жалба е
 *     основателна." Merging them would dilute their semantic signal.
 *
 *
 * ③ "ruling"  —  1–several per decision  (0 if fallback triggered — see FALLBACKS)
 *
 *   Text content:
 *     The operative outcome of the decision — everything from the ruling start marker
 *     to the footer (or end of text). Typically contains ОТМЕНЯ, ПОТВЪРЖДАВА, ОСЪЖДА,
 *     ВРЪЩА за ново разглеждане, and the finality phrase.
 *
 *   Purpose:
 *     Highest-value content for judges needing the operative result.
 *     Filtered search on sectionType: "ruling" returns only operative outcomes.
 *
 *
 * ACTPLAINTEXT STRUCTURE
 * ----------------------
 * The actPlainText field produced by scraperVksDecisions.ts has this layout:
 *
 *   Р Е Ш Е Н И Е                    ← own paragraph (\n\n separated)
 *
 *   № N                               ← own paragraph
 *
 *   В ИМЕТО НА НАРОДА                ← own paragraph
 *
 *   гр. София, дата…                  ← own paragraph
 *   Върховният касационен съд…        ← own paragraph
 *
 *   ПРЕДСЕДАТЕЛ: X                    ← ┐ judges sub-block — \n between lines,
 *   ЧЛЕНОВЕ: Y                        ← │ NO blank lines within this sub-block
 *   Name2                             ← ┘
 *                                        ← blank line between the two sub-blocks
 *   при секретаря …                   ← ┐ clerk/session sub-block — \n between lines,
 *   като изслуша докладваното …       ← │ NO blank lines within this sub-block
 *   за да се произнесе, взе предвид:  ← ┘
 *
 *   [BODY / REASONING paragraphs]     ← \n\n between paragraphs, \n within paragraphs
 *                                        short lines NEVER merged with neighbours
 *
 *   Р Е Ш И :                        ← ruling marker (may have spaces between letters,
 *                                        colon optional, may appear mid-sentence)
 *   ОТМЕНЯ / ПОТВЪРЖДАВА …            ← ruling operative paragraphs
 *   Решението е окончателно.          ← finality phrase (inside ruling, not end marker)
 *
 *   ПРЕДСЕДАТЕЛ:                      ← footer — discarded (no semantic value)
 *   ЧЛЕНОВЕ: 1.
 *   2.
 *
 *
 * SECTION DETECTION ALGORITHM
 * ---------------------------
 *
 * ── Step 1: Header / body boundary ──────────────────────────────────────────
 *
 *   Split actPlainText by '\n\n' into paragraphs.
 *   Find the first paragraph whose first line matches any BODY_START_PATTERNS
 *   (identical patterns to those in scraperVksDecisions.ts).
 *
 *   → paragraphs[0 .. bodyStartIdx-1]  =  header section
 *   → paragraphs[bodyStartIdx ..]      =  body + ruling (processed in steps 2–3)
 *
 *   Fallback: if no BODY_START_PATTERNS match is found, treat paragraph[0] as
 *   the header and the rest as body. The scraper's own fallback guarantees that
 *   the body always starts within the first 15 lines, so this is extremely rare.
 *
 *
 * ── Step 2: Ruling start (line-level scan) ───────────────────────────────────
 *
 *   Split the body+ruling text by '\n' into individual lines.
 *   (Empty strings in this array represent the \n\n paragraph boundaries and are
 *   preserved faithfully when the lines are re-joined with '\n' later.)
 *
 *   Scan each line with isRulingMarker(). First matching line = ruling start.
 *   All lines before it form the reasoning section.
 *
 *   The pure ruling-marker line itself ("Р Е Ш И:", "ОПРЕДЕЛИ:") is stripped
 *   from the top of the ruling content — the sectionType: "ruling" metadata
 *   already identifies this section. If the marker is embedded in a sentence
 *   ("Водим от горното ВКС, второ отделение РЕШИ:"), the full sentence is kept
 *   because it provides meaningful context.
 *
 *   Fallback: if no ruling marker is found, the entire body is treated as
 *   reasoning. No ruling chunks are produced for that decision.
 *
 *
 * ── Step 3: Footer / ruling end ──────────────────────────────────────────────
 *
 *   Starting from the line AFTER the ruling start, scan forward for the first
 *   line that starts with "ПРЕДСЕДАТЕЛ:" — this is the footer signature block.
 *
 *   Why search only AFTER the ruling marker:
 *     The header composition block also starts with "ПРЕДСЕДАТЕЛ: X" (the presiding
 *     judge's name). It appears before the ruling marker and must not be confused
 *     with the footer. By restricting the footer search to lines after the ruling
 *     marker, this false match is completely avoided.
 *
 *   The footer line and all following lines are discarded.
 *
 *   Fallback: if no "ПРЕДСЕДАТЕЛ:" line is found after the ruling marker, the
 *   ruling section runs to the end of the text.
 *
 *
 * RULING MARKER DETECTION  (isRulingMarker)
 * ------------------------------------------
 *
 *   A line is a ruling marker if, after stripping internal spaces between
 *   consecutive uppercase Cyrillic letters, it CONTAINS any of:
 *     РЕШИ    — singular, most common
 *     РЕШИХА  — plural/panel form
 *     ОПРЕДЕЛИ — procedural ruling variant
 *
 *   Key properties:
 *     • Colon is OPTIONAL    "РЕШИ" and "РЕШИ:" both match
 *     • ANY position on line  "...ВКС, второ отделение РЕШИ:" → match
 *     • ALL CAPS required     "реши" or "Реши" in running text → no match
 *     • Space-stripping:      "Р Е Ш И", "Р  Е  Ш  И" → normalised to "РЕШИ"
 *
 *   NOT markers (explicitly excluded):
 *     ПОСТАНОВЯВА, ПОСТАНОВИ — appear as sub-markers within ruling content
 *     (e.g. "...като вместо него ПОСТАНОВЯВА:") or in reasoning text.
 *     They are never the start of the ruling section.
 *
 *
 * CHUNK SIZING RULES
 * ------------------
 *   Applied identically to ② reasoning and ③ ruling sections.
 *   The section text is split into paragraphs (\n\n boundaries) first.
 *   Each paragraph is then handled as follows:
 *
 *   length < 300 chars
 *     → 1 chunk, emitted as-is. NEVER merged with neighbours.
 *       Short standalone lines are often key legal conclusions.
 *
 *   300 ≤ length ≤ 1,400 chars
 *     → 1 chunk (the whole paragraph).
 *
 *   length > 1,400 chars
 *     → Split at Bulgarian sentence boundaries using splitOversizedParagraph().
 *       Sentence boundary regex: /(?<=[.!?])\s+(?=[А-ЯA-Z])/
 *       2 sentences of overlap are carried over to the next sub-chunk to preserve
 *       cross-boundary semantic context.
 *
 *   ① Header: always exactly 1 chunk, regardless of size.
 *
 *
 * FALLBACK POLICY
 * ---------------
 *   All fallbacks degrade gracefully — no errors, no skipped decisions:
 *
 *   No BODY_START_PATTERNS match  → paragraph[0] = header, rest = body (reasoning)
 *   No ruling marker found        → all body = reasoning; 0 ruling chunks produced
 *   No footer after ruling marker → ruling runs to end of text
 *
 *   All three fallback counters are reported in the final statistics summary.
 *
 *
 * STATISTICS OUTPUT
 * -----------------
 *   Printed to stdout on completion:
 *     • Decisions processed, parse errors, total chunks
 *     • Chunk counts by sectionType (header / reasoning / ruling)
 *     • Fallback counts (no body-start match, no ruling marker, no footer)
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
 * Maximum character length for a single reasoning or ruling chunk.
 * Paragraphs longer than this are split at sentence boundaries.
 *
 * Set to 1,400 chars based on domain expert preference for full-paragraph
 * context when reading search results (~1,200–1,500 chars is the sweet spot).
 */
const MAX_CHUNK_SIZE = 1_400;

/**
 * Number of sentences carried over from the end of one sub-chunk to the
 * beginning of the next when splitting an oversized paragraph.
 *
 * This overlap preserves cross-boundary semantic context for the embedding
 * model. Without it, a legal argument that spans a sentence boundary would
 * be split into two vectors with no shared context.
 */
const OVERLAP_SENTENCES = 2;

// ============================================================================
// BODY START PATTERNS
// ============================================================================

/**
 * Regexes that identify the first line of the reasoning body section.
 *
 * These are the same patterns used in scraperVksDecisions.ts (BODY_START_PATTERNS)
 * to split the header from the body during HTML-to-text cleaning. The chunker
 * re-applies them to the already-cleaned actPlainText field to re-detect the
 * same header/body boundary.
 *
 * Patterns cover the most common opening phrases of the reasoning section:
 *   "Производството е по чл.290 ГПК."
 *   "Образувано е по касационна жалба…"
 *   "Предявен иск е с правно основание…"
 *   etc.
 *
 * If none match, the chunker falls back to treating paragraph[0] as the header
 * and the rest as the body (see FALLBACK POLICY in the file overview above).
 *
 * To extend coverage for a new opening phrase: add one regex line here.
 * Validate with: npx ts-node scripts/validateVksDecisionsContent.ts --department commercial
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

function isBodyStart(line: string): boolean {
  return BODY_START_PATTERNS.some(p => p.test(line.trim()));
}

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
  caseYear:     string;        // year case was FILED — may differ from decision year
  department:   string;
  actPlainText: string;
  validation:   { isValid: boolean; contentHash: string; wordCount: number };
  processedAt:  string;
}

/** Metadata attached to every output chunk. Maps 1:1 to rag.add() filter fields. */
interface ChunkMetadata {
  actId:       string;
  actNumber:   string;         // NOT unique — use actId as the primary key
  actDate:     string;         // ISO 8601 "YYYY-MM-DD" — lexicographically sortable
  actTitle:    string;         // for display; also embedded in header chunk text
  actUrl:      string;         // source URL — metadata only, not embedded
  caseNumber:  string;
  caseYear:    string;
  department:  string;
  sectionType: 'header' | 'reasoning' | 'ruling';
  chunkIndex:  number;         // 0-based sequential position within this decision
}

/** One output chunk — maps directly to one rag.add() call. */
interface Chunk {
  text:     string;
  metadata: ChunkMetadata;
}

/** Result of detectSections() — the three raw text sections plus diagnostic flags. */
interface Sections {
  headerText:    string;
  reasoningText: string;
  rulingText:    string;
  flags: {
    /** No BODY_START_PATTERNS match found — fell back to paragraph[0] as header. */
    noBodyStartMatch: boolean;
    /** No ruling marker (РЕШИ/ОПРЕДЕЛИ) found — entire body treated as reasoning. */
    noRulingMarker:   boolean;
    /** No ПРЕДСЕДАТЕЛ: line found after ruling marker — ruling runs to end of text. */
    noFooter:         boolean;
  };
}

/** Mutable counters accumulated across all decisions for the final stats print. */
interface Stats {
  decisions:         number;
  parseErrors:       number;
  totalChunks:       number;
  byType:            { header: number; reasoning: number; ruling: number };
  noBodyStartMatch:  number;
  noRulingMarker:    number;
  noFooter:          number;
  oversizedSplits:   number;
  chunksPerDecision: number[];   // collected for min/max/avg computation
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Converts a Bulgarian date string (DD.MM.YYYY) to ISO 8601 (YYYY-MM-DD).
 *
 * WHY: ISO 8601 strings are lexicographically sortable — "2020-01-01" < "2021-06-15"
 * evaluates correctly as a plain string comparison. The Bulgarian DD.MM.YYYY format
 * is NOT sortable this way ("01.01.2020" > "02.01.2010" alphabetically, which is wrong).
 * Convex vector search metadata filters rely on string comparison for range queries,
 * so ISO 8601 is required for correct date filtering.
 *
 * @example toISODate("22.04.2016") → "2016-04-22"
 * @example toISODate("01.01.2020") → "2020-01-01"
 * @param dateBG  Date in DD.MM.YYYY format
 * @returns       ISO 8601 date string, or the original string unchanged if the
 *                format is unexpected (ensures the pipeline never crashes on bad dates)
 */
function toISODate(dateBG: string): string {
  const m = dateBG.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return dateBG;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ============================================================================
// RULING MARKER DETECTION
// ============================================================================

/**
 * Strips all whitespace between consecutive uppercase Cyrillic letters.
 *
 * WHY: Throughout the VKS corpus, section-header words appear with spaces between
 * every letter — "Р Е Ш И", "О П Р Е Д Е Л И", "Р  Е  Ш  И" (gap width varies).
 * Normalising these to compact forms ("РЕШИ", "ОПРЕДЕЛИ") enables simple matching.
 *
 * The substitution is applied in a loop until the string stabilises. This handles
 * arbitrary numbers of spaces between letters, not just single spaces.
 *
 * Only strips spaces that are strictly between two uppercase Cyrillic letters.
 * Whitespace elsewhere (e.g. before a colon, within mixed-case sentences) is kept.
 *
 * The regex uses ` +` (one or more spaces) so it handles both single-space variants
 * ("Р Е Ш И") and multi-space variants ("Р  Е  Ш  И", "Р   Е   Ш   И") that
 * occasionally appear in older source documents. Multiple iterations of the loop
 * collapse each gap in turn until the string stabilises.
 *
 * NOTE: The scraper's normalizeInlineSpaces() reduces all whitespace runs to a
 * single space before writing actPlainText, so multi-space variants are not
 * expected in the current JSONL. The ` +` regex makes the function robust against
 * any future data source that may not pre-normalise whitespace.
 *
 * @example stripCyrillicWordSpaces("Р Е Ш И :")           → "РЕШИ :"
 * @example stripCyrillicWordSpaces("Р  Е  Ш  И  :")       → "РЕШИ :"
 * @example stripCyrillicWordSpaces("О П Р Е Д Е Л И")     → "ОПРЕДЕЛИ"
 * @example stripCyrillicWordSpaces("при секретаря")        → "при секретаря"  (unchanged)
 * @example stripCyrillicWordSpaces("Р Е Ш Е Н И Е")       → "РЕШЕНИЕ"        (title — not a marker)
 */
function stripCyrillicWordSpaces(text: string): string {
  let prev = '';
  let curr = text;
  while (prev !== curr) {
    prev = curr;
    // ` +` handles any number of spaces between consecutive uppercase Cyrillic letters,
    // including the multi-space variants ("Р  Е  Ш  И") that appear in some source documents.
    curr = curr.replace(/([А-ЯЁ]) +([А-ЯЁ])/g, '$1$2');
  }
  return curr;
}

/**
 * Returns true if the given line contains a ruling section start marker.
 *
 * RECOGNISED MARKERS (after stripping intra-word Cyrillic spaces):
 *   РЕШИ    — singular, most common form
 *   РЕШИХА  — plural/panel form (semantically identical ruling start)
 *   ОПРЕДЕЛИ — procedural ruling variant
 *
 * NOT MARKERS — explicitly excluded:
 *   ПОСТАНОВЯВА — appears as a sub-marker INSIDE ruling content, e.g.:
 *                 "…като вместо него ПОСТАНОВЯВА:" — this continues an existing ruling,
 *                 it does not start the ruling section.
 *   ПОСТАНОВИ   — same exclusion; appears in reasoning or inside ruling content.
 *
 * DETECTION RULES:
 *   1. Colon after marker is OPTIONAL
 *      "РЕШИ", "РЕШИ:", "РЕШИ :" — all match.
 *
 *   2. Match may occur ANYWHERE on the line — beginning, middle, or end.
 *      "Водим от горното ВКС, второ отделение РЕШИ:"  → match (mid-sentence)
 *      "Р Е Ш И:"                                     → match (standalone)
 *
 *   3. ALL CAPS required — "реши" or "Реши" in running lowercase text → no match.
 *
 *   4. Whole-word matching — the marker must not be a substring of a longer uppercase
 *      word. Ensured by requiring non-uppercase-Cyrillic characters (or
 *      start/end of string) on both sides of the match.
 *
 * @param line  A single line of text (not yet space-stripped by the caller)
 * @returns     true if this line contains a ruling section start marker
 */
function isRulingMarker(line: string): boolean {
  const stripped = stripCyrillicWordSpaces(line);
  // After stripping Cyrillic word-spaces, check for РЕШИ(ХА) or ОПРЕДЕЛИ
  // as a whole token (not a substring of a longer all-caps word).
  return /(?:^|[^А-ЯЁ])(РЕШИ(ХА)?\s*:?|ОПРЕДЕЛИ\s*:?)(?:[^А-ЯЁ]|$)/.test(stripped);
}

// ============================================================================
// SECTION DETECTION
// ============================================================================

/**
 * Splits the actPlainText of one decision into three raw text sections:
 * header, reasoning, and ruling.
 *
 * Implements the three-step algorithm described in detail in the file overview:
 *   Step 1 — Header/body boundary via BODY_START_PATTERNS (paragraph level)
 *   Step 2 — Ruling start via isRulingMarker() (line level)
 *   Step 3 — Footer/ruling-end via ПРЕДСЕДАТЕЛ: (line level, after ruling start)
 *
 * The returned texts are raw strings ready to be passed to chunkSectionText().
 * Empty strings are valid (e.g. rulingText="" when the fallback fires).
 *
 * Paragraph-boundary '\n\n' sequences are preserved throughout:
 *   When bodyAndRuling is split by '\n' into allLines, the '\n\n' boundaries
 *   become empty-string '' elements. Re-joining those slices with '\n' faithfully
 *   reconstructs '\n\n' in the output — which chunkSectionText() then splits on.
 *
 * @param actPlainText  Full structured plain text from the input JSONL record
 * @returns             Sections object with headerText, reasoningText, rulingText, flags
 */
function detectSections(actPlainText: string): Sections {

  // ── Step 1: Header / body boundary (paragraph level) ─────────────────────
  const paragraphs = actPlainText.split('\n\n');

  // Find first paragraph whose first line matches BODY_START_PATTERNS.
  let bodyStartIdx = paragraphs.findIndex(p => isBodyStart(p.split('\n')[0]));
  const noBodyStartMatch = bodyStartIdx === -1;
  if (noBodyStartMatch) {
    // Fallback: no pattern matched — treat paragraph[0] as header, rest as body.
    bodyStartIdx = Math.min(1, paragraphs.length - 1);
  }

  const headerText    = paragraphs.slice(0, bodyStartIdx).join('\n\n');
  const bodyAndRuling = paragraphs.slice(bodyStartIdx).join('\n\n');

  // ── Step 2: Ruling start (line level) ────────────────────────────────────
  // Split into individual lines. Empty strings represent '\n\n' paragraph
  // boundaries — they are intentionally preserved for later re-joining.
  const allLines      = bodyAndRuling.split('\n');
  let   rulingStartIdx = -1;

  for (let i = 0; i < allLines.length; i++) {
    if (isRulingMarker(allLines[i])) {
      rulingStartIdx = i;
      break;
    }
  }

  if (rulingStartIdx === -1) {
    // Fallback: no ruling marker found — entire body is reasoning, no ruling chunks.
    return {
      headerText,
      reasoningText: bodyAndRuling,
      rulingText:    '',
      flags: { noBodyStartMatch, noRulingMarker: true, noFooter: false },
    };
  }

  // ── Step 3: Footer detection (line level, AFTER ruling start only) ────────
  // Scanning only after the ruling start prevents matching the header composition
  // block's "ПРЕДСЕДАТЕЛ: Ваня Алексиева" line, which precedes the ruling marker.
  let footerIdx = -1;
  for (let i = rulingStartIdx + 1; i < allLines.length; i++) {
    if (/^ПРЕДСЕДАТЕЛ\s*:/i.test(allLines[i].trim())) {
      footerIdx = i;
      break;
    }
  }

  // ── Slice into sections ───────────────────────────────────────────────────
  const reasoningLines = allLines.slice(0, rulingStartIdx);
  let   rulingLines    = footerIdx !== -1
    ? allLines.slice(rulingStartIdx, footerIdx)
    : allLines.slice(rulingStartIdx);

  // Strip the pure ruling-marker line from the top of the ruling content.
  // A pure marker ("Р Е Ш И:", "ОПРЕДЕЛИ:") is a structural divider with no
  // semantic content of its own — the sectionType: "ruling" metadata already
  // identifies this section.
  // Exception: if the marker is embedded mid-sentence
  //   e.g. "Водим от горното ВКС, второ отделение РЕШИ:"
  // the entire sentence is kept because it provides meaningful context.
  if (rulingLines.length > 0) {
    const norm = stripCyrillicWordSpaces(rulingLines[0]).replace(/\s*:?\s*$/, '').trim();
    if (/^(РЕШИ(ХА)?|ОПРЕДЕЛИ)$/.test(norm)) {
      rulingLines = rulingLines.slice(1);
      // Drop any leading blank lines left after marker removal
      while (rulingLines.length > 0 && rulingLines[0].trim() === '') {
        rulingLines = rulingLines.slice(1);
      }
    }
  }

  return {
    headerText,
    reasoningText: reasoningLines.join('\n'),
    rulingText:    rulingLines.join('\n'),
    flags: { noBodyStartMatch, noRulingMarker: false, noFooter: footerIdx === -1 },
  };
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
 * WHY this avoids false splits on common abbreviations:
 *   Legal text is dense with abbreviations like "чл.290", "т.д.", "ал.1", "ГПК.",
 *   "АД.", "ЕООД.". These are NOT followed by space + uppercase, so the regex
 *   does not split on them. Only genuine sentence endings (". Следва", ". При")
 *   are matched.
 *
 * The lookbehind keeps the terminal punctuation attached to the preceding sentence,
 * not the following one. Each returned string includes its closing punctuation.
 *
 * @param text  A single paragraph (no \n\n paragraph boundaries inside)
 * @returns     Array of sentence strings, each trimmed, each non-empty
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
 * Splits an oversized paragraph (length > MAX_CHUNK_SIZE) into smaller chunks,
 * each no larger than MAX_CHUNK_SIZE characters, with OVERLAP_SENTENCES sentences
 * of carry-over context between adjacent chunks.
 *
 * ALGORITHM:
 *   1. Split paragraph into sentences with splitSentences().
 *   2. Greedily accumulate sentences into a buffer (current chunk-in-progress).
 *   3. When adding the next sentence would push the buffer over maxSize:
 *      a. Emit the current buffer as a completed chunk.
 *      b. Seed the next buffer with the last `overlapCount` sentences from the
 *         just-emitted chunk. These overlap sentences act as a "context bridge"
 *         so the embedding model on the next chunk has shared context with the
 *         previous one.
 *   4. Emit whatever remains in the buffer as the final chunk.
 *
 * EDGE CASES:
 *   • Overlap sentences together exceed maxSize:
 *     After emitting a chunk, the last `overlapCount` sentences are seeded as
 *     context for the next chunk. The seed is trimmed from the front until
 *     (seed + incoming sentence) fits within maxSize — not just until seed alone
 *     fits. This is the correct invariant: it guarantees that pushing the next
 *     sentence onto the seeded buffer will not immediately exceed the limit.
 *     Confirmed in 86 real corpus paragraphs where two overlap sentences together
 *     exceed 1,400 chars. If even a single seeded sentence + the incoming one
 *     exceeds maxSize, the seed is cleared and the incoming sentence starts alone.
 *
 *   • A single sentence > maxSize (confirmed: longest in corpus is 2,926 chars):
 *     Emitted as its own chunk regardless of maxSize. No overlap is seeded from
 *     it — the sentence is already over the limit before any new content.
 *
 *   • Input with only one sentence: returned as-is in a single-element array.
 *   • Empty input: returned as [text] (original string, possibly empty).
 *
 * @param text          The oversized paragraph text to split
 * @param maxSize       Per-chunk character limit (default: MAX_CHUNK_SIZE = 1,400)
 * @param overlapCount  Sentences to carry over between chunks (default: OVERLAP_SENTENCES = 2)
 * @returns             Array of chunk strings. Each is ≤ maxSize chars except
 *                      the single-sentence edge case (sentence > maxSize).
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

        // Seed the next buffer with the last `overlapCount` sentences as context.
        // Trim from the front until (overlap + current sentence) fits within maxSize.
        // WHY this exact condition: if we only trimmed until overlap alone < maxSize,
        // pushing the current sentence could still produce a buffer > maxSize (confirmed
        // in 86 real corpus paragraphs with long sentences). The correct invariant is
        // that the NEXT chunk must start within the limit — so we trim until the seed
        // plus the sentence we are about to add fits.
        // If even with no overlap the sentence alone exceeds maxSize, it is the
        // unavoidable single-sentence edge case and will be emitted as-is.
        buffer = buffer.slice(-overlapCount);
        while (buffer.length > 0 && `${buffer.join(' ')} ${sentence}`.length > maxSize) {
          buffer = buffer.slice(1);
        }
      }
      // Append the current sentence. If it alone exceeds maxSize we can't split
      // it further — it will be emitted as an oversized chunk on the next boundary.
      buffer.push(sentence);
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer.join(' '));
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Converts the raw text of a reasoning or ruling section into an array of
 * chunk text strings, applying the paragraph-based sizing rules.
 *
 * The section text may contain multiple paragraphs separated by '\n\n'.
 * Each paragraph is processed independently — paragraphs are never merged.
 *
 * SIZING RULES (per paragraph):
 *   length < 300 chars
 *     → 1 chunk as-is. Never merged with neighbours. Short standalone lines
 *       are often key legal conclusions ("Решението е неправилно.") — merging
 *       them would dilute their semantic signal. Both this case and the normal
 *       case below take the same code path (no branch needed).
 *
 *   300 ≤ length ≤ MAX_CHUNK_SIZE (1,400 chars)
 *     → 1 chunk (the full paragraph text).
 *
 *   length > MAX_CHUNK_SIZE
 *     → Split with splitOversizedParagraph(). The onOversized callback is invoked
 *       once per such paragraph (used by the caller to increment the stats counter).
 *
 * The ① header section bypasses this function entirely — the caller emits it
 * as a single chunk directly in chunkDecision().
 *
 * @param sectionText   Raw text of the section (may span multiple \n\n paragraphs)
 * @param onOversized   Optional callback, called once per oversized paragraph split
 * @returns             Array of chunk text strings, in document order
 */
function chunkSectionText(
  sectionText: string,
  onOversized?: () => void,
): string[] {
  if (!sectionText.trim()) return [];

  const paragraphs = sectionText
    .split('\n\n')
    .map(p => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK_SIZE) {
      chunks.push(paragraph);
    } else {
      onOversized?.();
      chunks.push(...splitOversizedParagraph(paragraph));
    }
  }

  return chunks;
}

// ============================================================================
// DECISION PROCESSING
// ============================================================================

/**
 * Processes one InputRecord into an ordered array of Chunk objects.
 *
 * CHUNK ORDER within a decision (reflected by chunkIndex, starting at 0):
 *   [0]       header chunk      (always exactly 1)
 *   [1..N]    reasoning chunks  (in document order; N ≥ 0)
 *   [N+1..M]  ruling chunks     (in document order; M-N ≥ 0; 0 if no marker found)
 *
 * HEADER CHUNK TEXT:
 *   actTitle is prepended to the header paragraphs so that identity searches
 *   surface this chunk:
 *     • "Ваня Алексиева 2014"       — judge name search
 *     • "Решение №1/22.04.2016"     — decision number search
 *     • "т.дело № 2750/2014"        — case reference search
 *   actTitle is also stored in metadata on all chunk types for display purposes.
 *
 * REASONING & RULING CHUNK TEXT:
 *   actTitle is in metadata only — keeping it out of the embedded text prevents
 *   doctrine/concept queries from being pulled toward identity matches.
 *
 * All edge-case flags from detectSections() are forwarded to the statsRef
 * counters so they appear in the final statistics summary.
 *
 * @param record    One parsed InputRecord from the input JSONL
 * @param statsRef  Mutable Stats object — counters are incremented in-place
 * @returns         Array of Chunk objects ready for rag.add(), in document order
 */
function chunkDecision(record: InputRecord, statsRef: Stats): Chunk[] {
  const { headerText, reasoningText, rulingText, flags } = detectSections(record.actPlainText);

  // Accumulate edge-case counters
  if (flags.noBodyStartMatch) statsRef.noBodyStartMatch++;
  if (flags.noRulingMarker)   statsRef.noRulingMarker++;
  if (flags.noFooter)         statsRef.noFooter++;

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

  const chunks:     Chunk[] = [];
  let   chunkIndex: number  = 0;

  // ── ① Header chunk (always exactly one) ───────────────────────────────────
  // actTitle prepended so identity searches reliably surface this chunk.
  // If headerText is empty (pathological input), actTitle alone is the chunk.
  const headerChunkText = [record.actTitle, headerText.trim()]
    .filter(Boolean)
    .join('\n\n');

  chunks.push({
    text:     headerChunkText,
    metadata: { ...baseMeta, sectionType: 'header', chunkIndex: chunkIndex++ },
  });
  statsRef.byType.header++;

  // ── ② Reasoning chunks ────────────────────────────────────────────────────
  for (const text of chunkSectionText(reasoningText, () => { statsRef.oversizedSplits++; })) {
    chunks.push({
      text,
      metadata: { ...baseMeta, sectionType: 'reasoning', chunkIndex: chunkIndex++ },
    });
    statsRef.byType.reasoning++;
  }

  // ── ③ Ruling chunks ───────────────────────────────────────────────────────
  for (const text of chunkSectionText(rulingText, () => { statsRef.oversizedSplits++; })) {
    chunks.push({
      text,
      metadata: { ...baseMeta, sectionType: 'ruling', chunkIndex: chunkIndex++ },
    });
    statsRef.byType.ruling++;
  }

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
  console.log(`Decisions processed :  ${stats.decisions.toLocaleString()}`);
  if (stats.parseErrors > 0) {
    console.log(`Parse errors skipped:  ${stats.parseErrors}`);
  }
  console.log(`Total chunks        :  ${stats.totalChunks.toLocaleString()}`);
  console.log('');
  console.log('Chunks by section type:');
  console.log(`  header            :  ${stats.byType.header.toLocaleString()}`);
  console.log(`  reasoning         :  ${stats.byType.reasoning.toLocaleString()}`);
  console.log(`  ruling            :  ${stats.byType.ruling.toLocaleString()}`);
  console.log('');
  console.log('Fallbacks triggered:');
  console.log(`  No body-start match (→ paragraph[0] as header) : ${stats.noBodyStartMatch}`);
  console.log(`  No ruling marker    (→ all body as reasoning)  : ${stats.noRulingMarker}`);
  console.log(`  No footer after ruling (→ ruling to end)       : ${stats.noFooter}`);
  console.log('');
  console.log(`Oversized paragraphs split : ${stats.oversizedSplits}`);
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
      '  npx ts-node scripts/chunkVksDecisions.ts --input <path> [--output <path>] [--limit <n>] [--dry-run]\n'
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
    byType:            { header: 0, reasoning: 0, ruling: 0 },
    noBodyStartMatch:  0,
    noRulingMarker:    0,
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

  // Track whether any progress characters have been written to the current line
  // so we only emit a trailing newline when there is actually something to close.
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

  // Close progress line only if something was written to it
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
