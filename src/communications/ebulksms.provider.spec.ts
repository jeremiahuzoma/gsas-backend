import { EbulkSmsProvider } from "./ebulksms.provider";
import { normalisePhone } from "./phone";
import type { ProviderConfig } from "./provider-config";

const config: ProviderConfig = {
  username: "ebulk-user",
  apiKey: "ebulk-test-key",
  jsonUrl: "https://api.ebulksms.com/sendsms.json",
  senderId: "GSAS",
  serviceCode: "*384*1100#",
  webhookSecret: "",
  configured: true,
};

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("normalisePhone", () => {
  it.each([
    ["08012345678", "+2348012345678"],
    ["0801 234 5678", "+2348012345678"],
    ["2348012345678", "+2348012345678"],
    ["+2348012345678", "+2348012345678"],
    ["(0801)-234-5678", "+2348012345678"],
  ])("%s -> %s", (raw, expected) => expect(normalisePhone(raw)).toBe(expected));

  it.each(["12345", "8012345678", "abc", "+234"])("rejects %s", (raw) =>
    expect(normalisePhone(raw)).toBeNull(),
  );
});

describe("EbulkSmsProvider", () => {
  const noSleep = async () => undefined;

  it("posts the JSON API payload with the configured credentials and sender", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response(200, {
        response: { status: "OK", success: "1", failed: "0", smsid: "EB-123", cost: "2.20" },
      }),
    );
    const provider = new EbulkSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    );

    const result = await provider.sendSms("08012345678", "hello");

    expect(result).toMatchObject({
      status: "SENT",
      providerMessageId: "EB-123",
      cost: "2.20",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(config.jsonUrl);
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.SMS).toMatchObject({
      auth: { username: "ebulk-user", apikey: "ebulk-test-key" },
      message: { sender: "GSAS", messagetext: "hello", flash: "0" },
      recipients: { gsm: [{ msidn: "2348012345678" }] },
    });
    expect(body.SMS.recipients.gsm[0].msgid).toEqual(expect.any(String));
  });

  it("retries transient HTTP failures and reports them as retriable", async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(503, { error: "down" }));
    const result = await new EbulkSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    ).sendSms("08012345678", "x");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ status: "FAILED", retriable: true });
  });

  it("does not retry provider-level rejections", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response(200, { response: { status: "ERROR", message: "Invalid sender" } }),
    );
    const result = await new EbulkSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    ).sendSms("08012345678", "x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "FAILED",
      retriable: false,
      failureReason: "Invalid sender",
    });
  });

  it("does not mark a failed recipient as sent when the API status is OK", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response(200, { response: { status: "OK", success: "0", failed: "1" } }),
    );
    const result = await new EbulkSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    ).sendSms("08012345678", "x");
    expect(result).toMatchObject({ status: "FAILED", retriable: false });
  });

  it("never calls the provider for an invalid number", async () => {
    const fetchMock = jest.fn();
    const result = await new EbulkSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    ).sendSms("123", "x");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "FAILED",
      failureReason: "Invalid phone number",
      retriable: false,
    });
  });
});
