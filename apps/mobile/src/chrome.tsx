import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useEffect, useState, type ReactNode } from "react";
import { WEB } from "./config";
import { tripCountdown, type Trip } from "./field";

export function productCoverUri(coverPath?: string | null) {
  if (!coverPath) return null;
  if (/^https?:\/\//i.test(coverPath)) return coverPath;
  return `${WEB}${coverPath.startsWith("/") ? "" : "/"}${coverPath}`;
}

export const stayChoices = [
  { value: "none", label: "None" },
  { value: "cruise", label: "Vessel" },
  { value: "hotel", label: "Hotel" },
  { value: "private_accommodation", label: "Airbnb / private" },
  { value: "local", label: "Local" },
] as const;

export const tripStatusChoices = [
  { value: "preparing", label: "Preparing" },
  { value: "boarding", label: "Boarding" },
  { value: "completed", label: "Completed" },
] as const;

export function stayChoiceLabel(kind?: string) {
  return stayChoices.find((item) => item.value === kind)?.label ?? "None";
}

export function tripStatusLabel(state?: string | null) {
  if (!state) return "Not started";
  if (state === "departed") return "Departed";
  return (
    tripStatusChoices.find((item) => item.value === state)?.label ??
    state.replace(/_/g, " ")
  );
}

export function selectableTripStatuses(state?: string | null) {
  const started = ["departed", "completed", "cancelled"].includes(state ?? "");
  return tripStatusChoices.filter((item) =>
    started ? item.value === "completed" : item.value !== "completed",
  );
}

export function todayRoleHint(role?: string, tabletBoard?: boolean): string {
  if (role === "reservations")
    return tabletBoard
      ? "Walk-in booking lives on Day Board. Assigned trips still show here."
      : "Day Board is on the Board tab when this account can sell walk-ins.";
  if (role === "finance")
    return "Boarding Pay opens from a trip roster. Assign this person as crew to collect in the field.";
  if (role === "dispatcher" || role === "operations_manager")
    return tabletBoard
      ? "Day Board is every departure today. My trips is only what you are assigned to."
      : "Day Board is on the Board tab. Today is assigned trips only.";
  if (role === "owner" || role === "admin")
    return tabletBoard
      ? "Day Board and Today both list every departure for this tenant."
      : "Every departure today is listed here, including trips you are not assigned to.";
  if (
    role === "auditor" ||
    role === "resource_manager" ||
    role === "partner_manager"
  )
    return "This app is for assigned field work. Open the web workspace for desk tools.";
  return "Only departures assigned to you as crew appear here.";
}

export type TabId = "today" | "scan" | "board" | "book" | "profile";

function TabGlyph({
  id,
  on,
}: {
  id: TabId;
  on: boolean;
}) {
  const color = on ? "#087b72" : "#8aa0a4";
  if (id === "today")
    return (
      <View style={[styles.glyph, { borderColor: color }]}>
        <View style={[styles.glyphCalBar, { backgroundColor: color }]} />
        <View style={styles.glyphCalDots}>
          <View style={[styles.glyphDot, { backgroundColor: color }]} />
          <View style={[styles.glyphDot, { backgroundColor: color }]} />
          <View style={[styles.glyphDot, { backgroundColor: color }]} />
        </View>
      </View>
    );
  if (id === "scan")
    return (
      <View style={styles.glyphBox}>
        <View style={[styles.glyphCorner, styles.glyphTL, { borderColor: color }]} />
        <View style={[styles.glyphCorner, styles.glyphTR, { borderColor: color }]} />
        <View style={[styles.glyphCorner, styles.glyphBL, { borderColor: color }]} />
        <View style={[styles.glyphCorner, styles.glyphBR, { borderColor: color }]} />
        <View style={[styles.glyphScanMid, { backgroundColor: color }]} />
      </View>
    );
  if (id === "board")
    return (
      <View style={styles.glyphGrid}>
        <View style={[styles.glyphCell, { borderColor: color }]} />
        <View style={[styles.glyphCell, { borderColor: color }]} />
        <View style={[styles.glyphCell, { borderColor: color }]} />
        <View style={[styles.glyphCell, { borderColor: color }]} />
      </View>
    );
  if (id === "book")
    return (
      <View style={[styles.glyphTicket, { borderColor: color }]}>
        <View style={[styles.glyphTicketLine, { backgroundColor: color }]} />
        <View style={[styles.glyphTicketLine, { backgroundColor: color }]} />
      </View>
    );
  return (
    <View style={styles.glyphBox}>
      <View style={[styles.glyphHead, { borderColor: color }]} />
      <View style={[styles.glyphShoulder, { borderColor: color }]} />
    </View>
  );
}

export function TabBar({
  active,
  showScan,
  showBoard,
  showBook,
  onChange,
}: {
  active: TabId;
  showScan: boolean;
  showBoard: boolean;
  showBook: boolean;
  onChange: (tab: TabId) => void;
}) {
  const tabs: { id: TabId; label: string }[] = [
    { id: "today", label: "Today" },
    ...(showScan ? [{ id: "scan" as const, label: "Scan" }] : []),
    ...(showBoard ? [{ id: "board" as const, label: "Day Board" }] : []),
    ...(showBook ? [{ id: "book" as const, label: "Booking" }] : []),
    { id: "profile", label: "Me" },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.id)}
            style={styles.tab}
          >
            <View style={styles.tabGlyph}>
              <TabGlyph id={tab.id} on={selected} />
            </View>
            <Text
              numberOfLines={1}
              style={[styles.tabLabel, selected && styles.tabLabelOn]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function OptionSheet({
  title,
  visible,
  options,
  selected,
  onSelect,
  onClose,
}: {
  title: string;
  visible: boolean;
  options: { value: string; label: string }[];
  selected?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const asGrid =
    options.length > 4 && options.every((option) => option.label.length <= 3);
  const maxValue = asGrid
    ? Math.max(0, ...options.map((option) => Number(option.value) || 0))
    : 0;
  const chips = asGrid
    ? options.filter((option) => Number(option.value) <= 10)
    : options;
  const allowMore = asGrid && maxValue > 10;
  const selectedOverTen = Number(selected) > 10;
  const [moreOpen, setMoreOpen] = useState(false);
  const [custom, setCustom] = useState("");
  useEffect(() => {
    if (!visible) return;
    setMoreOpen(selectedOverTen);
    setCustom(selectedOverTen ? String(selected) : "");
  }, [visible, selected, selectedOverTen]);
  function applyCustom() {
    const count = Number.parseInt(custom, 10);
    if (!Number.isFinite(count)) return;
    const next = Math.min(maxValue, Math.max(11, count));
    onSelect(String(next));
    onClose();
  }
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {asGrid ? (
            <View style={styles.sheetGrid}>
              {chips.map((option) => {
                const on = option.value === selected && !moreOpen;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      onSelect(option.value);
                      onClose();
                    }}
                    style={[styles.sheetChip, on && styles.sheetChipOn]}
                  >
                    <Text
                      style={[
                        styles.sheetChipText,
                        on && styles.sheetChipTextOn,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
              {allowMore ? (
                <Pressable
                  onPress={() => setMoreOpen(true)}
                  style={[
                    styles.sheetChip,
                    styles.sheetChipMore,
                    (moreOpen || selectedOverTen) && styles.sheetChipOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.sheetChipText,
                      (moreOpen || selectedOverTen) && styles.sheetChipTextOn,
                    ]}
                  >
                    More
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <ScrollView
              style={styles.sheetList}
              keyboardShouldPersistTaps="handled"
            >
              {options.map((option) => {
                const on = option.value === selected;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      onSelect(option.value);
                      onClose();
                    }}
                    style={[styles.sheetRow, on && styles.sheetRowOn]}
                  >
                    <Text
                      style={[styles.sheetRowText, on && styles.sheetRowTextOn]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {moreOpen ? (
            <View style={styles.sheetCustom}>
              <Text style={styles.formSubtitle}>
                Enter 11–{maxValue} for this category.
              </Text>
              <TextInput
                style={styles.sheetCustomInput}
                keyboardType="number-pad"
                placeholder="11+"
                value={custom}
                onChangeText={setCustom}
                autoFocus
              />
              <Pressable
                onPress={applyCustom}
                style={[
                  styles.sheetApply,
                  !custom.trim() && styles.sheetApplyOff,
                ]}
              >
                <Text style={styles.sheetApplyText}>Use number</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable onPress={onClose} style={styles.sheetCancel}>
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function FormModal({
  visible,
  title,
  subtitle,
  onClose,
  dismissible = true,
  wide = false,
  full = false,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  dismissible?: boolean;
  wide?: boolean;
  full?: boolean;
  children: ReactNode;
}) {
  const body = (
    <>
      <View style={styles.formHead}>
        <View style={styles.grow}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {subtitle ? (
            <Text style={styles.formSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
        {dismissible ? (
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.formClose}>Close</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={styles.formScrollContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {children}
      </ScrollView>
    </>
  );
  return (
    <Modal
      animationType={full ? "slide" : "fade"}
      visible={visible}
      onRequestClose={dismissible ? onClose : undefined}
      presentationStyle="overFullScreen"
      transparent={!full}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={full ? styles.formFull : styles.formBackdrop}
      >
        {full ? (
          <SafeAreaView style={styles.formFullInner}>{body}</SafeAreaView>
        ) : (
          <View style={styles.formBackdropPress}>
            <View
              style={[
                styles.formCard,
                wide && styles.formCardWide,
                styles.formCardScroll,
              ]}
            >
              {body}
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ProductCover({
  path,
  name,
}: {
  path?: string | null;
  name: string;
}) {
  const cover = productCoverUri(path);
  const [coverFailed, setCoverFailed] = useState(false);
  const showPhoto = Boolean(cover) && !coverFailed;
  return showPhoto ? (
    <Image
      source={{ uri: cover! }}
      style={styles.tripCover}
      resizeMode="cover"
      onError={() => setCoverFailed(true)}
    />
  ) : (
    <View style={styles.tripCoverFallback}>
      <Text style={styles.tripCoverLetter}>
        {(name.trim()[0] ?? "T").toUpperCase()}
      </Text>
    </View>
  );
}

export function TripCard({
  trip,
  onPress,
}: {
  trip: Trip;
  onPress: () => void;
}) {
  const due = trip.guests.filter(
    (guest) => guest.boarding_clearance === "due",
  ).length;
  const guests = trip.guests.reduce((sum, item) => sum + item.party_size, 0);
  const gaps = trip.pickup_exceptions?.length ?? 0;
  return (
    <Pressable style={styles.tripCard} onPress={onPress}>
      <ProductCover path={trip.cover_path} name={trip.product_name} />
      <View style={styles.tripBody}>
        <Text style={styles.tripTime}>
          {new Date(trip.starts_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {trip.trip_run_state
            ? ` · ${tripStatusLabel(trip.trip_run_state)}`
            : ""}
        </Text>
        <Text style={styles.tripTitle} numberOfLines={2}>
          {trip.product_name}
        </Text>
        <Text style={styles.tripMeta}>
          {trip.assignment_roles.join(" · ") || "Not assigned"}
        </Text>
        <Text style={styles.tripMeta}>
          {guests} guest{guests === 1 ? "" : "s"}
          {due ? ` · ${due} balance due` : ""}
          {gaps ? ` · ${gaps} pickup gap${gaps === 1 ? "" : "s"}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

export function TripTimer({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [startsAt]);
  const clock = tripCountdown(startsAt, now);
  return (
    <View style={[styles.timer, clock.overdue ? styles.timerOverdue : null]}>
      <Text
        style={[
          styles.timerText,
          clock.overdue ? styles.timerTextOverdue : null,
        ]}
      >
        {clock.label}
      </Text>
    </View>
  );
}

export function SignatureInk({
  points,
  width,
  height,
}: {
  points: { x: number; y: number }[];
  width: number;
  height: number;
}) {
  if (width < 2 || height < 2 || points.length < 2) return null;
  return (
    <>
      {points.slice(1).map((point, index) => {
        const prev = points[index]!;
        const x1 = prev.x * width;
        const y1 = prev.y * height;
        const x2 = point.x * width;
        const y2 = point.y * height;
        const length = Math.hypot(x2 - x1, y2 - y1);
        if (length < 0.5) return null;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        return (
          <View
            key={index}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: (x1 + x2) / 2 - length / 2,
              top: (y1 + y2) / 2 - 1.5,
              width: length,
              height: 3,
              backgroundColor: "#17353a",
              borderRadius: 2,
              transform: [{ rotate: `${angle}rad` }],
            }}
          />
        );
      })}
    </>
  );
}

export function TodayStrip({ trips }: { trips: Trip[] }) {
  const guests = trips.reduce(
    (sum, trip) =>
      sum + trip.guests.reduce((inner, guest) => inner + guest.party_size, 0),
    0,
  );
  const due = trips.reduce(
    (sum, trip) =>
      sum +
      trip.guests.filter((guest) => guest.boarding_clearance === "due").length,
    0,
  );
  const pending = trips.reduce(
    (sum, trip) => sum + (trip.boarding_pending ?? 0),
    0,
  );
  return (
    <View style={styles.strip}>
      <View style={styles.stripCell}>
        <Text style={styles.stripValue}>{trips.length}</Text>
        <Text style={styles.stripLabel}>Trips</Text>
      </View>
      <View style={styles.stripCell}>
        <Text style={styles.stripValue}>{guests}</Text>
        <Text style={styles.stripLabel}>Guests</Text>
      </View>
      <View style={styles.stripCell}>
        <Text style={styles.stripValue}>{pending}</Text>
        <Text style={styles.stripLabel}>To board</Text>
      </View>
      <View style={styles.stripCell}>
        <Text style={[styles.stripValue, due ? styles.stripWarn : null]}>
          {due}
        </Text>
        <Text style={styles.stripLabel}>Balance due</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: "white",
    borderTopColor: "#dce7e4",
    borderTopWidth: 1,
    flexDirection: "row",
    paddingBottom: 10,
    paddingTop: 8,
  },
  tab: { alignItems: "center", flex: 1, gap: 4, paddingVertical: 4 },
  tabGlyph: { alignItems: "center", height: 22, justifyContent: "center", width: 22 },
  glyph: {
    borderRadius: 3,
    borderWidth: 1.6,
    height: 18,
    overflow: "hidden",
    width: 18,
  },
  glyphCalBar: { height: 4, width: "100%" },
  glyphCalDots: {
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    paddingTop: 3,
  },
  glyphDot: { borderRadius: 1, height: 2.5, width: 2.5 },
  glyphBox: { height: 22, width: 22 },
  glyphCorner: { height: 7, position: "absolute", width: 7 },
  glyphTL: { borderLeftWidth: 1.8, borderTopWidth: 1.8, left: 2, top: 2 },
  glyphTR: { borderRightWidth: 1.8, borderTopWidth: 1.8, right: 2, top: 2 },
  glyphBL: { borderBottomWidth: 1.8, borderLeftWidth: 1.8, bottom: 2, left: 2 },
  glyphBR: { borderBottomWidth: 1.8, borderRightWidth: 1.8, bottom: 2, right: 2 },
  glyphScanMid: {
    alignSelf: "center",
    borderRadius: 1,
    height: 6,
    marginTop: 8,
    width: 6,
  },
  glyphGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    height: 18,
    width: 18,
  },
  glyphCell: { borderRadius: 2, borderWidth: 1.5, height: 8, width: 8 },
  glyphTicket: {
    borderRadius: 3,
    borderWidth: 1.6,
    height: 16,
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 3,
    width: 18,
  },
  glyphTicketLine: { borderRadius: 1, height: 1.6, width: "100%" },
  glyphHead: {
    alignSelf: "center",
    borderRadius: 5,
    borderWidth: 1.6,
    height: 8,
    marginTop: 1,
    width: 8,
  },
  glyphShoulder: {
    alignSelf: "center",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderTopWidth: 1.6,
    borderLeftWidth: 1.6,
    borderRightWidth: 1.6,
    height: 8,
    marginTop: 2,
    width: 14,
  },
  tabLabel: { color: "#8aa0a4", fontSize: 10, fontWeight: "700" },
  tabLabelOn: { color: "#087b72" },
  sheetBackdrop: {
    backgroundColor: "rgba(23,53,58,0.36)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    alignSelf: "center",
    backgroundColor: "white",
    borderRadius: 20,
    gap: 8,
    marginBottom: 24,
    marginHorizontal: 16,
    maxHeight: "52%",
    maxWidth: 420,
    padding: 16,
    width: "100%",
  },
  sheetList: { maxHeight: 280 },
  sheetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sheetChip: {
    alignItems: "center",
    borderColor: "#dce7e4",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    width: "22%",
  },
  sheetChipOn: { backgroundColor: "#087b72", borderColor: "#087b72" },
  sheetChipText: { color: "#17353a", fontSize: 16, fontWeight: "700" },
  sheetChipTextOn: { color: "white" },
  sheetChipMore: { width: "22%" },
  sheetCustom: { gap: 8 },
  sheetCustomInput: {
    borderColor: "#cbdad7",
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 18,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sheetApply: {
    alignItems: "center",
    backgroundColor: "#087b72",
    borderRadius: 12,
    paddingVertical: 12,
  },
  sheetApplyOff: { opacity: 0.4 },
  sheetApplyText: { color: "white", fontWeight: "800" },
  sheetTitle: {
    color: "#17353a",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  sheetRow: {
    borderColor: "#dce7e4",
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sheetRowOn: { backgroundColor: "#e7f2f0", borderColor: "#087b72" },
  sheetRowText: { color: "#17353a", fontSize: 16, fontWeight: "700" },
  sheetRowTextOn: { color: "#075f59" },
  sheetCancel: { alignItems: "center", paddingVertical: 12 },
  sheetCancelText: { color: "#667b7f", fontWeight: "700" },
  formBackdrop: {
    backgroundColor: "rgba(6,31,35,0.45)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  formBackdropPress: { flex: 1, justifyContent: "center" },
  formFull: { backgroundColor: "white", flex: 1 },
  formFullInner: { backgroundColor: "white", flex: 1 },
  formHead: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    paddingBottom: 8,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  grow: { flex: 1 },
  formClose: { color: "#087b72", fontWeight: "800", paddingTop: 4 },
  formScroll: { flex: 1 },
  formScrollContent: { gap: 12, paddingBottom: 36, paddingHorizontal: 20 },
  formCard: {
    alignSelf: "center",
    backgroundColor: "white",
    borderRadius: 20,
    maxHeight: "92%",
    maxWidth: 440,
    overflow: "hidden",
    width: "100%",
  },
  formCardWide: { maxWidth: 640 },
  formCardScroll: { maxHeight: "92%" },
  formSubtitle: { color: "#5b7478", lineHeight: 20 },
  tripCard: {
    backgroundColor: "white",
    borderColor: "#dce7e4",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 108,
    overflow: "hidden",
  },
  tripCover: { height: 108, width: 108 },
  tripCoverFallback: {
    alignItems: "center",
    backgroundColor: "#0e4f4a",
    height: 108,
    justifyContent: "center",
    width: 108,
  },
  tripCoverLetter: { color: "white", fontSize: 28, fontWeight: "800" },
  tripBody: { flex: 1, gap: 4, minWidth: 0, padding: 14 },
  tripTime: { color: "#087b72", fontSize: 12, fontWeight: "800" },
  tripTitle: { color: "#17353a", fontSize: 16, fontWeight: "800" },
  tripMeta: { color: "#667b7f", fontSize: 13, lineHeight: 18 },
  strip: {
    backgroundColor: "white",
    borderColor: "#dce7e4",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    paddingVertical: 12,
  },
  stripCell: { alignItems: "center", flex: 1, gap: 2 },
  stripValue: { color: "#17353a", fontSize: 20, fontWeight: "800" },
  stripWarn: { color: "#b42318" },
  stripLabel: { color: "#667b7f", fontSize: 11, fontWeight: "700" },
  timer: {
    backgroundColor: "#e8f4f1",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  timerOverdue: { backgroundColor: "#fde8e6" },
  timerText: { color: "#087b72", fontSize: 12, fontWeight: "800" },
  timerTextOverdue: { color: "#b42318" },
});
