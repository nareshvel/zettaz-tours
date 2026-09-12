# Mode-aware reservation discovery

**Updated:** 10 September 2026

New reservation starts from the product's `availability_mode`. Only `fixed_departure` uses the dated seat-hold checkout. `opening_hours`, `open_dated`, `on_request`, and `resource_window` are listed with an explicit unsupported notice. The API will not create a hold against a non-fixed product even if a dated row exists.

Staff can still search all scheduled inventory, or filter to one scheduled product. Dedicated request, opening-hours, voucher, and resource-window booking engines remain later increments.
