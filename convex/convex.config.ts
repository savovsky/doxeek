import { defineApp } from "convex/server";
import rag from "@convex-dev/rag/convex.config.js"; // .js extension required

const app = defineApp();
app.use(rag);
// NOTE: workpool is a peer dep of RAG — registered internally. Do NOT add app.use(workpool).

export default app;
