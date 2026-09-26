import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  // GitHub project sites live below the repository name. Keep dev at /.
  base: command === "build" || isPreview ? "/particle-pipeline/" : "/",
}));
