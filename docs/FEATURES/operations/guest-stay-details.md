# Optional cruise and hotel stay details

Bookings may include one optional stay detail: `cruise` with vessel name and cabin number, or `hotel` with hotel name and room number. These fields are operational identifiers for pickup, waiver rosters, and check-in; they are not payment or waiver evidence.

The application now provides tenant-controlled `CruiseCall` and accommodation property records. A cruise call captures vessel, date, port, scheduled arrival/departure, tender status, and the operational all-aboard deadline. A reservation may link one controlled cruise call or accommodation while retaining its optional cabin or room number. The server copies the controlled vessel or property name into the booking snapshot and rejects cross-tenant or inactive references.

Legacy and imported records may retain validated names without a controlled identifier until reconciliation. New staff reservations use controlled options when they record cruise or hotel details. Cabin and room numbers remain optional.

The scanned Rock Adventures form is reference material only. Its branded waiver wording is not copied into an approved tenant template.
