export interface UssdRequest {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  /** Accumulated input, e.g. "" then "1" then "1*2" */
  text: string;
}

/** Response text always starts with "CON " (continue) or "END " (terminate). */
export type UssdResponse = string;
