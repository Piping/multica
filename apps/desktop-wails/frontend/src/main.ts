import "@fontsource-variable/inter";
import "@fontsource-variable/inter/wght-italic.css";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/geist-mono";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  installWailsBridge,
  reportWailsStartupError,
} from "./wails-bridge";

async function start(): Promise<void> {
  await installWailsBridge();
  const { App } = await import("./app");
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing Wails renderer root");
  createRoot(root).render(createElement(App));
}

void start().catch((error: unknown) => {
  const message = formatError(error);
  reportWailsStartupError(message);
  console.error("Wails renderer startup failed", error);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `
      <main style="height:100%;display:grid;place-items:center;padding:32px;font-family:system-ui,sans-serif">
        <section style="max-width:680px">
          <h1 style="font-size:20px;margin:0 0 12px">Multica could not start</h1>
          <pre style="white-space:pre-wrap;background:#f3f4f6;padding:16px;border-radius:6px">${escapeHTML(message)}</pre>
        </section>
      </main>`;
  }
});

function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.stack || error.message;
}
