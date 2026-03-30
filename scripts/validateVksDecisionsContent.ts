// ============================================================================
// test-clean-content.ts
//
// PURPOSE
//   Validates the content structuring logic (processHeader + processBody +
//   body-start detection) against an already-scraped JSONL file.
//
//   Runs two modes in sequence:
//     1. STATS — scans every decision in the JSONL and reports what percentage
//                have their body-start phrase correctly detected.
//     2. DETAIL — prints the full restructured header and body paragraphs for
//                 a sample of decisions so you can visually verify the output.
//
//   NOTE: The structuring functions below are kept in sync with scraperVksDecisions.ts.
//         If you update the logic there, update it here too.
//
// USAGE (run from project root: cd C:\work\personal\projects\doxeek)
//   npx ts-node scripts/test-clean-content.ts --department commercial
//   npx ts-node scripts/test-clean-content.ts --department civil
//
//   # Inspect specific decisions by their index in the JSONL (0-based)
//   npx ts-node scripts/test-clean-content.ts --department commercial --index 0,100,300,500
//   npx ts-node scripts/test-clean-content.ts --department commercial --index 42
//
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

/** Shape of one line in the JSONL output file produced by scraperVksDecisions.ts */
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
  actPlainText: string;
  validation: {
    isValid: boolean;
    contentHash: string;
    wordCount: number;
  };
  processedAt: string;
}

interface RestructureResult {
  headerText: string;
  bodyText: string;
  full: string;
  bodyIdx: number;
  titleIdx: number;
  totalLines: number;
}

interface UndetectedEntry {
  i: number;
  id: string;
  len: number | undefined;
}

interface CLIOptions {
  department: string;
  indices: number[];
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    department: '',
    indices: [],
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--department' && args[i + 1]) {
      options.department = args[i + 1];
      i++;
    } else if (args[i] === '--index' && args[i + 1]) {
      options.indices = args[i + 1].split(',').map(Number);
      i++;
    }
  }

  return options;
}

function validateArgs(options: CLIOptions): void {
  if (!options.department || !['commercial', 'civil'].includes(options.department)) {
    console.log('❌ --department flag is required and must be "commercial" or "civil"');
    console.log('\nUsage:');
    console.log('  npx ts-node scripts/test-clean-content.ts --department commercial');
    console.log('  npx ts-node scripts/test-clean-content.ts --department civil');
    console.log('  npx ts-node scripts/test-clean-content.ts --department commercial --index 0,100,300');
    process.exit(1);
  }
}

// ============================================================================
// Content Structuring Functions
// (kept in sync with scraperVksDecisions.ts — update both if logic changes)
// ============================================================================

function normalizeInlineSpaces(str: string): string {
  return str.replace(/[ \t]+/g, ' ').trim();
}

const ITNON_LINE_RE     = /^В\s+(?:[А-Яа-я]\s*){3,10}Н\s*А\s+Н\s*А\s*Р\s*О\s*Д\s*А\s*$/;
const ITNON_EMBEDDED_RE = /В\s+(?:[А-Яа-я]\s*){3,10}Н\s*А\s+Н\s*А\s*Р\s*О\s*Д\s*А/;

// Strict patterns — anchored to the start of the line (^ anchor)
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

// Loose patterns — no ^ anchor, used in the stats check to catch cases where
// the body-start phrase appears mid-line (can happen in edge cases)
const BODY_START_LOOSE: RegExp[] = [
  /Производство(то)?\s+(е\s+)?по(\s+реда\s+на)?\s+чл\./,
  /Производство(то)?\s+се\s+развива\s+по\s+чл\./,
  /Производство(то)?\s+(е\s+)?образувано/,
  /Производство(то)?\s+по\s+делото\s+(е\s+)?образувано/,
  /Производство(то)?\s+(е\s+)?по\s+делото/,
  /Производство(то)?\s+(е\s+)?по\s+Глава/,
  /Предявен(ият)?\s+иск\s+е\s+с\s+правно\s+основание/,
  /Предявен\s+е\s+иск(\s+по\s+чл\.|\s+с\s+правно)/,
  /Образувано\s+е\s+по\s+(касационн|молб|искан|жалб|иск)/,
  /Производство(то)?\s+е\s+/,
  /Предявени\s+са\s+искове/,
];

function isBodyStart(line: string): boolean {
  return BODY_START_PATTERNS.some((p) => p.test(line));
}

function isBodyStartLoose(line: string): boolean {
  return BODY_START_LOOSE.some((p) => p.test(line));
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
      if (!titleSeen) { flushComposition(); blocks.push(line); titleSeen = true; }
    } else if (NUMBER_RE.test(line)) {
      flushComposition(); blocks.push(line);
    } else if (ITNON_LINE_RE.test(line)) {
      flushComposition(); blocks.push('В ИМЕТО НА НАРОДА');
    } else if (CHAIR_RE.test(line) || MEMBERS_RE.test(line)) {
      inComposition = true; judgeLines.push(line);
    } else if (inComposition) {
      if (inProcedural || PROCEDURAL_RE.test(line)) {
        inProcedural = true; proceduralLines.push(line);
      } else {
        judgeLines.push(line);
      }
    } else if (titleSeen && TITLE_FRAGMENT_RE.test(line)) {
      // Leftover title fragment → skip silently
    } else {
      flushComposition(); blocks.push(line);
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
      if (!lastWasBlank) { result.push(''); lastWasBlank = true; }
    } else {
      result.push(normalized);
      lastWasBlank = false;
    }
  }

  while (result.length > 0 && result[0] === '')                 result.shift();
  while (result.length > 0 && result[result.length - 1] === '') result.pop();

  return result.join('\n');
}

/**
 * Re-runs the structuring logic on an already-processed actPlainText.
 *
 * Since the actPlainText was produced by scraperVksDecisions.ts using the same
 * logic, this is effectively a round-trip validation — re-applying the same
 * pipeline to see if the output remains stable and well-structured.
 *
 * Note: raw HTML is not available here so the HTML→newline conversion step
 * (Step 1 in cleanContent) is not exercised. What IS validated: title detection,
 * ITNON splitting, body-start detection, and header/body separation.
 */
function restructure(actPlainText: string): RestructureResult {
  const TITLE_RE = /^Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+Е\s*$/;

  const allLines = actPlainText.split('\n').map(normalizeInlineSpaces);

  let titleIdx = allLines.findIndex((l) => TITLE_RE.test(l));
  if (titleIdx === -1)
    titleIdx = allLines.findIndex((l) => /Р\s+Е\s+Ш\s+Е\s+Н\s+И\s+Е/.test(l));

  const relevantLines = titleIdx >= 0 ? allLines.slice(titleIdx) : allLines;

  let bodyIdx = relevantLines.findIndex((l) => l.length > 0 && isBodyStart(l));
  if (bodyIdx === -1) bodyIdx = Math.min(15, relevantLines.length);

  const headerLines = relevantLines.slice(0, bodyIdx);
  const bodyLines   = relevantLines.slice(bodyIdx);

  const headerText = processHeader(headerLines);
  const bodyText   = processBody(bodyLines);

  return {
    headerText,
    bodyText,
    full:       [headerText, bodyText].filter(Boolean).join('\n\n'),
    bodyIdx,
    titleIdx,
    totalLines: relevantLines.length,
  };
}

// ============================================================================
// Main
// ============================================================================

const options = parseArgs();
validateArgs(options);

const dept = options.department.charAt(0).toUpperCase() + options.department.slice(1);
const JSONL = path.join(__dirname, `../downloads/vks/department_${options.department}/decisions/decisionsData${dept}.jsonl`);

if (!fs.existsSync(JSONL)) {
  console.error(`❌ JSONL file not found: ${JSONL}`);
  console.error(`   Run scraperVksDecisions.ts --department ${options.department} first.`);
  process.exit(1);
}

const rawLines = fs.readFileSync(JSONL, 'utf-8').trim().split('\n').filter(Boolean);
const total    = rawLines.length;

// Default sample indices spread across the full dataset
const indices = options.indices.length > 0
  ? options.indices
  : [
      0,
      Math.floor(total * 0.1),
      Math.floor(total * 0.3),
      Math.floor(total * 0.6),
      Math.floor(total * 0.9),
    ];

// ── 1. STATS RUN — scan all decisions ─────────────────────────────────────────
console.log('═'.repeat(70));
console.log(`📊 BODY-START DETECTION STATS — ${dept} (${total} decisions)`);
console.log('═'.repeat(70));

let detected = 0;
const undetected: UndetectedEntry[] = [];

rawLines.forEach((line, i) => {
  const d = JSON.parse(line) as IProcessedAct;
  const allLines = (d.actPlainText || '').split('\n').map(normalizeInlineSpaces);
  const strict   = allLines.findIndex(l => l.length > 0 && isBodyStart(l));
  const loose    = allLines.findIndex(l => l.length > 0 && isBodyStartLoose(l));
  if (strict !== -1 || loose !== -1) {
    detected++;
  } else {
    undetected.push({ i, id: d.actId, len: d.actPlainText?.length });
  }
});

console.log(`✅ Body start detected:   ${detected} / ${total}`);
console.log(`⚠️  Body start NOT found: ${total - detected} / ${total}`);

if (undetected.length > 0) {
  console.log(`\nFirst 5 undetected decisions (check manually):`);
  undetected.slice(0, 5).forEach(({ i, id, len }) => {
    console.log(`  [${i}] actId=${id}  len=${len}`);
  });
}

// ── 2. DETAILED OUTPUT — sample decisions ─────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log(`🔍 DETAILED OUTPUT — sample indices: [${indices.join(', ')}]`);
console.log('═'.repeat(70));

indices.forEach((idx) => {
  if (idx >= rawLines.length) {
    console.log(`\n⚠️  Index ${idx} is out of range (total: ${total})`);
    return;
  }

  const d = JSON.parse(rawLines[idx]) as IProcessedAct;
  const { headerText, bodyText, bodyIdx, titleIdx } = restructure(d.actPlainText || '');
  const bodyChunks = bodyText.split('\n\n').filter((c) => c.trim());
  const bodyLineCount = bodyText.split('\n').filter((l) => l.trim()).length;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Decision [${idx}/${total - 1}]  actId=${d.actId}  len=${d.actPlainText?.length}`);
  console.log(`  actNumber=${d.actNumber}  actDate=${d.actDate}  dept=${d.department}`);
  console.log(`  titleIdx=${titleIdx}  bodyIdx=${bodyIdx}`);
  console.log(`  Header blocks: ${headerText.split('\n\n').filter(Boolean).length}`);
  console.log(`  Body lines: ${bodyLineCount}  paragraphs: ${bodyChunks.length}`);

  console.log(`\n── HEADER ──`);
  console.log(headerText);

  console.log(`\n── BODY (first 5 paragraphs) ──`);
  bodyChunks.slice(0, 5).forEach((chunk, i) => {
    const preview = chunk.substring(0, 200).replace(/\n/g, '↵');
    console.log(`  [P${i + 1}] (${chunk.length} chars) ${preview}${chunk.length > 200 ? '…' : ''}`);
  });

  console.log(`\n── BODY (last 3 paragraphs) ──`);
  bodyChunks.slice(-3).forEach((chunk, i) => {
    const preview = chunk.substring(0, 200).replace(/\n/g, '↵');
    console.log(`  [P${bodyChunks.length - 2 + i}] (${chunk.length} chars) ${preview}${chunk.length > 200 ? '…' : ''}`);
  });
});

console.log('\n' + '═'.repeat(70));
console.log('✅ Done. Things to verify in the output above:');
console.log('   • Is "В ИМЕТО НА НАРОДА" on its own block in every header?');
console.log('   • Does bodyIdx point to the correct first reasoning paragraph?');
console.log('   • Are ПРЕДСЕДАТЕЛ/ЧЛЕНОВЕ lines grouped with no blank lines between them?');
console.log('   • Are body paragraphs separated by blank lines as expected?');
console.log('═'.repeat(70));
