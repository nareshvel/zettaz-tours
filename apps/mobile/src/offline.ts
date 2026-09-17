import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import nacl from "tweetnacl";
import { ApiError, call, requestKey } from "./api";
import type { Trip } from "./field";

const CLIENT_ID = "zettaz-crew-client-id";
const DEVICE_ID = "zettaz-crew-device-id";
const DEVICE_SECRET = "zettaz-crew-device-secret";
const BOX_KEY = "zettaz-crew-box-key";
const PIN_HASH = "zettaz-crew-pin-hash";
const PIN_SALT = "zettaz-crew-pin-salt";
const LAST_SYNC = "zettaz-crew-last-sync";

export type OfflineCommandKind =
  "checkin" | "trip_event" | "waiver" | "payment";
export type QueueStatus = "queued" | "synced" | "quarantine";
export type QueuedCommand = {
  id: string;
  kind: OfflineCommandKind;
  payload: Record<string, unknown>;
  occurredAt: string;
  status: QueueStatus;
  lastError: string | null;
};
export type OfflineSnapshot = {
  trips: Trip[];
  waiverTemplate: unknown;
  paymentMethods?: string[];
  collectionCurrency?: string | null;
  downloadedAt: string;
  leaseExpiresAt: string;
  leaseHours: number;
};

function b64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}
function fromB64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

nacl.setPRNG((target, n) => {
  const bytes = Crypto.getRandomBytes(n);
  for (let i = 0; i < n; i += 1) target[i] = bytes[i]!;
});

async function boxKey() {
  const existing = await SecureStore.getItemAsync(BOX_KEY);
  if (existing) return fromB64(existing);
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  await SecureStore.setItemAsync(BOX_KEY, b64(key));
  return key;
}

async function seal(value: unknown) {
  const key = await boxKey();
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const message = new TextEncoder().encode(JSON.stringify(value));
  const boxed = nacl.secretbox(message, nonce, key);
  return `${b64(nonce)}:${b64(boxed)}`;
}

async function openBox(cipher: string) {
  const [noncePart, bodyPart] = cipher.split(":");
  if (!noncePart || !bodyPart) return null;
  const key = await boxKey();
  const opened = nacl.secretbox.open(
    fromB64(bodyPart),
    fromB64(noncePart),
    key,
  );
  if (!opened) return null;
  return JSON.parse(new TextDecoder().decode(opened));
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function database() {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync("zettaz-crew-offline.db");
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL,
        last_error TEXT
      );
    `);
    return db;
  })();
  return dbPromise;
}

export async function clientDeviceId() {
  const existing = await SecureStore.getItemAsync(CLIENT_ID);
  if (existing) return existing;
  const uuid = crypto.randomUUID();
  await SecureStore.setItemAsync(CLIENT_ID, uuid);
  return uuid;
}

export async function hasPin() {
  return Boolean(await SecureStore.getItemAsync(PIN_HASH));
}

export async function setPin(pin: string) {
  const salt = b64(nacl.randomBytes(16));
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
  );
  await SecureStore.setItemAsync(PIN_SALT, salt);
  await SecureStore.setItemAsync(PIN_HASH, hash);
}

export async function verifyPin(pin: string) {
  const salt = await SecureStore.getItemAsync(PIN_SALT);
  const expected = await SecureStore.getItemAsync(PIN_HASH);
  if (!salt || !expected) return false;
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
  );
  return hash === expected;
}

export async function biometricAvailable() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  return hasHardware ? LocalAuthentication.isEnrolledAsync() : false;
}

export async function unlockWithBiometrics() {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Zettaz Crew",
    cancelLabel: "Use PIN",
    disableDeviceFallback: false,
  });
  return result.success;
}

export async function deviceCredentials() {
  const id = await SecureStore.getItemAsync(DEVICE_ID);
  const secret = await SecureStore.getItemAsync(DEVICE_SECRET);
  if (!id || !secret) return null;
  return { id, secret };
}

function deviceHeaders(id: string, secret: string) {
  return {
    "X-Crew-Device-Id": id,
    "X-Crew-Device-Secret": secret,
  };
}

export async function enrollDevice(token: string) {
  const enrolled = await call<{
    deviceId: string;
    secret: string;
    leaseHours: number;
  }>("/crew/v1/devices", token, {
    method: "POST",
    body: JSON.stringify({
      clientDeviceId: await clientDeviceId(),
      name: Platform.OS === "ios" ? "iPhone" : "Android",
      platform: Platform.OS === "ios" ? "ios" : "android",
    }),
  });
  await SecureStore.setItemAsync(DEVICE_ID, enrolled.deviceId);
  await SecureStore.setItemAsync(DEVICE_SECRET, enrolled.secret);
  return enrolled;
}

export async function downloadSnapshot(token: string, date?: string) {
  const device = await deviceCredentials();
  if (!device) throw new Error("Enroll this device before going offline.");
  const path = date
    ? `/crew/v1/offline/snapshot?date=${date}`
    : "/crew/v1/offline/snapshot";
  const snapshot = await call<OfflineSnapshot>(path, token, {
    headers: deviceHeaders(device.id, device.secret),
  });
  const db = await database();
  await db.runAsync(
    "INSERT OR REPLACE INTO kv(k,v) VALUES('snapshot', ?)",
    await seal(snapshot),
  );
  return snapshot;
}

export async function readSnapshot(): Promise<OfflineSnapshot | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ v: string }>(
    "SELECT v FROM kv WHERE k='snapshot'",
  );
  if (!row) return null;
  return (await openBox(row.v)) as OfflineSnapshot | null;
}

export async function enqueue(
  kind: OfflineCommandKind,
  payload: Record<string, unknown>,
) {
  const db = await database();
  const id = crypto.randomUUID();
  const occurredAt = new Date().toISOString();
  await db.runAsync(
    "INSERT INTO commands(id,kind,payload,occurred_at,status,last_error) VALUES(?,?,?,?,?,NULL)",
    id,
    kind,
    await seal(payload),
    occurredAt,
    "queued",
  );
  return {
    id,
    kind,
    payload,
    occurredAt,
    status: "queued" as const,
    lastError: null,
  };
}

export async function listCommands() {
  const db = await database();
  const rows = await db.getAllAsync<{
    id: string;
    kind: OfflineCommandKind;
    payload: string;
    occurred_at: string;
    status: QueueStatus;
    last_error: string | null;
  }>(
    "SELECT id,kind,payload,occurred_at,status,last_error FROM commands ORDER BY occurred_at",
  );
  const items: QueuedCommand[] = [];
  for (const row of rows) {
    items.push({
      id: row.id,
      kind: row.kind,
      payload: ((await openBox(row.payload)) as Record<string, unknown>) ?? {},
      occurredAt: row.occurred_at,
      status: row.status,
      lastError: row.last_error,
    });
  }
  return items;
}

export async function queuedCount() {
  const db = await database();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM commands WHERE status IN ('queued','quarantine')",
  );
  return row?.n ?? 0;
}

export async function discardQuarantined(id: string) {
  const db = await database();
  await db.runAsync(
    "DELETE FROM commands WHERE id=? AND status='quarantine'",
    id,
  );
}

export async function syncQueue(token: string) {
  const device = await deviceCredentials();
  if (!device) throw new Error("Enroll this device before going offline.");
  const pending = (await listCommands()).filter(
    (item) => item.status === "queued" || item.status === "quarantine",
  );
  if (!pending.length) {
    await downloadSnapshot(token);
    await purgeExpired();
    await SecureStore.setItemAsync(LAST_SYNC, new Date().toISOString());
    return { synced: 0, failed: 0 };
  }
  const headers = deviceHeaders(device.id, device.secret);
  const response = await call<{
    results: Array<{
      clientCommandId: string;
      status: string;
      reason?: string | null;
    }>;
  }>("/crew/v1/offline/commands", token, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": requestKey() },
    body: JSON.stringify({
      commands: pending.map((item) => ({
        clientCommandId: item.id,
        kind: item.kind,
        occurredAt: item.occurredAt,
        payload: item.payload,
      })),
    }),
  });
  const db = await database();
  let synced = 0;
  let failed = 0;
  for (const result of response.results) {
    if (result.status === "accepted" || result.status === "duplicate") {
      await db.runAsync(
        "UPDATE commands SET status='synced', last_error=NULL WHERE id=?",
        result.clientCommandId,
      );
      synced += 1;
    } else {
      await db.runAsync(
        "UPDATE commands SET status='quarantine', last_error=? WHERE id=?",
        result.reason ?? "Rejected by server",
        result.clientCommandId,
      );
      failed += 1;
    }
  }
  await downloadSnapshot(token);
  await purgeExpired();
  await SecureStore.setItemAsync(LAST_SYNC, new Date().toISOString());
  return { synced, failed };
}

export async function purgeExpired() {
  const pending = await queuedCount();
  if (pending > 0) return;
  const snapshot = await readSnapshot();
  if (!snapshot) return;
  const leaseEnd = new Date(snapshot.leaseExpiresAt).getTime();
  const downloaded = new Date(snapshot.downloadedAt).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now <= leaseEnd && now - downloaded <= sevenDays) return;
  const db = await database();
  await db.runAsync("DELETE FROM kv WHERE k='snapshot'");
  await db.runAsync("DELETE FROM commands WHERE status='synced'");
}

export async function lastSyncAt() {
  return SecureStore.getItemAsync(LAST_SYNC);
}

export async function wipeOffline() {
  try {
    const db = await database();
    await db.execAsync("DELETE FROM kv; DELETE FROM commands;");
  } catch {
    /* empty db is still a wipe */
  }
  await SecureStore.deleteItemAsync(DEVICE_ID);
  await SecureStore.deleteItemAsync(DEVICE_SECRET);
  await SecureStore.deleteItemAsync(BOX_KEY);
  await SecureStore.deleteItemAsync(PIN_HASH);
  await SecureStore.deleteItemAsync(PIN_SALT);
  await SecureStore.deleteItemAsync(LAST_SYNC);
  dbPromise = null;
}

export function isOfflineError(reason: unknown) {
  return (
    reason instanceof ApiError && (reason.status === 0 || reason.status === 503)
  );
}

export function isRevoked(reason: unknown) {
  return reason instanceof ApiError && reason.status === 410;
}

export async function prepareOffline(token: string, pin: string) {
  await setPin(pin);
  await enrollDevice(token);
  await downloadSnapshot(token);
}
