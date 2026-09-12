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
  "http://127.0.0.1:3190";
const SESSION_KEY = "zettaz-crew-session";
const requestKey = () =>
  `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
type Passenger = {
  id: string;
  name: string;
  category: string;
  is_minor: boolean;
  identity_pending: boolean;
  checkin_state: string | null;
  waiver_signed: boolean;
};
type Guest = {
  booking_id: string;
  lead_name: string;
  party_size: number;
  pickup: { kind?: string };
  stay: Record<string, string>;
  checkin_state: string;
  passengers: Passenger[];
};
type WaiverTemplate = {
  id: string;
  version: number;
  title: string;
  body: string;
};
type Signing = { guest: Guest; passenger: Passenger };
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
  const [waiverTemplate, setWaiverTemplate] = useState<WaiverTemplate | null>(
    null,
  );
  const [signing, setSigning] = useState<Signing | null>(null);
  const [stayKind, setStayKind] = useState("none");
  const [stayName, setStayName] = useState("");
  const [stayUnit, setStayUnit] = useState("");
  const [stayAddress, setStayAddress] = useState("");
  const [signerName, setSignerName] = useState("");
  const [passengerName, setPassengerName] = useState("");
  const [guardianId, setGuardianId] = useState("");
  const [signaturePoints, setSignaturePoints] = useState<
    { x: number; y: number }[]
  >([]);
  const [padSize, setPadSize] = useState({ width: 1, height: 1 });

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
      const result = await call<{
        trips: Trip[];
        waiverTemplate: WaiverTemplate | null;
      }>("/crew/v1/today", session);
      setTrips(result.trips);
      setWaiverTemplate(result.waiverTemplate);
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
  function openWaiver(guest: Guest, passenger: Passenger) {
    setSigning({ guest, passenger });
    setStayKind(guest.stay?.kind ?? "none");
    setStayName(
      guest.stay?.vesselName ??
        guest.stay?.hotelName ??
        guest.stay?.propertyName ??
        "",
    );
    setStayUnit(guest.stay?.cabinNumber ?? guest.stay?.roomNumber ?? "");
    setStayAddress(guest.stay?.address ?? "");
    setPassengerName(passenger.identity_pending ? "" : passenger.name);
    setSignerName(
      passenger.is_minor || passenger.identity_pending ? "" : passenger.name,
    );
    setGuardianId("");
    setSignaturePoints([]);
  }
  async function submitWaiver() {
    if (!token || !signing || !waiverTemplate) return;
    const stay =
      stayKind === "cruise"
        ? { kind: "cruise", vesselName: stayName, cabinNumber: stayUnit }
        : stayKind === "hotel"
          ? { kind: "hotel", hotelName: stayName, roomNumber: stayUnit }
          : stayKind === "private_accommodation"
            ? {
                kind: "private_accommodation",
                propertyName: stayName,
                address: stayAddress,
              }
            : stayKind === "local"
              ? { kind: "local", address: stayAddress }
              : { kind: "none" };
    setBusy(true);
    setError("");
    try {
      await call(`/ops/v1/passengers/${signing.passenger.id}/waiver`, token, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey() },
        body: JSON.stringify({
          passengerName: signing.passenger.identity_pending
            ? passengerName
            : undefined,
          signerName,
          guardianPassengerId: guardianId || undefined,
          consentAccepted: true,
          signatureStrokes: signaturePoints,
          capturedAt: new Date().toISOString(),
          deviceCommandId: requestKey(),
          stay,
        }),
      });
      setSigning(null);
      await load(token);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
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
  if (signing) {
    const adults = signing.guest.passengers.filter(
      (person) => !person.is_minor,
    );
    const needsName = !signerName.trim();
    const needsPassengerName =
      signing.passenger.identity_pending && !passengerName.trim();
    const needsStayName =
      ["cruise", "hotel", "private_accommodation"].includes(stayKind) &&
      !stayName.trim();
    const needsAddress =
      stayKind === "private_accommodation" && !stayAddress.trim();
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text style={styles.eyebrow}>PASSENGER WAIVER</Text>
            <Text style={styles.cardTitle}>
              {signing.passenger.identity_pending
                ? "Guest name required"
                : signing.passenger.name}
            </Text>
          </View>
          <Button quiet onPress={() => setSigning(null)}>
            Close
          </Button>
        </View>
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
        <ScrollView contentContainerStyle={styles.content}>
          {signing.passenger.identity_pending ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Guest identity</Text>
              <Text style={styles.muted}>
                Enter the guest’s full name before collecting this waiver.
              </Text>
              <TextInput
                style={styles.input}
                autoCapitalize="words"
                placeholder="Guest full name"
                value={passengerName}
                onChangeText={(value) => {
                  setPassengerName(value);
                  if (!signing.passenger.is_minor) setSignerName(value);
                }}
              />
            </View>
          ) : null}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Stay and pickup details</Text>
            <Text style={styles.muted}>
              Select where this guest is staying. Unit numbers are optional.
            </Text>
            <View style={styles.actions}>
              {(
                [
                  ["none", "None"],
                  ["cruise", "Vessel"],
                  ["hotel", "Hotel"],
                  ["private_accommodation", "Airbnb / private"],
                  ["local", "Local"],
                ] as const
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  onPress={() => setStayKind(value)}
                  style={[
                    styles.choice,
                    stayKind === value && styles.choiceSelected,
                  ]}
                >
                  <Text
                    style={
                      stayKind === value
                        ? styles.choiceTextSelected
                        : styles.choiceText
                    }
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {["cruise", "hotel", "private_accommodation"].includes(stayKind) ? (
              <TextInput
                style={styles.input}
                placeholder={
                  stayKind === "cruise"
                    ? "Vessel name"
                    : stayKind === "hotel"
                      ? "Hotel name"
                      : "Property name"
                }
                value={stayName}
                onChangeText={setStayName}
              />
            ) : null}
            {["cruise", "hotel"].includes(stayKind) ? (
              <TextInput
                style={styles.input}
                placeholder={
                  stayKind === "cruise"
                    ? "Cabin number (optional)"
                    : "Room number (optional)"
                }
                value={stayUnit}
                onChangeText={setStayUnit}
              />
            ) : null}
            {["private_accommodation", "local"].includes(stayKind) ? (
              <TextInput
                style={styles.input}
                placeholder={
                  stayKind === "local"
                    ? "Local address (optional)"
                    : "Property address"
                }
                value={stayAddress}
                onChangeText={setStayAddress}
              />
            ) : null}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {waiverTemplate?.title ?? "Waiver unavailable"}
            </Text>
            <Text style={styles.waiverBody}>
              {waiverTemplate?.body ??
                "An active waiver template must be published before signing."}
            </Text>
          </View>
          {signing.passenger.is_minor ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Adult guardian</Text>
              {adults.map((person) => (
                <Pressable
                  key={person.id}
                  onPress={() => {
                    setGuardianId(person.id);
                    setSignerName(person.name);
                  }}
                  style={[
                    styles.choice,
                    guardianId === person.id && styles.choiceSelected,
                  ]}
                >
                  <Text
                    style={
                      guardianId === person.id
                        ? styles.choiceTextSelected
                        : styles.choiceText
                    }
                  >
                    {person.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Signer</Text>
            <TextInput
              style={styles.input}
              placeholder="Full legal name"
              value={signerName}
              onChangeText={setSignerName}
            />
            <Text style={styles.muted}>
              I have read and agree to the waiver shown above.
            </Text>
            <View
              style={styles.signaturePad}
              onLayout={(event) => setPadSize(event.nativeEvent.layout)}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(event) => {
                const { locationX, locationY } = event.nativeEvent;
                setSignaturePoints([
                  {
                    x: locationX / padSize.width,
                    y: locationY / padSize.height,
                  },
                ]);
              }}
              onResponderMove={(event) => {
                const { locationX, locationY } = event.nativeEvent;
                setSignaturePoints((current) =>
                  current.length >= 5000
                    ? current
                    : [
                        ...current,
                        {
                          x: Math.max(
                            0,
                            Math.min(1, locationX / padSize.width),
                          ),
                          y: Math.max(
                            0,
                            Math.min(1, locationY / padSize.height),
                          ),
                        },
                      ],
                );
              }}
            >
              {!signaturePoints.length ? (
                <Text style={styles.signatureHint}>
                  Sign here with your finger
                </Text>
              ) : (
                signaturePoints.map((point, index) => (
                  <View
                    key={index}
                    style={[
                      styles.signaturePoint,
                      {
                        left: point.x * padSize.width - 2,
                        top: point.y * padSize.height - 2,
                      },
                    ]}
                  />
                ))
              )}
            </View>
            <Button quiet onPress={() => setSignaturePoints([])}>
              Clear signature
            </Button>
            <Button
              disabled={
                busy ||
                !waiverTemplate ||
                needsName ||
                needsPassengerName ||
                needsStayName ||
                needsAddress ||
                (signing.passenger.is_minor && !guardianId) ||
                signaturePoints.length < 8
              }
              onPress={() => void submitWaiver()}
            >
              {busy ? "Saving…" : "Accept and save waiver"}
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
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
                  <Pressable
                    style={styles.person}
                    key={passenger.id}
                    onPress={() => openWaiver(guest, passenger)}
                  >
                    <View style={styles.grow}>
                      <Text style={styles.personName}>{passenger.name}</Text>
                      <Text style={styles.muted}>
                        {passenger.category}
                        {passenger.is_minor ? " · minor" : ""} ·{" "}
                        {passenger.checkin_state ?? "not arrived"} ·{" "}
                        {passenger.waiver_signed
                          ? "waiver signed"
                          : "waiver required"}
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
                  </Pressable>
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
  choice: {
    borderColor: "#cbdad7",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  choiceSelected: { backgroundColor: "#087b72", borderColor: "#087b72" },
  choiceText: { color: "#17353a", fontWeight: "600" },
  choiceTextSelected: { color: "white", fontWeight: "700" },
  waiverBody: { color: "#17353a", fontSize: 16, lineHeight: 25 },
  signaturePad: {
    alignItems: "center",
    backgroundColor: "#fbfdfc",
    borderColor: "#9fb7b3",
    borderRadius: 12,
    borderStyle: "dashed",
    borderWidth: 1,
    height: 180,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  signatureHint: { color: "#7a8d90" },
  signaturePoint: {
    backgroundColor: "#17353a",
    borderRadius: 2,
    height: 4,
    position: "absolute",
    width: 4,
  },
});
