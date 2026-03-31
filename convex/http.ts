import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { auth } from './auth';

const http = httpRouter();

auth.addHttpRoutes(http);

// POST /ingest-batch
// Body: { namespace: string, chunks: Chunk[] }
// Called only by scripts/ingestChunks.ts during one-time data load.
// NOTE: /api prefix is reserved by Convex — use /ingest-batch instead.
http.route({
  path:   "/ingest-batch",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await req.json() as { namespace: string; chunks: any[] };
    const result = await ctx.runAction(internal.vksIngest.ingestBatch, body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
