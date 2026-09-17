import { useState } from "react";
import {
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  formatMoney,
  occupancyLabel,
  operationalLabel,
  paymentMethodLabel,
  type BoardItem,
  type BoardPayload,
  type WalkUpQuote,
} from "./field";

function Action({
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
      style={[styles.button, quiet && styles.quiet, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, quiet && styles.quietText]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function tenantDay(timezone?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function DayBoard({
  board,
  busy,
  onOpen,
  onWalkUp,
  onWeather,
  onShare,
  onRefresh,
}: {
  board: BoardPayload;
  busy: boolean;
  onOpen: (item: BoardItem) => void;
  onWalkUp: (item: BoardItem) => void;
  onWeather: (item: BoardItem) => void;
  onShare: (item: BoardItem) => void;
  onRefresh: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.muted}>
        {board.items.length
          ? `${board.items.length} departures · ${board.date}`
          : `No departures on ${board.date}.`}
      </Text>
      {board.items.map((item) => {
        const closed = item.operational_status !== "open";
        return (
          <View style={styles.card} key={item.id}>
            <Text style={styles.cardTitle}>{item.product_name}</Text>
            <Text style={styles.muted}>
              {new Date(item.starts_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · {occupancyLabel(item)}
            </Text>
            <Text style={closed ? styles.warn : styles.muted}>
              {operationalLabel(item.operational_status)}
              {item.operational_reason ? ` · ${item.operational_reason}` : ""}
              {item.trip_run_state
                ? ` · ${item.trip_run_state.replace(/_/g, " ")}`
                : ""}
            </Text>
            <Text style={styles.muted}>
              {item.boarded_guests} boarded · {item.boarding_pending} pending
            </Text>
            {item.crew.length ? (
              <Text style={styles.muted}>
                Crew ·{" "}
                {item.crew
                  .map((member) => `${member.name} (${member.assignment_role})`)
                  .join(" · ")}
              </Text>
            ) : (
              <Text style={styles.warn}>No crew assigned</Text>
            )}
            <View style={styles.actions}>
              <Action disabled={busy} onPress={() => onOpen(item)}>
                Boarding
              </Action>
              {board.capabilities.walkUp && !closed ? (
                <Action disabled={busy} onPress={() => onWalkUp(item)}>
                  Walk-up
                </Action>
              ) : null}
              {board.capabilities.weather ? (
                <Action quiet disabled={busy} onPress={() => onWeather(item)}>
                  Weather
                </Action>
              ) : null}
              {board.capabilities.print ? (
                <Action quiet disabled={busy} onPress={() => onShare(item)}>
                  Share list
                </Action>
              ) : null}
            </View>
          </View>
        );
      })}
      <Action quiet disabled={busy} onPress={onRefresh}>
        Refresh board
      </Action>
    </View>
  );
}

export function WeatherSheet({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: BoardItem;
  busy: boolean;
  onClose: () => void;
  onSave: (status: "open" | "weather_hold" | "closed", reason: string) => void;
}) {
  const [reason, setReason] = useState(item.operational_reason ?? "");
  const next =
    item.operational_status === "open"
      ? ([
          ["weather_hold", "Weather hold"],
          ["closed", "Close"],
        ] as const)
      : ([["open", "Reopen"]] as const);
  return (
    <View style={styles.stack}>
      <Text style={styles.cardTitle}>{item.product_name}</Text>
      <Text style={styles.muted}>
        {operationalLabel(item.operational_status)}. Give a reason for the
        audit trail.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Reason"
        value={reason}
        onChangeText={setReason}
      />
      {next.map(([status, label]) => (
        <Action
          key={status}
          disabled={busy || reason.trim().length < 1}
          onPress={() => onSave(status, reason.trim())}
        >
          {label}
        </Action>
      ))}
      <Action quiet onPress={onClose}>
        Cancel
      </Action>
    </View>
  );
}

export function WalkUpSheet({
  item,
  busy,
  methods,
  held,
  error,
  onClose,
  onCreate,
  onPay,
}: {
  item: BoardItem;
  busy: boolean;
  methods: string[];
  held: { bookingId: string; quote: WalkUpQuote } | null;
  error?: string;
  onClose: () => void;
  onCreate: (input: {
    adults: number;
    leadName: string;
    leadEmail: string;
  }) => void;
  onPay: (input: { method: string; amountMinor: number }) => void;
}) {
  const [adults, setAdults] = useState("1");
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [method, setMethod] = useState(methods[0] ?? "cash");
  const seats = Math.max(1, Number.parseInt(adults, 10) || 1);
  const remaining = item.capacity - item.committed;
  if (held) {
    return (
      <View style={styles.stack}>
        <Text style={styles.cardTitle}>Collect to confirm</Text>
        <Text style={styles.muted}>
          {formatMoney(held.quote.totalMinor, held.quote.currency)} due before
          this walk-up can confirm.
        </Text>
        {error ? <Text style={styles.warn}>{error}</Text> : null}
        <View style={styles.actions}>
          {methods.map((value) => (
            <Pressable
              key={value}
              onPress={() => setMethod(value)}
              style={[styles.choice, method === value && styles.choiceSelected]}
            >
              <Text
                style={
                  method === value ? styles.choiceTextSelected : styles.choiceText
                }
              >
                {paymentMethodLabel(value)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Action
          disabled={busy}
          onPress={() =>
            onPay({ method, amountMinor: held.quote.totalMinor })
          }
        >
          {busy ? "Recording…" : "Record cash / manual"}
        </Action>
        <Action quiet onPress={onClose}>
          Cancel
        </Action>
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <Text style={styles.cardTitle}>Walk-up</Text>
      <Text style={styles.muted}>
        {item.product_name} · {remaining} seats left
      </Text>
      {error ? <Text style={styles.warn}>{error}</Text> : null}
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        placeholder="Adults"
        value={adults}
        onChangeText={setAdults}
      />
      <TextInput
        style={styles.input}
        placeholder="Lead guest name"
        value={leadName}
        onChangeText={setLeadName}
      />
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        value={leadEmail}
        onChangeText={setLeadEmail}
      />
      <Action
        disabled={
          busy || !leadName.trim() || !leadEmail.trim() || seats > remaining
        }
        onPress={() =>
          onCreate({
            adults: seats,
            leadName: leadName.trim(),
            leadEmail: leadEmail.trim(),
          })
        }
      >
        {busy ? "Saving…" : "Hold and confirm"}
      </Action>
      <Action quiet onPress={onClose}>
        Cancel
      </Action>
    </View>
  );
}

export async function sharePickupText(productName: string, body: string) {
  await Share.share({ title: `${productName} pickup list`, message: body });
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  card: {
    backgroundColor: "white",
    borderColor: "#dce7e4",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  cardTitle: { color: "#17353a", fontSize: 18, fontWeight: "800" },
  muted: { color: "#5b7478", lineHeight: 20 },
  warn: { color: "#b42318", fontWeight: "700", lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  button: {
    backgroundColor: "#087b72",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: { color: "white", fontWeight: "700" },
  quiet: { backgroundColor: "#e7f1ef" },
  quietText: { color: "#17353a" },
  disabled: { opacity: 0.45 },
  input: {
    backgroundColor: "white",
    borderColor: "#cbdad7",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
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
});
