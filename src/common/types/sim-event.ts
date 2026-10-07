/** One line of the live event console (same shape as the original SimEvent). */
export interface SimEvent {
  at: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export function simEvent(level: SimEvent["level"], message: string, at = Date.now()): SimEvent {
  return { at: new Date(at).toISOString(), level, message };
}
