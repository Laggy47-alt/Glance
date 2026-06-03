// Backend watchdog disabled: we no longer auto-redirect to /offline when the
// backend appears unreachable. Users can navigate to /offline manually via the
// emergency admin credentials if needed.
export function BackendWatchdog() {
  return null;
}
