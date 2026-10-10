const key = (eventId: string) => `sweep-aid-station-${eventId}`

/** The aid station this browser is focused on for an event (a stopKey), if any. */
export function storedStop(eventId: string): string | undefined {
  try { return localStorage.getItem(key(eventId)) ?? undefined } catch { return undefined }
}

export function rememberStop(eventId: string, stop: string | undefined) {
  try {
    if (stop === undefined) localStorage.removeItem(key(eventId))
    else localStorage.setItem(key(eventId), stop)
  } catch { /* storage unavailable: the choice just won't persist */ }
}
