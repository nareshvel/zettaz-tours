import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as
  { apiBaseUrl?: string; webOrigin?: string } | undefined;

function trimSlash(value: string) {
  return value.replace(/\/$/, "");
}

const productionApi = "https://tours.zettaz.com/api/mobile";
const productionWeb = "https://tours.zettaz.com";

export const API = trimSlash(
  process.env.EXPO_PUBLIC_API_BASE_URL ||
    (__DEV__ ? "http://127.0.0.1:3190" : extra?.apiBaseUrl || productionApi),
);

export const WEB = trimSlash(
  process.env.EXPO_PUBLIC_WEB_ORIGIN ?? extra?.webOrigin ?? productionWeb,
);

export const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
export const SUPPORT_EMAIL = "support@zettaz.com";
export const SESSION_KEY = "zettaz-crew-session";
