/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APEXSTREAM_WS_URL: string;
  readonly VITE_APEXSTREAM_API_KEY: string;
  readonly VITE_APEXSTREAM_CONTROL_PLANE_URL: string;
  readonly VITE_APEXSTREAM_APP_ID: string;
  readonly VITE_APEXSTREAM_PUBLISHABLE_KEY: string;
  readonly VITE_APEXSTREAM_CHANNEL: string;
  readonly VITE_APEXSTREAM_ALLOW_INSECURE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
