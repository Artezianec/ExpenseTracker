import { ApexStreamAuth } from '@apexstream/client';

export const apexConfig = {
  controlPlaneUrl:
    import.meta.env.VITE_APEXSTREAM_CONTROL_PLANE_URL ?? 'http://localhost:8080',
  wsUrl: import.meta.env.VITE_APEXSTREAM_WS_URL ?? 'ws://localhost:8081/v1/ws',
  /** Read/subscribe key (pk_live_…) for gateway + Document DB reads. */
  apiKey: import.meta.env.VITE_APEXSTREAM_API_KEY ?? '',
  /**
   * Optional write key (sk_live_…) for Document DB mutations from the browser.
   * Prefer a backend with sk_live_ in production; see apexstream/examples/document-db.
   */
  secretKey: import.meta.env.VITE_APEXSTREAM_SECRET_KEY ?? '',
  appId: import.meta.env.VITE_APEXSTREAM_APP_ID ?? '',
  publishableKey: import.meta.env.VITE_APEXSTREAM_PUBLISHABLE_KEY ?? '',
  channel: import.meta.env.VITE_APEXSTREAM_CHANNEL ?? 'budgeted:live',
};

/** Bearer token for Document DB HTTP (user JWT when signed in, else secret/api key). */
export function resolveDbApiKey(accessToken?: string | null): string {
  if (accessToken) return accessToken;
  if (apexConfig.secretKey) return apexConfig.secretKey;
  return apexConfig.apiKey;
}

export const apexAuthConfigured =
  Boolean(apexConfig.appId) && Boolean(apexConfig.publishableKey);

export const apexWsConfigured = Boolean(apexConfig.wsUrl);

export function getAllowInsecureTransport(wsUrl: string): boolean {
  return (
    wsUrl.startsWith('ws://') ||
    import.meta.env.VITE_APEXSTREAM_ALLOW_INSECURE === '1' ||
    import.meta.env.VITE_APEXSTREAM_ALLOW_INSECURE === 'true'
  );
}

export const apexAuth = new ApexStreamAuth({
  controlPlaneUrl: apexConfig.controlPlaneUrl,
  appId: apexConfig.appId,
  publishableKey: apexConfig.publishableKey,
});
