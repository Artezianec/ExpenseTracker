import { ApexStreamAuth } from '@apexstream/client';

export const apexConfig = {
  controlPlaneUrl:
    import.meta.env.VITE_APEXSTREAM_CONTROL_PLANE_URL ?? 'http://localhost:8080',
  wsUrl: import.meta.env.VITE_APEXSTREAM_WS_URL ?? 'ws://localhost:8081/v1/ws',
  apiKey: import.meta.env.VITE_APEXSTREAM_API_KEY ?? '',
  appId: import.meta.env.VITE_APEXSTREAM_APP_ID ?? '',
  publishableKey: import.meta.env.VITE_APEXSTREAM_PUBLISHABLE_KEY ?? '',
  channel: import.meta.env.VITE_APEXSTREAM_CHANNEL ?? 'budgeted:live',
};

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
