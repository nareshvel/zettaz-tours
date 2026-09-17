import * as SecureStore from "expo-secure-store";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { call, crewLoadMessage, isUnauthorized, requestKey } from "./src/api";
import { APP_VERSION, SESSION_KEY, SUPPORT_EMAIL, WEB } from "./src/config";
import {
  allAboardLabel,
  attributionPassenger,
  clearanceLabel,
  formatMoney,
  guestMatchesQuery,
  paymentMethodLabel,
  pickupLabel,
  stayLabel,
  suggestedBoardingShare,
  tripStarted,
  TABLET_MIN_WIDTH,
  type BoardItem,
  type BoardPayload,
  type Guest,
  type Passenger,
  type Trip,
  type WalkUpQuote,
} from "./src/field";
import {
  DayBoard,
  tenantDay,
  WalkUpSheet,
  WeatherSheet,
  sharePickupText,
} from "./src/tablet";
type WaiverTemplate = {
  id: string;
  version: number;
  title: string;
  body: string;
};
type Signing = { guest: Guest; passenger: Passenger };
type ScannedPassenger = {
  passengerId: string;
  name: string;
  category: string;
};
type Profile = {
  actorName: string;
  actorEmail: string;
  actorPhone: string | null;
  role: string;
  permissions?: string[];
  tenant: { name: string; timezone?: string };
};

function roleLabel(role: string) {
  return role.replace(/_/g, " ");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || "?").toUpperCase();
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
  const { width } = useWindowDimensions();
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
  const [recovering, setRecovering] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [rosterQuery, setRosterQuery] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [startReason, setStartReason] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>(["cash"]);
  const [collectionCurrency, setCollectionCurrency] = useState<string | null>(
    null,
  );
  const [paying, setPaying] = useState<{
    guest: Guest;
    passenger?: Passenger;
  } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payNote, setPayNote] = useState("");
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [dock, setDock] = useState<"trips" | "board">("trips");
  const [fromBoard, setFromBoard] = useState(false);
  const [weatherItem, setWeatherItem] = useState<BoardItem | null>(null);
  const [walkUpItem, setWalkUpItem] = useState<BoardItem | null>(null);
  const [walkUpHeld, setWalkUpHeld] = useState<{
    bookingId: string;
    quote: WalkUpQuote;
  } | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(SESSION_KEY)
      .then(setToken)
      .finally(() => setReady(true));
  }, []);
  async function clearSession() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setToken(null);
    setTrips([]);
    setActive(null);
    setProfile(null);
    setMenuOpen(false);
    setShowProfile(false);
    setPaying(null);
    setBoard(null);
    setDock("trips");
    setFromBoard(false);
    setWeatherItem(null);
    setWalkUpItem(null);
    setWalkUpHeld(null);
  }
  async function loadProfile(session: string) {
    try {
      const me = await call<Profile>("/staff/v1/workspace/session", session);
      setProfile(me);
      return me;
    } catch {
      return null;
    }
  }
  async function load(session = token) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const me = await loadProfile(session);
      const canBoard = me?.permissions?.includes("manifest.read");
      try {
        const result = await call<{
          trips: Trip[];
          waiverTemplate: WaiverTemplate | null;
          paymentMethods?: string[];
          collectionCurrency?: string | null;
        }>("/crew/v1/today", session);
        setTrips(result.trips);
        setWaiverTemplate(result.waiverTemplate);
        setPaymentMethods(
          (result.paymentMethods ?? []).filter(Boolean).length
            ? (result.paymentMethods ?? [])
            : ["cash"],
        );
        setCollectionCurrency(result.collectionCurrency ?? null);
        if (active)
          setActive(result.trips.find((trip) => trip.id === active.id) ?? null);
        else setStartOpen(false);
      } catch (reason) {
        if (isUnauthorized(reason)) throw reason;
        setTrips([]);
        if (!canBoard) throw reason;
      }
      if (canBoard) {
        const day = tenantDay(me?.tenant.timezone);
        const result = await call<BoardPayload>(
          `/crew/v1/board?date=${day}`,
          session,
        );
        setBoard(result);
        if (result.paymentMethods?.length)
          setPaymentMethods(result.paymentMethods);
        if (result.collectionCurrency !== undefined)
          setCollectionCurrency(result.collectionCurrency ?? null);
        if (fromBoard && active) {
          const trip = await call<Trip>(
            `/crew/v1/board/${active.id}`,
            session,
          );
          setActive(trip);
        }
      }
    } catch (reason) {
      if (isUnauthorized(reason)) await clearSession();
      else setError(crewLoadMessage(reason));
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
      const result = await call<{ token?: string }>(
        "/auth/v1/sign-in",
        undefined,
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      if (!result.token)
        throw new Error("Sign-in did not return a session. Try again.");
      await SecureStore.setItemAsync(SESSION_KEY, result.token);
      setToken(result.token);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function requestRecovery() {
    setBusy(true);
    setError("");
    try {
      await call("/auth/v1/password-recovery/request", undefined, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setRecoverySent(true);
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
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
      setBusy(false);
    }
  }
  async function openBoarding(item: BoardItem) {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const trip = await call<Trip>(`/crew/v1/board/${item.id}`, token);
      setActive(trip);
      setFromBoard(true);
      setWeatherItem(null);
      setWalkUpItem(null);
      setWalkUpHeld(null);
    } catch (reason) {
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveWeather(
    item: BoardItem,
    status: "open" | "weather_hold" | "closed",
    reason: string,
  ) {
    await mutate(`/crew/v1/departures/${item.id}/operational-status`, {
      version: item.operational_version,
      status,
      reason,
    });
    setWeatherItem(null);
  }
  async function createWalkUp(input: {
    adults: number;
    leadName: string;
    leadEmail: string;
  }) {
    if (!token || !walkUpItem) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<{
        bookingId: string;
        state: string;
        needsPayment?: boolean;
        quote?: WalkUpQuote;
      }>("/crew/v1/walk-ups", token, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey() },
        body: JSON.stringify({
          departureId: walkUpItem.id,
          party: { adult: input.adults },
          leadName: input.leadName,
          leadEmail: input.leadEmail,
        }),
      });
      if (result.needsPayment && result.quote) {
        setWalkUpHeld({ bookingId: result.bookingId, quote: result.quote });
      } else {
        setWalkUpItem(null);
        setWalkUpHeld(null);
        await load(token);
      }
    } catch (reason) {
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function payWalkUp(input: { method: string; amountMinor: number }) {
    if (!token || !walkUpHeld) return;
    setBusy(true);
    setError("");
    try {
      await call("/crew/v1/walk-ups", token, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey() },
        body: JSON.stringify({
          bookingId: walkUpHeld.bookingId,
          payment: {
            amountMinor: input.amountMinor,
            currency: walkUpHeld.quote.currency,
            method: input.method,
            status: "settled",
            occurredAt: new Date().toISOString(),
            reason: "Walk-up collection",
          },
        }),
      });
      setWalkUpItem(null);
      setWalkUpHeld(null);
      await load(token);
    } catch (reason) {
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sharePickup(item: BoardItem) {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const list = await call<{
        departure: { product_name: string; starts_at: string };
        stops: {
          sequence: number;
          pickup_at: string;
          location_name: string;
          lead_name: string;
          party_size: number;
          notes?: string | null;
        }[];
        exceptions: {
          lead_name: string;
          pickup_kind: string;
          party_size: number;
        }[];
      }>(`/crew/v1/departures/${item.id}/pickup-list`, token);
      const lines = [
        `${list.departure.product_name} pickup list`,
        new Date(list.departure.starts_at).toLocaleString(),
        "",
        ...list.stops.map(
          (stop) =>
            `${stop.sequence}. ${stop.location_name} · ${new Date(stop.pickup_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${stop.lead_name} (${stop.party_size})${stop.notes ? ` · ${stop.notes}` : ""}`,
        ),
        ...list.exceptions.map(
          (row) => `Gap · ${row.lead_name} · ${row.pickup_kind} · ${row.party_size}`,
        ),
      ];
      if (board?.capabilities.print) {
        await call("/crew/v1/print-jobs", token, {
          method: "POST",
          headers: { "Idempotency-Key": requestKey() },
          body: JSON.stringify({
            documentType: "pickup_list",
            sourceId: item.id,
          }),
        });
      }
      await sharePickupText(item.product_name, lines.filter(Boolean).join("\n"));
    } catch (reason) {
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (token)
      try {
        await call("/auth/v1/sign-out", token, { method: "POST" });
      } catch {}
    await clearSession();
  }
  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }
  function openWeb(path: string) {
    void Linking.openURL(`${WEB}${path}`);
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
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
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
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
      setScanning(false);
    } finally {
      setBusy(false);
    }
  }
  async function startAssignedTrip() {
    if (!active || !token) return;
    const pending = active.boarding_pending ?? 0;
    if (pending > 0 && startReason.trim().length < 3) {
      setError("Add a short reason before marking remaining guests no-show.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call(`/ops/v1/departures/${active.id}/start`, token, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey() },
        body: JSON.stringify({
          markRemainingNoShow: pending > 0,
          reason:
            pending > 0 ? startReason.trim() : startReason.trim() || undefined,
        }),
      });
      setStartOpen(false);
      setStartReason("");
      await load(token);
    } catch (reason) {
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
      setBusy(false);
    }
  }
  function confirmNoShow(passenger: Passenger) {
    Alert.alert(
      "Mark no-show?",
      `${passenger.name} will be recorded as no-show on this trip.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark no-show",
          style: "destructive",
          onPress: () =>
            void mutate(`/staff/v1/passengers/${passenger.id}/checkin`, {
              state: "no_show",
            }),
        },
      ],
    );
  }
  function openPay(guest: Guest, passenger?: Passenger) {
    const attributed = attributionPassenger(guest, passenger);
    const rosterCount = Math.max(
      1,
      guest.passengers.length || guest.party_size || 1,
    );
    const balance = guest.guest_balance_minor ?? 0;
    const suggested =
      passenger && rosterCount >= 2
        ? suggestedBoardingShare(balance, rosterCount)
        : balance;
    setPaying({ guest, passenger: attributed });
    setPayAmount((suggested / 100).toFixed(2));
    setPayMethod(paymentMethods[0] ?? "cash");
    setPayReference("");
    setPayNote("");
    setError("");
  }
  async function submitPay() {
    if (!token || !paying) return;
    const amountMinor = Math.round(Number(payAmount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    if (!payMethod) {
      setError("Select a payment method.");
      return;
    }
    const attributed = paying.passenger;
    setBusy(true);
    setError("");
    try {
      await call(
        `/crew/v1/bookings/${paying.guest.booking_id}/payments`,
        token,
        {
          method: "POST",
          headers: { "Idempotency-Key": requestKey() },
          body: JSON.stringify({
            amountMinor,
            currency: paying.guest.currency ?? "USD",
            method: payMethod,
            status: "settled",
            reference: payReference.trim(),
            reason:
              payNote.trim() ||
              (attributed
                ? `Collected at boarding · ${attributed.name}`
                : "Collected at boarding"),
            occurredAt: new Date().toISOString(),
            ...(attributed ? { passengerId: attributed.id } : {}),
          }),
        },
      );
      setPaying(null);
      await load(token);
    } catch (reason) {
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
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

  const showBoard =
    width >= TABLET_MIN_WIDTH &&
    Boolean(profile?.permissions?.includes("manifest.read"));
  const header = (
    <View style={styles.header}>
      <View style={styles.grow}>
        <Text style={styles.eyebrow}>CONNECTED CREW</Text>
        <Text style={styles.title} numberOfLines={1}>
          {showProfile
            ? "My profile"
            : active
              ? active.product_name
              : showBoard && dock === "board"
                ? "Day Board"
                : "Today"}
        </Text>
      </View>
      <View style={styles.headerActions}>
        {!showProfile && (trips.length > 0 || active || scanned) ? (
          <Button quiet onPress={() => void openScanner()}>
            Scan
          </Button>
        ) : null}
        <Pressable
          accessibilityLabel="Account menu"
          onPress={() => setMenuOpen(true)}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>
            {initials(profile?.actorName ?? "")}
          </Text>
        </Pressable>
      </View>
      <Modal
        transparent
        animationType="fade"
        visible={menuOpen}
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => setMenuOpen(false)}
        >
          <View style={styles.menuSheet}>
            <Text style={styles.cardTitle}>
              {profile?.actorName ?? "Account"}
            </Text>
            <Text style={styles.muted}>{profile?.actorEmail ?? ""}</Text>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setShowProfile(true);
                setActive(null);
                setSigning(null);
                setScanning(false);
              }}
            >
              <Text style={styles.menuItemText}>My profile</Text>
            </Pressable>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                void signOut();
              }}
            >
              <Text style={styles.menuItemDanger}>Sign out</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );

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
          <Text style={styles.title}>
            {recovering ? "Reset password" : "Crew sign in"}
          </Text>
          <Text style={styles.muted}>
            {recovering
              ? "We’ll email a reset link if this address has a staff account."
              : "Use your assigned staff account. This app is for crew check-in, not public booking."}
          </Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Work email"
            value={email}
            onChangeText={setEmail}
          />
          {recovering ? (
            <>
              {recoverySent ? (
                <Text style={styles.success}>
                  If an account exists for that email, a reset link is on its
                  way. Check your inbox, then return here to sign in.
                </Text>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button
                disabled={busy || !email || recoverySent}
                onPress={() => void requestRecovery()}
              >
                {busy ? "Sending…" : "Email reset link"}
              </Button>
              <Button
                quiet
                onPress={() => {
                  setRecovering(false);
                  setRecoverySent(false);
                  setError("");
                }}
              >
                Back to sign in
              </Button>
            </>
          ) : (
            <>
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
              <Button
                quiet
                onPress={() => {
                  setRecovering(true);
                  setRecoverySent(false);
                  setError("");
                }}
              >
                Forgot password?
              </Button>
            </>
          )}
          <View style={styles.legalRow}>
            <Pressable onPress={() => openWeb("/privacy")}>
              <Text style={styles.legalLink}>Privacy</Text>
            </Pressable>
            <Text style={styles.muted}>·</Text>
            <Pressable onPress={() => openWeb("/terms")}>
              <Text style={styles.legalLink}>Terms</Text>
            </Pressable>
            <Text style={styles.muted}>·</Text>
            <Pressable
              onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            >
              <Text style={styles.legalLink}>Support</Text>
            </Pressable>
          </View>
          <Text style={styles.version}>Version {APP_VERSION}</Text>
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
  if (paying) {
    const guest = paying.guest;
    const currency = guest.currency ?? "USD";
    const balance = guest.guest_balance_minor ?? 0;
    const conversionBlocked =
      Boolean(collectionCurrency) &&
      Boolean(currency) &&
      collectionCurrency !== currency;
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text style={styles.eyebrow}>PAYMENT AT BOARDING</Text>
            <Text style={styles.cardTitle}>
              {paying.passenger?.name ?? guest.lead_name}
            </Text>
          </View>
          <Button quiet onPress={() => setPaying(null)}>
            Close
          </Button>
        </View>
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.muted}>
              Balance due {formatMoney(balance, currency)}
            </Text>
            {paying.passenger ? (
              <Text style={styles.muted}>
                Optional attribution · {paying.passenger.name}
              </Text>
            ) : null}
            {conversionBlocked ? (
              <Text style={styles.warn}>
                Record this in {currency}. Converting local cash to a different
                booking currency is not enabled yet.
              </Text>
            ) : null}
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder={`Amount · ${currency}`}
              value={payAmount}
              onChangeText={setPayAmount}
            />
            <View style={styles.actions}>
              {paymentMethods.map((method) => (
                <Pressable
                  key={method}
                  onPress={() => setPayMethod(method)}
                  style={[
                    styles.choice,
                    payMethod === method && styles.choiceSelected,
                  ]}
                >
                  <Text
                    style={
                      payMethod === method
                        ? styles.choiceTextSelected
                        : styles.choiceText
                    }
                  >
                    {paymentMethodLabel(method)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Receipt / bank reference (optional)"
              value={payReference}
              onChangeText={setPayReference}
            />
            <TextInput
              style={styles.input}
              placeholder="Collected at boarding"
              value={payNote}
              onChangeText={setPayNote}
            />
            <Button
              disabled={busy || balance <= 0 || conversionBlocked}
              onPress={() => void submitPay()}
            >
              {busy ? "Recording…" : "Record payment"}
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (showProfile) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        {header}
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>STAFF</Text>
            <Text style={styles.cardTitle}>
              {profile?.actorName ?? "Signed in"}
            </Text>
            <Text style={styles.muted}>{roleLabel(profile?.role ?? "")}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.muted}>Email</Text>
            <Text style={styles.personName}>{profile?.actorEmail ?? "—"}</Text>
            <Text style={styles.muted}>Phone</Text>
            <Text style={styles.personName}>
              {profile?.actorPhone || "Not on file"}
            </Text>
            <Text style={styles.muted}>Workspace</Text>
            <Text style={styles.personName}>{profile?.tenant.name ?? "—"}</Text>
          </View>
          <Button quiet onPress={() => setShowProfile(false)}>
            Back to today
          </Button>
          <Text style={styles.version}>Version {APP_VERSION}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }
  const visibleGuests = active
    ? active.guests.filter((guest) => guestMatchesQuery(guest, rosterQuery))
    : [];
  const cruiseAboard = active
    ? active.guests
        .map((guest) => allAboardLabel(guest.stay))
        .find((value) => value)
    : null;
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      {header}
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor="#087b72"
          />
        }
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
        {busy && !trips.length && !board?.items.length ? (
          <ActivityIndicator />
        ) : active ? (
          <>
            <Button
              quiet
              onPress={() => {
                setActive(null);
                setRosterQuery("");
                setStartOpen(false);
                setStartReason("");
                if (fromBoard) {
                  setDock("board");
                  setFromBoard(false);
                }
              }}
            >
              {fromBoard ? "Back to board" : "Back to trips"}
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
                {active.trip_run_state
                  ? ` · ${active.trip_run_state.replace(/_/g, " ")}`
                  : ""}
                {active.operational_status &&
                active.operational_status !== "open"
                  ? ` · ${active.operational_status.replace(/_/g, " ")}`
                  : ""}
              </Text>
              {cruiseAboard ? (
                <Text style={styles.muted}>All aboard {cruiseAboard}</Text>
              ) : null}
              <Text style={styles.muted}>
                {active.boarded_guests ?? 0} boarded ·{" "}
                {active.boarding_pending ?? 0} pending ·{" "}
                {active.no_show_guests ?? 0} no-show
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
              {!tripStarted(active) ? (
                startOpen ? (
                  <View style={styles.startSheet}>
                    <Text style={styles.cardTitle}>
                      {(active.boarding_pending ?? 0) > 0
                        ? "Start trip with no-shows?"
                        : "Start this trip?"}
                    </Text>
                    {(active.boarding_pending ?? 0) > 0 ? (
                      <Text style={styles.muted}>
                        {active.boarding_pending} guest
                        {active.boarding_pending === 1 ? "" : "s"} still not
                        boarded will be marked no-show. Add a reason to
                        continue.
                      </Text>
                    ) : (
                      <Text style={styles.muted}>
                        Records that this run has left. Boarding for remaining
                        guests closes.
                      </Text>
                    )}
                    {(active.boarding_pending ?? 0) > 0 ? (
                      <TextInput
                        style={styles.input}
                        placeholder="Reason (required)"
                        value={startReason}
                        onChangeText={setStartReason}
                      />
                    ) : null}
                    <Button
                      disabled={busy}
                      onPress={() => void startAssignedTrip()}
                    >
                      {busy
                        ? "Starting…"
                        : (active.boarding_pending ?? 0) > 0
                          ? "Mark no-show & start"
                          : "Start trip"}
                    </Button>
                    <Button quiet onPress={() => setStartOpen(false)}>
                      Cancel
                    </Button>
                  </View>
                ) : (
                  <Button quiet onPress={() => setStartOpen(true)}>
                    Start trip
                  </Button>
                )
              ) : (
                <Text style={styles.muted}>
                  Trip started
                  {active.trip_run_state
                    ? ` · ${active.trip_run_state.replace(/_/g, " ")}`
                    : ""}
                </Text>
              )}
            </View>
            {active.pickup_stops?.length || active.pickup_exceptions?.length ? (
              <View style={styles.card}>
                <Text style={styles.section}>PICKUPS</Text>
                {(active.pickup_stops ?? []).map((stop) => (
                  <View key={`${stop.booking_id}-${stop.sequence}`}>
                    <Text style={styles.personName}>
                      {stop.sequence}. {stop.location_name}
                    </Text>
                    <Text style={styles.muted}>
                      {new Date(stop.pickup_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {stop.lead_name} · {stop.party_size} guests
                      {stop.notes ? ` · ${stop.notes}` : ""}
                    </Text>
                  </View>
                ))}
                {(active.pickup_exceptions ?? []).map((item) => (
                  <Text key={item.booking_id} style={styles.warn}>
                    {item.lead_name}: {pickupLabel(item.pickup_kind)}
                  </Text>
                ))}
              </View>
            ) : null}
            <Text style={styles.section}>GUESTS</Text>
            <TextInput
              style={styles.input}
              placeholder="Search guests, stay, or pickup"
              value={rosterQuery}
              onChangeText={setRosterQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!visibleGuests.length ? (
              <Text style={styles.muted}>
                {rosterQuery.trim()
                  ? "No guests match that search."
                  : "No confirmed guests on this trip."}
              </Text>
            ) : (
              visibleGuests.map((guest) => {
                const aboard = allAboardLabel(guest.stay);
                return (
                  <View style={styles.card} key={guest.booking_id}>
                    <Text style={styles.cardTitle}>{guest.lead_name}</Text>
                    <Text
                      style={
                        guest.boarding_clearance === "due"
                          ? styles.warn
                          : styles.muted
                      }
                    >
                      {clearanceLabel(guest)}
                    </Text>
                    <Text style={styles.muted}>
                      {guest.party_size} guests ·{" "}
                      {pickupLabel(guest.pickup?.kind)}
                      {guest.pickup?.location
                        ? ` · ${guest.pickup.location}`
                        : ""}
                    </Text>
                    <Text style={styles.muted}>
                      {stayLabel(guest.stay)}
                      {aboard ? ` · all aboard ${aboard}` : ""}
                    </Text>
                    {guest.boarding_clearance === "due" ? (
                      <Button disabled={busy} onPress={() => openPay(guest)}>
                        Pay
                      </Button>
                    ) : null}
                    {guest.passengers.map((passenger) => (
                      <Pressable
                        style={styles.person}
                        key={passenger.id}
                        onPress={() => openWaiver(guest, passenger)}
                      >
                        <View style={styles.grow}>
                          <Text style={styles.personName}>
                            {passenger.identity_pending
                              ? "Guest name required"
                              : passenger.name}
                          </Text>
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
                          <View style={styles.rowActions}>
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
                            <Button
                              quiet
                              disabled={busy}
                              onPress={() => confirmNoShow(passenger)}
                            >
                              No-show
                            </Button>
                            {guest.boarding_clearance === "due" ? (
                              <Button
                                quiet
                                disabled={busy}
                                onPress={() => openPay(guest, passenger)}
                              >
                                Pay
                              </Button>
                            ) : null}
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                );
              })
            )}
          </>
        ) : (
          <>
            {showBoard ? (
              <View style={styles.dock}>
                <Pressable
                  onPress={() => {
                    setDock("trips");
                    setWeatherItem(null);
                    setWalkUpItem(null);
                    setWalkUpHeld(null);
                  }}
                  style={[
                    styles.dockTab,
                    dock === "trips" && styles.dockTabActive,
                  ]}
                >
                  <Text
                    style={
                      dock === "trips"
                        ? styles.dockTabTextActive
                        : styles.dockTabText
                    }
                  >
                    My trips
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setDock("board")}
                  style={[
                    styles.dockTab,
                    dock === "board" && styles.dockTabActive,
                  ]}
                >
                  <Text
                    style={
                      dock === "board"
                        ? styles.dockTabTextActive
                        : styles.dockTabText
                    }
                  >
                    Day Board
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {showBoard && dock === "board" ? (
              weatherItem ? (
                <WeatherSheet
                  item={weatherItem}
                  busy={busy}
                  onClose={() => setWeatherItem(null)}
                  onSave={(status, reason) =>
                    void saveWeather(weatherItem, status, reason)
                  }
                />
              ) : walkUpItem ? (
                <WalkUpSheet
                  item={walkUpItem}
                  busy={busy}
                  methods={paymentMethods}
                  held={walkUpHeld}
                  error={error}
                  onClose={() => {
                    setWalkUpItem(null);
                    setWalkUpHeld(null);
                  }}
                  onCreate={(input) => void createWalkUp(input)}
                  onPay={(input) => void payWalkUp(input)}
                />
              ) : (
                <DayBoard
                  board={
                    board ?? {
                      date: tenantDay(profile?.tenant.timezone),
                      capabilities: {
                        walkUp: Boolean(
                          profile?.permissions?.includes("bookings.write"),
                        ),
                        weather: Boolean(
                          profile?.permissions?.includes("operations.write"),
                        ),
                        print: Boolean(
                          profile?.permissions?.includes("print.jobs.create"),
                        ),
                        checkin: Boolean(
                          profile?.permissions?.includes("checkin.write"),
                        ),
                      },
                      items: [],
                    }
                  }
                  busy={busy}
                  onOpen={(item) => void openBoarding(item)}
                  onWalkUp={(item) => {
                    setWalkUpHeld(null);
                    setWalkUpItem(item);
                  }}
                  onWeather={setWeatherItem}
                  onShare={(item) => void sharePickup(item)}
                  onRefresh={() => void load()}
                />
              )
            ) : !trips.length ? (
              <View style={styles.empty}>
                <Text style={styles.cardTitle}>No assigned trips today</Text>
                <Text style={styles.muted}>
                  Only departures you are assigned to as crew appear here.
                  Assign this person under Team & resources, or sign in as that
                  guide or driver.
                </Text>
              </View>
            ) : (
              trips.map((trip) => {
                const due = trip.guests.filter(
                  (guest) => guest.boarding_clearance === "due",
                ).length;
                return (
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
                      {trip.trip_run_state
                        ? ` · ${trip.trip_run_state.replace(/_/g, " ")}`
                        : ""}
                    </Text>
                    <Text style={styles.muted}>
                      {trip.guests.reduce(
                        (sum, item) => sum + item.party_size,
                        0,
                      )}{" "}
                      guests
                      {due ? ` · ${due} balance due` : ""}
                      {(trip.pickup_exceptions?.length ?? 0) > 0
                        ? ` · ${trip.pickup_exceptions?.length} pickup gaps`
                        : ""}
                    </Text>
                    <Text style={styles.link}>Open trip →</Text>
                  </Pressable>
                );
              })
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
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  avatar: {
    alignItems: "center",
    backgroundColor: "#087b72",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  avatarText: { color: "white", fontSize: 16, fontWeight: "800" },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(23,53,58,0.28)",
    alignItems: "flex-end",
    paddingTop: 88,
    paddingRight: 16,
  },
  menuSheet: {
    backgroundColor: "white",
    borderRadius: 16,
    gap: 6,
    minWidth: 220,
    padding: 16,
  },
  menuItem: { paddingVertical: 12 },
  menuItemText: { color: "#17353a", fontSize: 16, fontWeight: "700" },
  menuItemDanger: { color: "#b42318", fontSize: 16, fontWeight: "700" },
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
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  startSheet: { gap: 10, marginTop: 8 },
  warn: { color: "#b42318", fontWeight: "700", lineHeight: 20 },
  empty: { alignItems: "center", gap: 6, paddingVertical: 64 },
  dock: { flexDirection: "row", gap: 8 },
  dockTab: {
    backgroundColor: "white",
    borderColor: "#dce7e4",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  dockTabActive: { backgroundColor: "#087b72", borderColor: "#087b72" },
  dockTabText: { color: "#17353a", fontWeight: "700" },
  dockTabTextActive: { color: "white", fontWeight: "700" },
  success: { color: "#087b72", lineHeight: 20 },
  legalRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 12,
    alignItems: "center",
  },
  legalLink: { color: "#087b72", fontWeight: "700" },
  version: { color: "#8aa0a4", fontSize: 12, textAlign: "center" },
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
