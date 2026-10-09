import { z } from "zod";
import { pool, migrate } from "./db/index.js";
import { createApp } from "./app.js";
import { runJobs } from "./jobs.js";
const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DB_HOST: z.string().min(1),
    DB_NAME: z.string().min(1),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    APP_URL: z.string().url(),
  })
  .parse(process.env);
await migrate();
const app = createApp(async () => {
  await pool.query("SELECT 1");
});
const server = app.listen(env.PORT, "0.0.0.0", () =>
  console.log(`AulaNexo disponible en puerto ${env.PORT}`),
);
void runJobs();
const jobs = setInterval(() => void runJobs(), 60000).unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    clearInterval(jobs);
    const timer = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(timer);
      process.exit(0);
    });
  });
