import { defineConfig } from "vite";

/** A separate site from the exam room, so the hook can open it on its own port. */
export default defineConfig({
  server: { port: 5174, strictPort: true, proxy: { "/v1": "http://127.0.0.1:4317" } },
});
