import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const CHUNK_RELOAD_KEY_PREFIX = "bloomjoy:chunk-reload:";

type LazyRouteModule<TComponent extends ComponentType> = {
  default: TComponent;
};

const chunkLoadPatterns = [
  /ChunkLoadError/i,
  /Loading chunk .+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /dynamically imported module/i,
  /Failed to load module script/i,
  /Importing a module script failed/i,
  /module script/i,
];

const neverResolve = <TValue>() => new Promise<TValue>(() => undefined);

const normalizeErrorText = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error);
};

const hashString = (value: string) => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
};

export const getChunkLoadFailureId = (error: unknown) => {
  const errorText = normalizeErrorText(error);

  if (!chunkLoadPatterns.some((pattern) => pattern.test(errorText))) {
    return null;
  }

  const assetUrl = errorText.match(/(?:https?:\/\/[^"'()\s]+)?\/assets\/[^"'()\s]+\.js/i)?.[0];
  const source = assetUrl ?? errorText;
  const normalized = source
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .trim()
    .toLowerCase();

  return hashString(normalized);
};

export const isChunkLoadError = (error: unknown) => getChunkLoadFailureId(error) !== null;

const getSessionStorage = () => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const shouldAttemptReload = (failureId: string) => {
  const storage = getSessionStorage();

  if (!storage) {
    return false;
  }

  const key = `${CHUNK_RELOAD_KEY_PREFIX}${failureId}`;

  if (storage.getItem(key)) {
    return false;
  }

  storage.setItem(key, String(Date.now()));
  return true;
};

export const clearChunkReloadMarkers = () => {
  const storage = getSessionStorage();

  if (!storage) {
    return;
  }

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);

    if (key?.startsWith(CHUNK_RELOAD_KEY_PREFIX)) {
      storage.removeItem(key);
    }
  }
};

export const lazyRoute = <TComponent extends ComponentType>(
  importer: () => Promise<LazyRouteModule<TComponent>>,
): LazyExoticComponent<TComponent> =>
  lazy(() =>
    importer().catch((error: unknown) => {
      const failureId = getChunkLoadFailureId(error);

      if (failureId && shouldAttemptReload(failureId)) {
        window.location.reload();
        return neverResolve<LazyRouteModule<TComponent>>();
      }

      throw error;
    }),
  );
