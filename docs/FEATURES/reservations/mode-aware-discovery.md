# Mode-aware reservation discovery

**Updated:** 10 September 2026

New reservation starts from the product's `availability_mode`. Only `fixed_departure` uses the dated seat-hold checkout. `opening_hours`, `open_dated`, `on_request`, and `resource_window` are listed with an explicit unsupported notice. The API will not create a hold against a non-fixed product even if a dated row exists.

Staff can still search all scheduled inventory, or filter to one scheduled product. Dedicated request, opening-hours, voucher, and resource-window booking engines remain later increments.

## Finder controls — 16 September 2026

The discovery bar follows the Departures and Reservations pattern: **search box, travel date, one Filter button**. Product, time of day and "show sold out" moved into the filter popover, and the count badge on the button counts only non-default choices, so it answers "have I narrowed this?" rather than "how many controls exist?".

The date keeps its own control on the bar because it is the field that changes on every booking; the row bottom-aligns, since the date carries a label and the other two do not.

The step's explanatory line ("Pick the product and travel date…") moved into an `InfoTip` beside the heading — it is read once and then skipped forever, and it was pushing the controls down the panel on every booking after the first.

