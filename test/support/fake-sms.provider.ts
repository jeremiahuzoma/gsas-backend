import type { SmsProvider, SmsResult } from "../../src/communications/sms-provider.interface";

/** Records every send; results can be scripted per call. */
export class FakeSmsProvider implements SmsProvider {
  readonly name = "fake";
  readonly sent: Array<{ to: string; message: string }> = [];
  private scripted: SmsResult[] = [];
  private counter = 0;

  queue(...results: SmsResult[]) {
    this.scripted.push(...results);
  }

  reset() {
    this.sent.length = 0;
    this.scripted = [];
  }

  async sendSms(phoneNumber: string, message: string): Promise<SmsResult> {
    this.sent.push({ to: phoneNumber, message });
    const next = this.scripted.shift();
    if (next) return next;
    this.counter += 1;
    return {
      status: "SENT",
      providerMessageId: `FAKE-${this.counter}`,
      cost: "NGN 0",
      simulated: false,
    };
  }
}
