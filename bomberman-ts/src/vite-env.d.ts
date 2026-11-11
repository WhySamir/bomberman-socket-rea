/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute URL of the Socket.IO backend. Defaults to same-origin. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
