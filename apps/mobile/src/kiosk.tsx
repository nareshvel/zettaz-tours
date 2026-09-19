import * as SecureStore from "expo-secure-store";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TABLET_MIN_WIDTH } from "./field";

const KIOSK_KEY = "zettaz-crew-kiosk";

export async function kioskArmed() {
  return (await SecureStore.getItemAsync(KIOSK_KEY)) === "1";
}

export async function armKiosk() {
  await SecureStore.setItemAsync(KIOSK_KEY, "1");
}

export async function disarmKiosk() {
  await SecureStore.deleteItemAsync(KIOSK_KEY);
}

/** Dock tablet with check-in: guest kiosk is waiver/QR only. */
export function canStartKiosk(input: {
  width: number;
  role?: string;
  permissions?: string[];
}) {
  if (input.width < TABLET_MIN_WIDTH) return false;
  const permissions = input.permissions ?? [];
  if (!permissions.includes("checkin.write")) return false;
  if (
    permissions.includes("manifest.read") ||
    permissions.includes("bookings.write")
  )
    return true;
  return input.role === "owner";
}

export function KioskHome({
  tenantName,
  onScan,
  onStaffExit,
}: {
  tenantName: string;
  onScan: () => void;
  onStaffExit: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>GUEST CHECK-IN</Text>
      <Text style={styles.title}>{tenantName || "Zettaz Crew"}</Text>
      <Text style={styles.copy}>
        Scan the check-in code on your booking, then sign the waiver. Staff
        tools stay locked until a crew PIN is entered.
      </Text>
      <Pressable onPress={onScan} style={styles.scan}>
        <Text style={styles.scanText}>Scan check-in code</Text>
      </Pressable>
      <Pressable onPress={onStaffExit} style={styles.exit}>
        <Text style={styles.exitText}>Staff exit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: "#075f59",
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: "#102226",
  },
  copy: {
    fontSize: 16,
    lineHeight: 24,
    color: "#4d6367",
    maxWidth: 520,
  },
  scan: {
    marginTop: 12,
    backgroundColor: "#075f59",
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 22,
    alignSelf: "flex-start",
  },
  scanText: { color: "white", fontSize: 18, fontWeight: "800" },
  exit: { paddingVertical: 12, alignSelf: "flex-start" },
  exitText: { color: "#075f59", fontSize: 15, fontWeight: "700" },
});
