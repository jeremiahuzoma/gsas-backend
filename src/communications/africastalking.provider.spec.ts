import { AfricaTalkingSmsProvider } from "./africastalking.provider";
import { normalisePhone } from "./phone";
import type { ProviderConfig } from "./provider-config";

const config: ProviderConfig = {
  username: "sandbox",
  apiKey: "atsk_test",
  environment: "sandbox",
  senderId: "WATTSUP",
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

const accepted = {
  SMSMessageData: {
    Recipients: [{ statusCode: 101, status: "Success", messageId: "ATXid_1", cost: "NGN 2.20" }],
  },
};

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

describe("AfricaTalkingSmsProvider", () => {
  const noSleep = async () => undefined;

  it("posts to the sandbox endpoint with sender id and API key header", async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(201, accepted));
    const provider = new AfricaTalkingSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    );
    const result = await provider.sendSms("08012345678", "hello");
    expect(result).toMatchObject({
      status: "SENT",
      providerMessageId: "ATXid_1",
      cost: "NGN 2.20",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sandbox.africastalking.com/version1/messaging");
    expect(init.headers.apiKey).toBe("atsk_test");
    const body = new URLSearchParams(init.body);
    expect(body.get("to")).toBe("+2348012345678");
    expect(body.get("from")).toBe("WATTSUP");
    expect(body.get("username")).toBe("sandbox");
  });

  it("uses the live endpoint when AFRICASTALKING_ENVIRONMENT is production", async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(201, accepted));
    await new AfricaTalkingSmsProvider(
      { ...config, environment: "production" },
      fetchMock as unknown as typeof fetch,
      noSleep,
    ).sendSms("+2348012345678", "x");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.africastalking.com/version1/messaging");
  });

  it("retries transient failures in-request (3 attempts) and reports them as retriable", async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(503, { error: "down" }));
    const result = await new AfricaTalkingSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    ).sendSms("08012345678", "x");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ status: "FAILED", retriable: true });
  });

  it("does not retry permanent rejections", async () => {
    const rejected = {
      SMSMessageData: { Recipients: [{ statusCode: 403, status: "InvalidPhoneNumber" }] },
    };
    const fetchMock = jest.fn().mockResolvedValue(response(201, rejected));
    const result = await new AfricaTalkingSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    ).sendSms("08012345678", "x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "FAILED",
      retriable: false,
      failureReason: "InvalidPhoneNumber",
    });
  });

  it("treats gateway status codes 405/406/407/500/501 as transient", async () => {
    const gateway = {
      SMSMessageData: { Recipients: [{ statusCode: 406, status: "UserInBlacklist" }] },
    };
    const fetchMock = jest.fn().mockResolvedValue(response(201, gateway));
    const result = await new AfricaTalkingSmsProvider(
      config,
      fetchMock as unknown as typeof fetch,
      noSleep,
    ).sendSms("08012345678", "x");
    expect(result.retriable).toBe(true);
  });

  it("never calls the provider for an invalid number", async () => {
    const fetchMock = jest.fn();
    const result = await new AfricaTalkingSmsProvider(
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
