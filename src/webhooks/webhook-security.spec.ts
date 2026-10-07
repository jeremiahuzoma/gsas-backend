import { hmacHex, parseWebhookPayload, verifyWebhookSignature } from "./webhook-security.service";

const SECRET = "s3cret-webhook-key";
const BODY = "sessionId=ATUid_1&serviceCode=%2A384%2A1100%23&phoneNumber=%2B2348012345678&text=1";

describe("webhook signature verification", () => {
  it("accepts unsigned callbacks (recorded as unverified) when no secret is configured", () => {
    expect(verifyWebhookSignature("", BODY, { signature: "", token: "" })).toEqual({
      verified: false,
      allowed: true,
      reason: "no shared secret configured",
    });
  });

  it("accepts a valid HMAC-SHA256 of the raw body (case/whitespace tolerant)", () => {
    const sig = hmacHex(SECRET, BODY);
    expect(verifyWebhookSignature(SECRET, BODY, { signature: sig, token: "" }).verified).toBe(true);
    expect(
      verifyWebhookSignature(SECRET, BODY, { signature: ` ${sig.toUpperCase()} `, token: "" })
        .allowed,
    ).toBe(true);
  });

  it("rejects a signature computed over a different body", () => {
    const sig = hmacHex(SECRET, BODY + "&tampered=1");
    expect(verifyWebhookSignature(SECRET, BODY, { signature: sig, token: "" })).toMatchObject({
      allowed: false,
      reason: "signature mismatch",
    });
  });

  it("rejects a wrong signature even if a valid token is also supplied", () => {
    expect(
      verifyWebhookSignature(SECRET, BODY, { signature: "deadbeef", token: SECRET }).allowed,
    ).toBe(false);
  });

  it("falls back to the ?token= shared secret", () => {
    expect(verifyWebhookSignature(SECRET, BODY, { signature: "", token: SECRET })).toMatchObject({
      verified: true,
      reason: "url token ok",
    });
    expect(verifyWebhookSignature(SECRET, BODY, { signature: "", token: "wrong" }).allowed).toBe(
      false,
    );
    expect(verifyWebhookSignature(SECRET, BODY, { signature: "", token: "" }).reason).toBe(
      "missing signature",
    );
  });

  it("hmacHex matches a known vector", () => {
    // echo -n "abc" | openssl dgst -sha256 -hmac key
    expect(hmacHex("key", "abc")).toBe(
      "9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab",
    );
  });
});

describe("webhook body parsing", () => {
  it("parses form-encoded bodies", () => {
    expect(parseWebhookPayload(BODY, "application/x-www-form-urlencoded")).toEqual({
      sessionId: "ATUid_1",
      serviceCode: "*384*1100#",
      phoneNumber: "+2348012345678",
      text: "1",
    });
  });

  it("parses JSON bodies and stringifies values", () => {
    expect(parseWebhookPayload('{"id":"x","retryCount":2,"x":null}', "application/json")).toEqual({
      id: "x",
      retryCount: "2",
      x: "",
    });
  });

  it("returns an empty payload for invalid JSON", () => {
    expect(parseWebhookPayload("{oops", "application/json")).toEqual({});
  });
});
