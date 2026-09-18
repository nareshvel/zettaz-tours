import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { WEB } from "./config";
import { type Trip } from "./field";

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
  { value: "departed", label: "Departed" },
  { value: "completed", label: "Completed" },
] as const;

export function stayChoiceLabel(kind?: string) {
  return stayChoices.find((item) => item.value === kind)?.label ?? "None";
}

export function tripStatusLabel(state?: string | null) {
  if (!state) return "Not started";
  return (
    tripStatusChoices.find((item) => item.value === state)?.label ??
    state.replace(/_/g, " ")
  );
}

export function todayRoleHint(role?: string, tabletBoard?: boolean): string {
  if (role === "reservations")
    return tabletBoard
      ? "Walk-up lives on Day Board. Assigned trips still show here."
      : "Walk-up booking is on a tablet Day Board. This phone lists trips you are assigned to as crew.";
  if (role === "finance")
    return "Boarding Pay opens from a trip roster. Assign this person as crew to collect in the field.";
  if (role === "dispatcher" || role === "operations_manager")
    return tabletBoard
      ? "Day Board is every departure today. My trips is only what you are assigned to."
      : "Open Zettaz Crew on a tablet for the full Day Board. This phone is assigned trips only.";
  if (role === "owner" || role === "admin")
    return tabletBoard
      ? "Day Board for the dock; My trips for runs you are assigned to."
      : "Assigned trips only on this phone. Use a tablet for Day Board and walk-up.";
  if (
    role === "auditor" ||
    role === "resource_manager" ||
    role === "partner_manager"
  )
    return "This app is for assigned field work. Open the web workspace for desk tools.";
  return "Only departures assigned to you as crew appear here.";
}

export type TabId = "today" | "scan" | "board" | "profile";

export function TabBar({
  active,
  showScan,
  showBoard,
  onChange,
}: {
  active: TabId;
  showScan: boolean;
  showBoard: boolean;
  onChange: (tab: TabId) => void;
}) {
  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "today", label: "Today", icon: "▣" },
    ...(showScan ? [{ id: "scan" as const, label: "Scan", icon: "⌖" }] : []),
    ...(showBoard ? [{ id: "board" as const, label: "Board", icon: "▦" }] : []),
    { id: "profile", label: "Profile", icon: "●" },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.id)}
            style={styles.tab}
          >
            <Text style={[styles.tabIcon, selected && styles.tabIconOn]}>
              {tab.icon}
            </Text>
            <Text style={[styles.tabLabel, selected && styles.tabLabelOn]}>
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
  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>{title}</Text>
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
          <Pressable onPress={onClose} style={styles.sheetCancel}>
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function TripCard({
  trip,
  onPress,
}: {
  trip: Trip;
  onPress: () => void;
}) {
  const cover = productCoverUri(trip.cover_path);
  const due = trip.guests.filter(
    (guest) => guest.boarding_clearance === "due",
  ).length;
  const guests = trip.guests.reduce((sum, item) => sum + item.party_size, 0);
  const gaps = trip.pickup_exceptions?.length ?? 0;
  return (
    <Pressable style={styles.tripCard} onPress={onPress}>
      {cover ? (
        <Image source={{ uri: cover }} style={styles.tripCover} />
      ) : (
        <View style={styles.tripCoverFallback}>
          <Text style={styles.tripCoverLetter}>
            {(trip.product_name.trim()[0] ?? "T").toUpperCase()}
          </Text>
        </View>
      )}
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
          {trip.assignment_roles.join(" · ") || "Assigned"}
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
  tab: { alignItems: "center", flex: 1, gap: 2, paddingVertical: 4 },
  tabIcon: { color: "#8aa0a4", fontSize: 18, fontWeight: "800" },
  tabIconOn: { color: "#087b72" },
  tabLabel: { color: "#8aa0a4", fontSize: 11, fontWeight: "700" },
  tabLabelOn: { color: "#087b72" },
  sheetBackdrop: {
    backgroundColor: "rgba(23,53,58,0.36)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 6,
    padding: 20,
    paddingBottom: 28,
  },
  sheetTitle: {
    color: "#17353a",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  sheetRow: {
    borderColor: "#dce7e4",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  sheetRowOn: { backgroundColor: "#e7f2f0", borderColor: "#087b72" },
  sheetRowText: { color: "#17353a", fontSize: 16, fontWeight: "700" },
  sheetRowTextOn: { color: "#075f59" },
  sheetCancel: { alignItems: "center", paddingVertical: 12 },
  sheetCancelText: { color: "#667b7f", fontWeight: "700" },
  tripCard: {
    backgroundColor: "white",
    borderColor: "#dce7e4",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 108,
    overflow: "hidden",
  },
  tripCover: { height: "100%", minHeight: 108, width: 108 },
  tripCoverFallback: {
    alignItems: "center",
    backgroundColor: "#0e4f4a",
    justifyContent: "center",
    minHeight: 108,
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
});
