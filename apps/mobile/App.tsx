import * as SecureStore from "expo-secure-store";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:3180";
const SESSION_KEY = "zettaz-crew-session";
const requestKey = () =>
  `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
type Passenger = {
  id: string;
  name: string;
  category: string;
  is_minor: boolean;
  checkin_state: string | null;
};
type Guest = {
  booking_id: string;
  lead_name: string;
  party_size: number;
  pickup: { kind?: string };
  checkin_state: string;
  passengers: Passenger[];
};
type Trip = {
  id: string;
  starts_at: string;
  product_name: string;
  assignment_roles: string[];
  guests: Guest[];
};
type ScannedPassenger = {
  passengerId: string;
  name: string;
  category: string;
};

async function call<T>(path: string, token?: string, init: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data?.detail?.message ?? data?.detail ?? "Request failed");
  return data as T;
}

function Button({
  children,
  disabled,
  onPress,
  quiet = false,
}: {
  children: string;
  disabled?: boolean;
  onPress: () => void;
  quiet?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        quiet && styles.quiet,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, quiet && styles.quietText]}>
        {children}
      </Text>
    </Pressable>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [active, setActive] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<ScannedPassenger | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    SecureStore.getItemAsync(SESSION_KEY)
      .then(setToken)
      .finally(() => setReady(true));
  }, []);
  async function load(session = token) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<{ trips: Trip[] }>("/crew/v1/today", session);
      setTrips(result.trips);
      if (active)
        setActive(result.trips.find((trip) => trip.id === active.id) ?? null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (token) void load(token);
  }, [token]);
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const result = await call<{ token: string }>(
        "/auth/v1/sign-in",
        undefined,
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      await SecureStore.setItemAsync(SESSION_KEY, result.token);
      setToken(result.token);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, body: unknown) {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await call(path, token, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey() },
        body: JSON.stringify(body),
      });
      await load(token);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }
  async function signOut() {
    if (token)
      try {
        await call("/auth/v1/sign-out", token, { method: "POST" });
      } catch {}
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setToken(null);
    setTrips([]);
    setActive(null);
  }
  async function scanToken(value: string) {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<ScannedPassenger>(
        "/staff/v1/crew/checkin-token/resolve",
        token,
        {
          method: "POST",
          headers: { "Idempotency-Key": requestKey() },
          body: JSON.stringify({ token: value }),
        },
      );
      setScanned(result);
      setScanning(false);
    } catch (reason) {
      setError((reason as Error).message);
      setScanning(false);
    } finally {
      setBusy(false);
    }
  }
  async function openScanner() {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission();
    if (!permission.granted) {
      setError("Camera permission is required to scan a check-in code.");
      return;
    }
    setScanned(null);
    setScanning(true);
  }

  if (!ready)
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  if (!token)
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.login}>
          <Text style={styles.brand}>ZETTAZ</Text>
          <Text style={styles.title}>Crew sign in</Text>
          <Text style={styles.muted}>Use your assigned staff account.</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Work email"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoComplete="current-password"
            secureTextEntry
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            disabled={busy || !email || !password}
            onPress={() => void signIn()}
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </View>
      </SafeAreaView>
    );
  if (scanning)
    return (
      <SafeAreaView style={styles.scannerScreen}>
        <StatusBar style="light" />
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => void scanToken(data)}
        />
        <View style={styles.scannerOverlay}>
          <Text style={styles.scannerTitle}>Scan passenger check-in code</Text>
          <Text style={styles.scannerHelp}>
            No image is saved. Only the opaque code is sent to the server.
          </Text>
          <Button quiet onPress={() => setScanning(false)}>
            Cancel
          </Button>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>CONNECTED CREW</Text>
          <Text style={styles.title}>
            {active ? active.product_name : "Today"}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Button quiet onPress={() => void openScanner()}>
            Scan
          </Button>
          <Button quiet onPress={() => void signOut()}>
            Sign out
          </Button>
        </View>
      </View>
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={undefined}
      >
        {scanned ? (
          <View style={styles.scanResult}>
            <View style={styles.grow}>
              <Text style={styles.cardTitle}>{scanned.name}</Text>
              <Text style={styles.muted}>
                {scanned.category} · code verified
              </Text>
            </View>
            <Button
              disabled={busy}
              onPress={() => {
                void mutate(
                  `/staff/v1/passengers/${scanned.passengerId}/checkin`,
                  { state: "arrived" },
                );
                setScanned(null);
              }}
            >
              Arrived
            </Button>
          </View>
        ) : null}
        {busy && !trips.length ? (
          <ActivityIndicator />
        ) : active ? (
          <>
            <Button quiet onPress={() => setActive(null)}>
              Back to trips
            </Button>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {new Date(active.starts_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
              <Text style={styles.muted}>
                {active.assignment_roles.join(" · ")}
              </Text>
              <View style={styles.actions}>
                {["preparing", "boarding", "departed", "completed"].map(
                  (state) => (
                    <Button
                      key={state}
                      disabled={busy}
                      onPress={() =>
                        void mutate(`/crew/v1/departures/${active.id}/events`, {
                          state,
                        })
                      }
                    >
                      {state.replace("_", " ")}
                    </Button>
                  ),
                )}
              </View>
            </View>
            <Text style={styles.section}>GUESTS</Text>
            {active.guests.map((guest) => (
              <View style={styles.card} key={guest.booking_id}>
                <Text style={styles.cardTitle}>{guest.lead_name}</Text>
                <Text style={styles.muted}>
                  {guest.party_size} guests · pickup{" "}
                  {guest.pickup.kind ?? "none"}
                </Text>
                {guest.passengers.map((passenger) => (
                  <View style={styles.person} key={passenger.id}>
                    <View style={styles.grow}>
                      <Text style={styles.personName}>{passenger.name}</Text>
                      <Text style={styles.muted}>
                        {passenger.category}
                        {passenger.is_minor ? " · minor" : ""} ·{" "}
                        {passenger.checkin_state ?? "not arrived"}
                      </Text>
                    </View>
                    {!["boarded", "no_show"].includes(
                      passenger.checkin_state ?? "",
                    ) ? (
                      <Button
                        disabled={busy}
                        onPress={() =>
                          void mutate(
                            `/staff/v1/passengers/${passenger.id}/checkin`,
                            {
                              state:
                                passenger.checkin_state === "arrived"
                                  ? "cleared_to_board"
                                  : passenger.checkin_state ===
                                      "cleared_to_board"
                                    ? "boarded"
                                    : "arrived",
                            },
                          )
                        }
                      >
                        {passenger.checkin_state === "arrived"
                          ? "Clear"
                          : passenger.checkin_state === "cleared_to_board"
                            ? "Board"
                            : "Arrived"}
                      </Button>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
          </>
        ) : (
          <>
            {!trips.length ? (
              <View style={styles.empty}>
                <Text style={styles.cardTitle}>No assigned trips today</Text>
                <Text style={styles.muted}>
                  Pull to refresh after dispatch assigns a trip.
                </Text>
              </View>
            ) : (
              trips.map((trip) => (
                <Pressable
                  style={styles.card}
                  key={trip.id}
                  onPress={() => setActive(trip)}
                >
                  <Text style={styles.cardTitle}>{trip.product_name}</Text>
                  <Text style={styles.muted}>
                    {new Date(trip.starts_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {trip.assignment_roles.join(" · ")}
                  </Text>
                  <Text style={styles.link}>
                    {trip.guests.reduce(
                      (sum, item) => sum + item.party_size,
                      0,
                    )}{" "}
                    guests →
                  </Text>
                </Pressable>
              ))
            )}
            <Button quiet disabled={busy} onPress={() => void load()}>
              Refresh
            </Button>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f3f7f6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  login: { flex: 1, justifyContent: "center", padding: 28, gap: 14 },
  header: {
    backgroundColor: "white",
    borderBottomColor: "#dce7e4",
    borderBottomWidth: 1,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: { flexDirection: "row", gap: 8 },
  content: { padding: 18, gap: 12 },
  brand: {
    color: "#087b72",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 4,
  },
  eyebrow: {
    color: "#087b72",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  title: { color: "#17353a", fontSize: 28, fontWeight: "800" },
  section: {
    color: "#607477",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: 10,
  },
  muted: { color: "#667b7f", lineHeight: 20 },
  input: {
    backgroundColor: "white",
    borderColor: "#cbdad7",
    borderRadius: 12,
    borderWidth: 1,
    color: "#17353a",
    fontSize: 16,
    padding: 15,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#087b72",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  quiet: { backgroundColor: "#e7f2f0" },
  disabled: { opacity: 0.5 },
  buttonText: {
    color: "white",
    fontWeight: "700",
    textTransform: "capitalize",
  },
  quietText: { color: "#075f59" },
  error: { color: "#b42318" },
  errorBanner: { backgroundColor: "#fee4e2", color: "#b42318", padding: 12 },
  card: {
    backgroundColor: "white",
    borderColor: "#dce7e4",
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  cardTitle: { color: "#17353a", fontSize: 18, fontWeight: "800" },
  link: { color: "#087b72", fontWeight: "700", marginTop: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  person: {
    borderTopColor: "#e5eeec",
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
  },
  personName: { color: "#17353a", fontWeight: "700" },
  grow: { flex: 1 },
  empty: { alignItems: "center", gap: 6, paddingVertical: 64 },
  scannerScreen: { flex: 1, backgroundColor: "#061f23" },
  camera: { flex: 1 },
  scannerOverlay: {
    backgroundColor: "#061f23",
    gap: 10,
    padding: 24,
  },
  scannerTitle: { color: "white", fontSize: 20, fontWeight: "800" },
  scannerHelp: { color: "#b9d0d2", lineHeight: 20 },
  scanResult: {
    alignItems: "center",
    backgroundColor: "#e7f6f1",
    borderColor: "#75c7b4",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
});
