# Optional cruise and hotel stay details

Bookings support optional stay detail: `cruise` with vessel name and cabin number, `hotel` with hotel name and room number, `private_accommodation` for Airbnb or another private property label/address, or `local` for a local resident or no visitor accommodation. The departure-waiver and staff reservation flows share this tenant-neutral model. These fields are operational identifiers for pickup, waiver rosters, and check-in; a signed waiver stores an immutable stay snapshot but the stay record itself is not signature evidence.

The application now provides tenant-controlled `CruiseCall` and accommodation property records. A cruise call captures vessel, date, port, scheduled arrival/departure, tender status, and the operational all-aboard deadline. A reservation may link one controlled cruise call or accommodation while retaining its optional cabin or room number. The server copies the controlled vessel or property name into the booking snapshot and rejects cross-tenant or inactive references.

Legacy and imported records may retain validated names without a controlled identifier until reconciliation. New staff reservations use controlled options when they record cruise or hotel details. Cabin and room numbers remain optional.

The scanned Rock Adventures form is reference material only. Its branded waiver wording is not copied into an approved tenant template.
