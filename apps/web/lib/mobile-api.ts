/** Allowlisted Nest paths for the Expo crew client. Keep this narrower than `/api/gateway`. */
const UUID = "[a-f0-9-]{36}";

const paths: Record<string, RegExp> = {
  GET: new RegExp(`^crew/v1/today$`),
  POST: new RegExp(
    `^(auth/v1/(sign-in|sign-out|password-recovery/request)|staff/v1/crew/checkin-token/resolve|staff/v1/passengers/${UUID}/checkin|crew/v1/departures/${UUID}/events|ops/v1/passengers/${UUID}/waiver)$`,
  ),
};

export function isCrewMobilePath(method: string, path: string): boolean {
  return Boolean(paths[method]?.test(path));
}
