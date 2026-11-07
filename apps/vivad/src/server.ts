import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.VIVA_PORT ?? 4317);
serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`vivad listening on http://127.0.0.1:${port}`);
});
