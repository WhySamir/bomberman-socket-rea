/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute URL of the Socket.IO backend, e.g. https://bomberman-socket-rea.onrender.com */
  readonly BACKEND_URL?: string;
  /** Legacy alias for BACKEND_URL. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
