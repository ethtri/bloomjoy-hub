import { Writable } from "node:stream";
import type { ReactElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { AppProviders, AppShell } from "./App";

const PRERENDER_TIMEOUT_MS = 30000;

const renderElementToString = (element: ReactElement): Promise<string> =>
  new Promise((resolve, reject) => {
    let html = "";
    let settled = false;
    const streamRef: { current?: ReturnType<typeof renderToPipeableStream> } = {};

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      streamRef.current?.abort();
      reject(new Error(`Static prerender timed out after ${PRERENDER_TIMEOUT_MS}ms`));
    }, PRERENDER_TIMEOUT_MS);

    const writable = new Writable({
      write(chunk, _encoding, callback) {
        html += chunk.toString();
        callback();
      },
    });

    writable.on("finish", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(html);
    });

    writable.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    });

    streamRef.current = renderToPipeableStream(element, {
      onAllReady() {
        streamRef.current?.pipe(writable);
      },
      onShellError(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      },
      onError(error) {
        console.error("Prerender recoverable error:", error);
      },
    });
  });

export const renderRoute = (pathname: string) =>
  renderElementToString(
    <AppProviders queryClient={new QueryClient()}>
      <StaticRouter location={pathname}>
        <AppShell />
      </StaticRouter>
    </AppProviders>
  );
