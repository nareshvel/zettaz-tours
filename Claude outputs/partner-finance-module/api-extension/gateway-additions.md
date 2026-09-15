# Gateway Allowlist Additions
# Add these to your gateway route config alongside existing finance/v1 routes

GET  finance/v1/partners/:id/bookings/unsettled
POST finance/v1/partners/:id/bookings
DELETE finance/v1/partners/:id/bookings/:linkId
GET  finance/v1/partners/:id/settlements
POST finance/v1/partners/:id/settlements
GET  finance/v1/partners/:id/settlements/:sid
PATCH finance/v1/partners/:id/settlements/:sid
PATCH finance/v1/partners/:id/commission
GET  finance/v1/partner-finance-summary
