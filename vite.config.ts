import { defineConfig } from "vite";

// `vite build` bundles the web page into dist/web; `vite build --ssr server/bin.ts` bundles the
// server and its dependencies into the single file dist/gbi.js (node:* modules stay external).
export default defineConfig(({ isSsrBuild }) =>
  isSsrBuild
    ? {
        ssr: { noExternal: true },
        build: {
          outDir: "dist",
          emptyOutDir: false,
          rollupOptions: {
            output: { entryFileNames: "gbi.js", banner: "#!/usr/bin/env node" },
          },
        },
      }
    : { root: "web", build: { outDir: "../dist/web", emptyOutDir: true } },
);
