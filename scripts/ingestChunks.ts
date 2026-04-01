/**
 * ingestChunks.ts
 * Reads the chunks JSONL file and POSTs batches to the Convex HTTP ingest endpoint.
 *
 * Usage:
 *   npx tsx scripts/ingestChunks.ts \
 *     --input   <path-to-chunks.jsonl>         (required)
 *     --url     <convex-http-url>               (default: VITE_CONVEX_URL from .env.local)
 *     --namespace <string>                      (default: "vks-commercial")
 *     --batch-size <n>                          (default: 25)
 *     --limit   <n>                             (optional — process first N chunks, for testing)
 *     --dry-run                                 (parse + validate, no HTTP calls)
 */
import * as fs from "fs";
import * as rl from "readline";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env.local to pick up VITE_CONVEX_URL
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// ── CLI args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

const inputPath = flag("--input");
const namespace = flag("--namespace") ?? "vks-commercial";
const batchSize = parseInt(flag("--batch-size") ?? "25", 10);
const limit     = parseInt(flag("--limit") ?? "0", 10);
const skip      = parseInt(flag("--skip") ?? "0", 10);   // skip first N chunks (for resuming)
const dryRun    = argv.includes("--dry-run");

// Resolve Convex HTTP (site) URL — HTTP actions are served at .convex.site, not .convex.cloud
const rawUrl    = flag("--url") ?? process.env.VITE_CONVEX_SITE_URL ?? process.env.VITE_CONVEX_URL ?? "";
const convexUrl = rawUrl.replace(/\/api$/, ""); // strip trailing /api if present

if (!inputPath) {
  console.error("Error: --input <path> is required.");
  process.exit(1);
}
if (!dryRun && !convexUrl) {
  console.error(
    "Error: Convex URL not found. Pass --url or set VITE_CONVEX_URL in .env.local"
  );
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChunkMetadata {
  actId:       string;
  actNumber:   string;
  actDate:     string;
  actTitle:    string;
  actUrl:      string;
  caseNumber:  string;
  caseYear:    string;
  department:  string;
  chunkIndex:  number;
  // sectionType REMOVED in S9
}
interface Chunk {
  text:     string;
  metadata: ChunkMetadata;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const s   = Math.floor(ms / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

async function postBatch(chunks: Chunk[]): Promise<{ ingested: number }> {
  const res = await fetch(`${convexUrl}/ingest-batch`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ namespace, chunks }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ ingested: number }>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Input      : ${inputPath}`);
  console.log(`Namespace  : ${namespace}`);
  console.log(`Batch size : ${batchSize}`);
  console.log(`URL        : ${dryRun ? "(dry-run)" : convexUrl}`);
  if (limit > 0) console.log(`Limit      : first ${limit} chunks`);
  if (skip  > 0) console.log(`Skip       : first ${skip} chunks`);
  console.log("");

  if (!fs.existsSync(inputPath!)) {
    console.error(`Error: file not found: ${inputPath}`);
    process.exit(1);
  }

  const lineReader = rl.createInterface({
    input:     fs.createReadStream(inputPath!, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let totalChunks   = 0;
  let totalIngested = 0;
  let totalFailed   = 0;
  let batchNum      = 0;
  let batch: Chunk[] = [];
  const startTime   = Date.now();

  const flushBatch = async () => {
    if (batch.length === 0) return;
    batchNum++;
    if (dryRun) {
      totalIngested += batch.length;
    } else {
      try {
        const result = await postBatch(batch);
        totalIngested += result.ingested;
        process.stdout.write(
          `\r[batch ${String(batchNum).padStart(5)}]  chunks ingested: ${String(totalIngested).padStart(6)}  elapsed: ${formatTime(Date.now() - startTime)}`
        );
      } catch (err) {
        totalFailed += batch.length;
        console.error(`\nBatch ${batchNum} failed: ${err}`);
      }
    }
    batch = [];
  };

  for await (const line of lineReader) {
    if (!line.trim()) continue;
    if (limit > 0 && totalChunks >= limit) break;

    let chunk: Chunk;
    try {
      chunk = JSON.parse(line) as Chunk;
    } catch {
      console.warn(`Warning: skipping unparseable line ${totalChunks + 1}`);
      continue;
    }

    totalChunks++;
    if (totalChunks <= skip) continue;   // skip already-ingested chunks

    batch.push(chunk);

    if (batch.length >= batchSize) {
      await flushBatch();
    }
  }

  await flushBatch(); // flush remainder

  const elapsed = Date.now() - startTime;
  console.log(`\n\n${"═".repeat(52)}`);
  console.log("INGEST COMPLETE");
  console.log(`${"═".repeat(52)}`);
  console.log(`Chunks processed : ${totalChunks.toLocaleString()}`);
  console.log(`Ingested         : ${totalIngested.toLocaleString()}`);
  if (totalFailed > 0) console.log(`Failed           : ${totalFailed}`);
  console.log(`Batches          : ${batchNum}`);
  console.log(`Duration         : ${formatTime(elapsed)}`);
  console.log(`Est. cost        : ~$${(totalIngested * 0.000006).toFixed(4)}`);
  console.log(`${"═".repeat(52)}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
