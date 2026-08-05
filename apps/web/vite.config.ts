import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@mdx-js/rollup";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import rehypeSlug from "rehype-slug";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend =
    env.REMOTE_API_URL ||
    `http://localhost:${env.BACKEND_PORT || env.API_PORT || env.SERVER_PORT || "8080"}`;
  const docs = env.DOCS_URL || "http://localhost:4000";

  return {
    plugins: [
      mdx({
        remarkPlugins: [
          remarkFrontmatter,
          [remarkMdxFrontmatter, { name: "frontmatter" }],
        ],
        rehypePlugins: [rehypeSlug],
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      proxy: {
        "/api": { target: backend, changeOrigin: true },
        "/auth": { target: backend, changeOrigin: true },
        "/uploads": { target: backend, changeOrigin: true },
        "/ws": { target: backend, ws: true, changeOrigin: true },
        "/docs": { target: docs, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
