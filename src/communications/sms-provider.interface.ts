export interface SmsResult {
  status: "SENT" | "QUEUED" | "FAILED";
  providerMessageId?: string | undefined;
  cost?: string | undefined;
  failureReason?: string | undefined;
  /** true when the failure is transient and the message should be retried */
  retriable?: boolean;
  simulated: boolean;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(phoneNumber: string, message: string): Promise<SmsResult>;
}

/** DI token for the active SMS provider. */
export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
