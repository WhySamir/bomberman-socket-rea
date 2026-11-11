import { defineConfig } from "vite";

export default defineConfig({
  // Expose backend config to the client without the usual `VITE_` prefix.
  envPrefix: ["VITE_", "BACKEND_"],
});
