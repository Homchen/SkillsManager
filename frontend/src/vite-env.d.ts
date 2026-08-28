/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISABLE_NATIVE_CONTEXT_MENU?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
