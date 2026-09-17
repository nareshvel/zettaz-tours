/** Allowlisted Nest paths for the Expo crew client. Keep this narrower than `/api/gateway`. */
const UUID = "[a-f0-9-]{36}";

const paths: Record<string, RegExp> = {
  GET: new RegExp(
    `^(crew/v1/(today|board|board/${UUID}|departures/${UUID}/pickup-list|print-jobs/${UUID}/pdf|devices|offline/snapshot)|staff/v1/workspace/session)$`,
  ),
  POST: new RegExp(
    `^(auth/v1/(sign-in|sign-out|password-recovery/request)|staff/v1/crew/checkin-token/resolve|staff/v1/passengers/${UUID}/checkin|crew/v1/(walk-ups|print-jobs|devices|devices/${UUID}/revoke|offline/commands|departures/${UUID}/(events|operational-status)|bookings/${UUID}/payments)|ops/v1/passengers/${UUID}/waiver|ops/v1/departures/${UUID}/start)$`,
  ),
};

export function isCrewMobilePath(method: string, path: string): boolean {
  return Boolean(paths[method]?.test(path));
}
