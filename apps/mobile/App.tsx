import * as SecureStore from "expo-secure-store";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
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
  biometricAvailable,
  discardQuarantined,
  enqueue,
  ensureOfflineReady,
  hasPin,
  isOfflineError,
  isRevoked,
  lastSyncAt,
  listCommands,
  prepareOffline,
  queuedCount,
  readSnapshot,
  syncQueue,
  unlockWithBiometrics,
  verifyPin,
  wipeOffline,
  deviceCredentials,
  type OfflineCommandKind,
  type QueuedCommand,
} from "./src/offline";
import {
  allAboardLabel,
  assignedToPickups,
  attributionPassenger,
  checkinLabel,
  clearanceLabel,
  formatMoney,
  guestMatchesQuery,
  nextPassengerAction,
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
import {
  OptionSheet,
  SignatureInk,
  TabBar,
  TodayStrip,
  TripCard,
  TripTimer,
  stayChoiceLabel,
  stayChoices,
  todayRoleHint,
  tripStatusChoices,
  tripStatusLabel,
  type TabId,
} from "./src/chrome";
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
  const [locked, setLocked] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [pinValue, setPinValue] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [offlineSetup, setOfflineSetup] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueItems, setQueueItems] = useState<QueuedCommand[]>([]);
  const [canBiometric, setCanBiometric] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [leaseExpiresAt, setLeaseExpiresAt] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const signingRef = useRef(false);
  tokenRef.current = token;
  signingRef.current = Boolean(signing);

  useEffect(() => {
    SecureStore.getItemAsync(SESSION_KEY)
      .then(async (session) => {
        setToken(session);
        if (session && (await hasPin())) setLocked(true);
        setCanBiometric(await biometricAvailable());
      })
      .finally(() => setReady(true));
  }, []);
  async function clearSession() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setToken(null);
    setTrips([]);
    setActive(null);
    setProfile(null);
    setShowProfile(false);
    setPaying(null);
    setBoard(null);
    setDock("trips");
    setFromBoard(false);
    setWeatherItem(null);
    setWalkUpItem(null);
    setWalkUpHeld(null);
    setLocked(false);
    setOfflineMode(false);
    setQueueSize(0);
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
  async function refreshQueue() {
    setQueueSize(await queuedCount());
    setEnrolled(Boolean(await deviceCredentials()));
    const snapshot = await readSnapshot();
    setLeaseExpiresAt(snapshot?.leaseExpiresAt ?? null);
    setLastSync(await lastSyncAt());
  }
  async function applyCachedSnapshot() {
    const snapshot = await readSnapshot();
    if (!snapshot) throw new Error("No offline lease on this device yet.");
    setTrips(snapshot.trips);
    setWaiverTemplate(
      (snapshot.waiverTemplate as WaiverTemplate | null) ?? null,
    );
    if (snapshot.paymentMethods?.length)
      setPaymentMethods(snapshot.paymentMethods);
    setCollectionCurrency(snapshot.collectionCurrency ?? null);
    if (active)
      setActive(snapshot.trips.find((trip) => trip.id === active.id) ?? null);
    setOfflineMode(true);
    await refreshQueue();
  }
  async function handleDeviceFailure(reason: unknown) {
    if (isRevoked(reason)) {
      await wipeOffline();
      await clearSession();
      setError("This device was revoked. Local tenant data was wiped.");
      return true;
    }
    if (isUnauthorized(reason)) {
      await clearSession();
      return true;
    }
    return false;
  }
  async function load(session = token) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const me = await loadProfile(session);
      const canBoard = me?.permissions?.includes("manifest.read");
      try {
        if (await deviceCredentials()) {
          const pending = await queuedCount();
          if (pending) {
            const result = await syncQueue(session);
            await refreshQueue();
            if (result.failed)
              setError(
                `${result.synced} synced, ${result.failed} need review in Profile.`,
              );
          }
        }
      } catch (reason) {
        if (await handleDeviceFailure(reason)) return;
        if (!isOfflineError(reason)) throw reason;
      }
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
        if (result.waiverTemplate) setWaiverTemplate(result.waiverTemplate);
        if (fromBoard && active) {
          const trip = await call<Trip>(`/crew/v1/board/${active.id}`, session);
          setActive(trip);
        }
      }
      setOfflineMode(false);
      await refreshQueue();
      try {
        if (me?.permissions?.includes("crew.trip.read")) {
          await ensureOfflineReady(session);
          await refreshQueue();
        }
      } catch (reason) {
        if (await handleDeviceFailure(reason)) return;
      }
    } catch (reason) {
      if (await handleDeviceFailure(reason)) return;
      if (isOfflineError(reason)) {
        try {
          await applyCachedSnapshot();
          setError(
            "Working from the offline lease on this device. Queued work syncs when you reconnect.",
          );
          return;
        } catch (offlineReason) {
          setError((offlineReason as Error).message);
          return;
        }
      }
      setError(crewLoadMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (token) void load(token);
  }, [token]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && tokenRef.current && !signingRef.current)
        void load(tokenRef.current);
    });
    return () => sub.remove();
  }, []);
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
  function queueFor(path: string, body: unknown) {
    const checkin = path.match(
      /\/staff\/v1\/passengers\/([0-9a-f-]{36})\/checkin$/i,
    );
    if (checkin)
      return {
        kind: "checkin" as OfflineCommandKind,
        payload: {
          passengerId: checkin[1],
          state: (body as { state?: string }).state,
        },
      };
    const event = path.match(
      /\/crew\/v1\/departures\/([0-9a-f-]{36})\/events$/i,
    );
    if (event)
      return {
        kind: "trip_event" as OfflineCommandKind,
        payload: {
          departureId: event[1],
          ...(body as Record<string, unknown>),
        },
      };
    return null;
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
      setOfflineMode(false);
      try {
        await syncQueue(token);
      } catch {
        /* connected mutation succeeded even if leftover queue wait */
      }
      await load(token);
      await refreshQueue();
    } catch (reason) {
      if (await handleDeviceFailure(reason)) {
        setBusy(false);
        return;
      }
      if (isOfflineError(reason)) {
        const queued = queueFor(path, body);
        if (!queued) {
          setError("This action needs a connection.");
          setBusy(false);
          return;
        }
        await enqueue(queued.kind, queued.payload);
        setOfflineMode(true);
        await refreshQueue();
        setError("Saved on this device. It will sync when you reconnect.");
        setBusy(false);
        return;
      }
      setError((reason as Error).message);
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
          (row) =>
            `Gap · ${row.lead_name} · ${row.pickup_kind} · ${row.party_size}`,
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
      await sharePickupText(
        item.product_name,
        lines.filter(Boolean).join("\n"),
      );
    } catch (reason) {
      if (isUnauthorized(reason)) await clearSession();
      else setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if ((await queuedCount()) > 0) {
      setShowProfile(true);
      setQueueItems(await listCommands());
      setQueueOpen(true);
      setError(
        "Sync or discard queued work before signing out. Unsynced waivers and cash must not be dropped.",
      );
      return;
    }
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
      setOfflineMode(false);
      await load(token);
    } catch (reason) {
      if (await handleDeviceFailure(reason)) {
        setBusy(false);
        return;
      }
      if (isOfflineError(reason)) {
        await enqueue("waiver", {
          passengerId: signing.passenger.id,
          body: {
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
          },
        });
        setSigning(null);
        setOfflineMode(true);
        await refreshQueue();
        setError(
          "Waiver saved on this device. It will sync when you reconnect.",
        );
        setBusy(false);
        return;
      }
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
      setOfflineMode(false);
      await load(token);
    } catch (reason) {
      if (await handleDeviceFailure(reason)) {
        setBusy(false);
        return;
      }
      if (isOfflineError(reason)) {
        await enqueue("payment", {
          bookingId: paying.guest.booking_id,
          body: {
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
          },
        });
        setPaying(null);
        setOfflineMode(true);
        await refreshQueue();
        setError(
          "Payment saved on this device. The server balance updates after sync — do not collect twice.",
        );
        setBusy(false);
        return;
      }
      setError((reason as Error).message);
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
  const can = (code: string) => Boolean(profile?.permissions?.includes(code));
  const canPay = can("checkin.write") || can("payment.write");
  const canCheckin = can("checkin.write");
  const canEvents = can("crew.trip.read");
  const activeTab: TabId = showProfile
    ? "profile"
    : showBoard && dock === "board"
      ? "board"
      : "today";
  function goTab(tab: TabId) {
    if (tab === "scan") {
      setShowProfile(false);
      void openScanner();
      return;
    }
    setScanning(false);
    setSigning(null);
    if (tab === "profile") {
      setShowProfile(true);
      setActive(null);
      void refreshQueue();
      return;
    }
    setShowProfile(false);
    setActive(null);
    setFromBoard(false);
    setStartOpen(false);
    setRosterQuery("");
    setDock(tab === "board" ? "board" : "trips");
  }
  const footer = (
    <TabBar
      active={activeTab}
      showScan={canCheckin}
      showBoard={showBoard}
      onChange={goTab}
    />
  );
  const header = (
    <View style={styles.header}>
      <View style={styles.grow}>
        <Text style={styles.eyebrow}>
          {offlineMode ? "OFFLINE CREW" : "CONNECTED CREW"}
        </Text>
        <Text
          style={[
            styles.title,
            active && !showProfile ? styles.titleTrip : null,
          ]}
          numberOfLines={2}
        >
          {showProfile
            ? "My profile"
            : active
              ? active.product_name
              : showBoard && dock === "board"
                ? "Day Board"
                : "Today"}
        </Text>
      </View>
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
  if (locked)
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.login}>
          <Text style={styles.brand}>ZETTAZ</Text>
          <Text style={styles.title}>Unlock this device</Text>
          <Text style={styles.muted}>
            Offline field data is encrypted on this phone. Unlock with your crew
            PIN{canBiometric ? " or biometrics" : ""}.
          </Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            maxLength={8}
            placeholder="Device PIN"
            secureTextEntry
            value={pinValue}
            onChangeText={setPinValue}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            disabled={busy || pinValue.length < 4}
            onPress={() => {
              void (async () => {
                if (await verifyPin(pinValue)) {
                  setPinValue("");
                  setLocked(false);
                  setError("");
                } else setError("That PIN does not match.");
              })();
            }}
          >
            Unlock
          </Button>
          {canBiometric ? (
            <Button
              quiet
              onPress={() => {
                void (async () => {
                  if (await unlockWithBiometrics()) {
                    setLocked(false);
                    setError("");
                  }
                })();
              }}
            >
              Use biometrics
            </Button>
          ) : null}
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
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
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
              Choose where this guest is staying. Unit numbers are optional.
            </Text>
            <Pressable style={styles.select} onPress={() => setStayOpen(true)}>
              <Text style={styles.selectLabel}>Stay</Text>
              <Text style={styles.selectValue}>
                {stayChoiceLabel(stayKind)}
              </Text>
            </Pressable>
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
          </View>
        </ScrollView>
        <View style={styles.signDock}>
          <View
            style={styles.signaturePad}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onLayout={(event) => setPadSize(event.nativeEvent.layout)}
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
                        x: Math.max(0, Math.min(1, locationX / padSize.width)),
                        y: Math.max(0, Math.min(1, locationY / padSize.height)),
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
              <SignatureInk
                points={signaturePoints}
                width={padSize.width}
                height={padSize.height}
              />
            )}
          </View>
          <View style={styles.rowActions}>
            <Button quiet onPress={() => setSignaturePoints([])}>
              Clear
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
              {busy ? "Saving…" : "Accept waiver"}
            </Button>
          </View>
        </View>
        <OptionSheet
          title="Stay type"
          visible={stayOpen}
          selected={stayKind}
          options={stayChoices.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          onSelect={setStayKind}
          onClose={() => setStayOpen(false)}
        />
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
          <View style={styles.card}>
            <Text style={styles.eyebrow}>OFFLINE</Text>
            <Text style={styles.muted}>
              This phone keeps a 24-hour copy of assigned trips automatically
              while you are online. Check-in, waiver, trip events, and cash
              queue here if the signal drops, then sync when you reconnect.
              Never collect the same cash twice.
            </Text>
            {enrolled ? (
              <>
                <Text style={styles.personName}>
                  {offlineMode
                    ? "Working from the device copy"
                    : "Offline copy ready"}
                </Text>
                <Text style={styles.muted}>
                  Last synced{" "}
                  {lastSync
                    ? new Date(lastSync).toLocaleString()
                    : "just now, after sign-in"}
                </Text>
                <Text style={styles.muted}>
                  Lease{" "}
                  {leaseExpiresAt
                    ? `until ${new Date(leaseExpiresAt).toLocaleString()}`
                    : "refreshing with each online load"}
                </Text>
              </>
            ) : (
              <Text style={styles.muted}>
                Device enroll happens on the next successful online load when
                this account can read assigned trips.
              </Text>
            )}
            {offlineSetup ? (
              <>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  maxLength={8}
                  placeholder="Choose a 4–8 digit PIN"
                  secureTextEntry
                  value={pinValue}
                  onChangeText={setPinValue}
                />
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  maxLength={8}
                  placeholder="Confirm PIN"
                  secureTextEntry
                  value={pinConfirm}
                  onChangeText={setPinConfirm}
                />
                <Button
                  disabled={
                    busy || pinValue.length < 4 || pinValue !== pinConfirm
                  }
                  onPress={() => {
                    void (async () => {
                      if (!token) return;
                      setBusy(true);
                      setError("");
                      try {
                        await prepareOffline(token, pinValue);
                        setOfflineSetup(false);
                        setPinValue("");
                        setPinConfirm("");
                        await refreshQueue();
                        await load(token);
                      } catch (reason) {
                        setError((reason as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  {busy ? "Saving PIN…" : "Save PIN"}
                </Button>
              </>
            ) : (
              <Button quiet onPress={() => setOfflineSetup(true)}>
                {enrolled ? "Add or change unlock PIN" : "Add unlock PIN"}
              </Button>
            )}
            {queueSize > 0 ? (
              <Button
                quiet
                onPress={() => {
                  void (async () => {
                    setQueueItems(await listCommands());
                    setQueueOpen(true);
                  })();
                }}
              >
                {`Review queued work (${queueSize})`}
              </Button>
            ) : null}
          </View>
          {queueOpen ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Queued commands</Text>
              {queueItems
                .filter((item) => item.status !== "synced")
                .map((item) => (
                  <View key={item.id} style={styles.person}>
                    <View style={styles.grow}>
                      <Text style={styles.personName}>
                        {item.kind.replace("_", " ")} · {item.status}
                      </Text>
                      {item.lastError ? (
                        <Text style={styles.muted}>{item.lastError}</Text>
                      ) : null}
                    </View>
                    {item.status === "quarantine" ? (
                      <Button
                        quiet
                        onPress={() => {
                          void (async () => {
                            await discardQuarantined(item.id);
                            setQueueItems(await listCommands());
                            await refreshQueue();
                          })();
                        }}
                      >
                        Discard
                      </Button>
                    ) : null}
                  </View>
                ))}
              <Button quiet onPress={() => setQueueOpen(false)}>
                Hide queue
              </Button>
            </View>
          ) : null}
          <Button
            quiet
            onPress={() =>
              Alert.alert(
                "Sign out?",
                "You will need your staff email and password to sign in again.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Sign out",
                    style: "destructive",
                    onPress: () => void signOut(),
                  },
                ],
              )
            }
          >
            Sign out
          </Button>
          <Text style={styles.version}>Version {APP_VERSION}</Text>
        </ScrollView>
        {footer}
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
      {queueSize > 0 ? (
        <Text style={styles.queueBanner}>
          {queueSize} command{queueSize === 1 ? "" : "s"} waiting to sync
        </Text>
      ) : null}
      <ScrollView
        style={styles.flex}
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
            <View style={styles.card}>
              <View style={styles.timeRow}>
                <Text style={styles.tripClock}>
                  {new Date(active.starts_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <TripTimer startsAt={active.starts_at} />
              </View>
              <View style={styles.countsRow}>
                <View style={styles.countPill}>
                  <Text style={styles.countValue}>
                    {active.boarded_guests ?? 0}
                  </Text>
                  <Text style={styles.countLabel}>Boarded</Text>
                </View>
                <View style={styles.countPill}>
                  <Text style={styles.countValue}>
                    {active.boarding_pending ?? 0}
                  </Text>
                  <Text style={styles.countLabel}>Pending</Text>
                </View>
                <View style={styles.countPill}>
                  <Text style={styles.countValue}>
                    {active.no_show_guests ?? 0}
                  </Text>
                  <Text style={styles.countLabel}>No-show</Text>
                </View>
              </View>
              <Text style={styles.muted}>
                {active.guests.reduce(
                  (sum, guest) => sum + guest.party_size,
                  0,
                )}{" "}
                guests
                {active.guests.filter(
                  (guest) => guest.boarding_clearance === "due",
                ).length
                  ? ` · ${active.guests.filter((guest) => guest.boarding_clearance === "due").length} balance due`
                  : ""}
                {cruiseAboard ? ` · all aboard ${cruiseAboard}` : ""}
                {active.operational_status &&
                active.operational_status !== "open"
                  ? ` · ${active.operational_status.replace(/_/g, " ")}`
                  : ""}
              </Text>
              {canEvents ? (
                <Pressable
                  style={styles.statusChip}
                  onPress={() => setStatusOpen(true)}
                >
                  <View style={styles.statusDot} />
                  <Text style={styles.statusChipText}>
                    {tripStatusLabel(active.trip_run_state)}
                  </Text>
                  <Text style={styles.statusChipHint}>Change</Text>
                </Pressable>
              ) : null}
              {!tripStarted(active) ? (
                canCheckin ? (
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
                ) : null
              ) : (
                <Text style={styles.muted}>
                  Trip started
                  {active.trip_run_state
                    ? ` · ${active.trip_run_state.replace(/_/g, " ")}`
                    : ""}
                </Text>
              )}
            </View>
            {assignedToPickups(active.assignment_roles) &&
            (active.pickup_stops?.length ||
              active.pickup_exceptions?.length) ? (
              <View style={styles.card}>
                <Text style={styles.section}>YOUR PICKUP RUN</Text>
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
                    {guest.boarding_clearance === "due" && canPay ? (
                      <Button disabled={busy} onPress={() => openPay(guest)}>
                        Pay
                      </Button>
                    ) : null}
                    {guest.passengers.map((passenger) => {
                      const action = nextPassengerAction(passenger);
                      return (
                        <View style={styles.person} key={passenger.id}>
                          <Pressable
                            style={styles.grow}
                            onPress={() =>
                              canCheckin
                                ? openWaiver(guest, passenger)
                                : undefined
                            }
                          >
                            <Text style={styles.personName}>
                              {passenger.identity_pending
                                ? "Guest name required"
                                : passenger.name}
                            </Text>
                            <Text style={styles.muted}>
                              {passenger.category}
                              {passenger.is_minor ? " · minor" : ""} ·{" "}
                              {checkinLabel(passenger.checkin_state)} ·{" "}
                              {passenger.waiver_signed
                                ? "waiver signed"
                                : "waiver required"}
                            </Text>
                          </Pressable>
                          {action && canCheckin ? (
                            <View style={styles.rowActions}>
                              <Button
                                disabled={busy}
                                onPress={() => {
                                  if (action.kind === "waiver") {
                                    openWaiver(guest, passenger);
                                    return;
                                  }
                                  if (action.kind === "pay") {
                                    openPay(guest, passenger);
                                    return;
                                  }
                                  void mutate(
                                    `/staff/v1/passengers/${passenger.id}/checkin`,
                                    {
                                      state:
                                        action.kind === "clear"
                                          ? "cleared_to_board"
                                          : action.kind === "board"
                                            ? "boarded"
                                            : "arrived",
                                    },
                                  );
                                }}
                              >
                                {action.label}
                              </Button>
                              <Button
                                quiet
                                disabled={busy}
                                onPress={() => confirmNoShow(passenger)}
                              >
                                No-show
                              </Button>
                              {guest.boarding_clearance === "due" &&
                              canPay &&
                              action.kind !== "pay" ? (
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
                        </View>
                      );
                    })}
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
                  {todayRoleHint(profile?.role, showBoard)}
                </Text>
              </View>
            ) : (
              <>
                <TodayStrip trips={trips} />
                <Text style={styles.muted}>
                  {todayRoleHint(profile?.role, showBoard)}
                </Text>
                {trips.map((trip) => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    onPress={() => setActive(trip)}
                  />
                ))}
              </>
            )}
            <Button quiet disabled={busy} onPress={() => void load()}>
              Refresh
            </Button>
          </>
        )}
      </ScrollView>
      {footer}
      <OptionSheet
        title="Update trip status"
        visible={statusOpen}
        selected={active?.trip_run_state ?? undefined}
        options={tripStatusChoices.map((item) => ({
          value: item.value,
          label: item.label,
        }))}
        onSelect={(state) => {
          if (!active) return;
          void mutate(`/crew/v1/departures/${active.id}/events`, { state });
        }}
        onClose={() => setStatusOpen(false)}
      />
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
  titleTrip: { fontSize: 20, lineHeight: 26 },
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
  },
  quietText: { color: "#075f59" },
  error: { color: "#b42318" },
  errorBanner: { backgroundColor: "#fee4e2", color: "#b42318", padding: 12 },
  queueBanner: { backgroundColor: "#fff3d8", color: "#836322", padding: 12 },
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
  flex: { flex: 1 },
  select: {
    alignItems: "center",
    backgroundColor: "#f3f7f6",
    borderColor: "#cbdad7",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectLabel: { color: "#667b7f", fontSize: 13, fontWeight: "700" },
  selectValue: { color: "#17353a", fontSize: 16, fontWeight: "800" },
  timeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  tripClock: { color: "#17353a", fontSize: 22, fontWeight: "800" },
  countsRow: { flexDirection: "row", gap: 8 },
  countPill: {
    backgroundColor: "#f3f7f6",
    borderRadius: 12,
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  countValue: { color: "#17353a", fontSize: 18, fontWeight: "800" },
  countLabel: { color: "#667b7f", fontSize: 11, fontWeight: "700" },
  statusChip: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#e8f4f1",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusDot: {
    backgroundColor: "#087b72",
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusChipText: { color: "#075f59", fontSize: 14, fontWeight: "800" },
  statusChipHint: { color: "#087b72", fontSize: 12, fontWeight: "700" },
  signDock: {
    backgroundColor: "white",
    borderTopColor: "#dce7e4",
    borderTopWidth: 1,
    gap: 10,
    padding: 16,
  },
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
