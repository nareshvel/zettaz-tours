import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as
  { apiBaseUrl?: string; webOrigin?: string } | undefined;

function trimSlash(value: string) {
  return value.replace(/\/$/, "");
}

const productionApi = "https://tours.zettaz.com/api/mobile";
const productionWeb = "https://tours.zettaz.com";

function packagerHost() {
  const candidates = [
    Constants.expoConfig?.hostUri,
    (
      Constants as { expoGoConfig?: { debuggerHost?: string } }
    ).expoGoConfig?.debuggerHost,
  ];
  for (const value of candidates) {
    if (!value) continue;
    try {
      if (/^https?:\/\//i.test(value)) return new URL(value).hostname;
    } catch {
      /* hostUri is host:port, not a URL */
    }
    const host = value.split(":")[0]?.trim();
    if (host) return host === "localhost" ? "127.0.0.1" : host;
  }
  return "127.0.0.1";
}

export const API = trimSlash(
  process.env.EXPO_PUBLIC_API_BASE_URL ||
    (__DEV__
      ? `http://${packagerHost()}:3190`
      : extra?.apiBaseUrl || productionApi),
);

export const WEB = trimSlash(
  process.env.EXPO_PUBLIC_WEB_ORIGIN ?? extra?.webOrigin ?? productionWeb,
);

export const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
export const SUPPORT_EMAIL = "support@zettaz.com";
export const SESSION_KEY = "zettaz-crew-session";
