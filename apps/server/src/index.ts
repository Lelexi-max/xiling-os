import { createApp } from "./app.js";

const port = Number.parseInt(process.env.XILING_PORT ?? "4317", 10);
const host = process.env.XILING_HOST ?? "127.0.0.1";

const app = createApp();
await app.listen({ port, host });

const stop = async () => {
  await app.close();
  process.exitCode = 0;
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
