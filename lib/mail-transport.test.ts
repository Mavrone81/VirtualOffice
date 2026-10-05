import { describe, it, expect, vi, afterEach } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";

/** Real transport construction, deliberately NOT mocked.
 *
 *  🔴 Every other test that touches mail does `vi.mock("@/lib/mail")` — all 14 of them —
 *  and lib/mail.test.ts only renders a template (approvalEmail). So before this file the
 *  suite had ZERO coverage of transporter(): nodemailer.createTransport was never called
 *  in a test run. A renamed transport option, a changed default export, or a transport
 *  that throws on construction would have been invisible to a green suite and visible
 *  only to whoever next tried to reset a password.
 *
 *  These tests drive the app's OWN sendMail against a minimal in-process SMTP server, so
 *  the assertions are on the SMTP conversation the library actually produced. That is what
 *  makes a renamed option detectable: if `host`/`port`/`secure`/`auth.user`/`auth.pass`
 *  stopped being the names nodemailer reads, the connection or the AUTH command changes
 *  shape here and the test fails, rather than passing against a mock that cannot know.
 *
 *  All addresses are deliberately fake (.invalid / example.com per RFC 2606 and RFC 6761).
 *  Nothing here sets EMAIL_FROM or any SMTP_* production value — the env is stubbed per
 *  test and unstubbed afterwards.
 */

/** Bind the test relay to a loopback alias, NOT 127.0.0.1.
 *
 *  🔴 This address is load-bearing, and a mutation test is what revealed it. With the
 *  server on 127.0.0.1, renaming lib/mail.ts's `host:` option to anything else still
 *  PASSED every assertion here — nodemailer defaults a missing host to localhost, so the
 *  send landed on the test server anyway and the transcript looked perfect. The test was
 *  green for a transport that had lost its host option entirely.
 *
 *  On 127.0.0.2 the default no longer reaches the relay: if `host` stops being read, the
 *  connection is refused and the test fails. Re-verified by mutation after the move. */
const RELAY_HOST = "127.0.0.2";

type Server = {
  port: number;
  /** Command lines the server received, excluding the DATA payload. */
  commands: string[];
  /** The message body as submitted between DATA and the terminating dot. */
  body: () => string;
  close: () => Promise<void>;
};

/** A minimal ESMTP server: enough of the protocol for nodemailer to complete a send,
 *  and a transcript so the test can assert what the library actually sent. */
async function startSmtpServer(opts: { advertiseAuth?: boolean } = {}): Promise<Server> {
  const commands: string[] = [];
  let payload = "";

  const server = net.createServer((sock) => {
    let inData = false;
    let buf = "";
    sock.setEncoding("utf8");
    sock.write("220 smtp.test ESMTP ready\r\n");

    sock.on("data", (chunk: string) => {
      buf += chunk;
      for (let nl = buf.indexOf("\r\n"); nl >= 0; nl = buf.indexOf("\r\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            sock.write("250 2.0.0 Ok: queued as TEST\r\n");
          } else {
            // RFC 5321 transparency: a leading doubled dot is unstuffed.
            payload += (line.startsWith("..") ? line.slice(1) : line) + "\n";
          }
          continue;
        }

        commands.push(line);
        const verb = line.toUpperCase();
        if (verb.startsWith("EHLO")) {
          const auth = opts.advertiseAuth === false ? "" : "250-AUTH PLAIN LOGIN\r\n";
          sock.write(`250-smtp.test greets you\r\n${auth}250 SIZE 10485760\r\n`);
        } else if (verb.startsWith("HELO")) {
          sock.write("250 smtp.test\r\n");
        } else if (verb.startsWith("AUTH")) {
          sock.write("235 2.7.0 Authentication successful\r\n");
        } else if (verb.startsWith("MAIL FROM")) {
          sock.write("250 2.1.0 Sender ok\r\n");
        } else if (verb.startsWith("RCPT TO")) {
          sock.write("250 2.1.5 Recipient ok\r\n");
        } else if (verb === "DATA") {
          inData = true;
          sock.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (verb.startsWith("QUIT")) {
          sock.write("221 2.0.0 Bye\r\n");
          sock.end();
        } else {
          sock.write("250 2.0.0 Ok\r\n");
        }
      }
    });
    // A transport that hangs up mid-conversation must not take the run down.
    sock.on("error", () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, RELAY_HOST, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    commands,
    body: () => payload,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Load a FRESH lib/mail against the given SMTP env.
 *
 *  Two things make the reset mandatory: lib/env.ts parses process.env at import, and
 *  lib/mail.ts memoises the transporter in a module-level `cached`. Without resetModules
 *  the second test in this file would reuse the first test's transport. */
async function loadMail(smtpEnv: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(smtpEnv)) {
    if (v === undefined) vi.stubEnv(k, undefined as unknown as string);
    else vi.stubEnv(k, v);
  }
  return import("./mail");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sendMail — real nodemailer transport (no mock)", () => {
  it("constructs a working SMTP transport and completes the conversation", async () => {
    const smtp = await startSmtpServer({ advertiseAuth: false });
    try {
      const { sendMail } = await loadMail({
        SMTP_HOST: RELAY_HOST,
        SMTP_PORT: String(smtp.port),
        SMTP_SECURE: "false",
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
      });

      const result = await sendMail({
        to: "recipient@example.invalid",
        subject: "Transport construction probe",
        html: "<p>Hello from the transport test.</p>",
      });

      // The contract lib/mail.ts documents: handed to a relay.
      expect(result).toEqual({ sent: true });

      // Assert on the protocol, not on a mock: these lines exist only because
      // createTransport read `host`/`port` under those exact names.
      const transcript = smtp.commands.join("\n");
      expect(transcript).toMatch(/^EHLO /m);
      expect(transcript).toMatch(/^MAIL FROM:<[^>]+>/m);
      expect(transcript).toContain("RCPT TO:<recipient@example.invalid>");
      expect(smtp.commands).toContain("DATA");

      // The message really was serialised through the library.
      expect(smtp.body()).toContain("Transport construction probe");
      expect(smtp.body()).toContain("To: recipient@example.invalid");
    } finally {
      await smtp.close();
    }
  }, 20_000);

  it("sends credentials when SMTP_USER/SMTP_PASSWORD are set (auth option names)", async () => {
    const smtp = await startSmtpServer({ advertiseAuth: true });
    try {
      const { sendMail } = await loadMail({
        SMTP_HOST: RELAY_HOST,
        SMTP_PORT: String(smtp.port),
        SMTP_SECURE: "false",
        SMTP_USER: "probe-user",
        SMTP_PASSWORD: "probe-pass",
      });

      const result = await sendMail({
        to: "auth-probe@example.invalid",
        subject: "Auth option probe",
        html: "<p>auth</p>",
      });
      expect(result).toEqual({ sent: true });

      // An AUTH command at all proves `auth` was accepted as a transport option;
      // the decoded payload proves `user`/`pass` are still the field names read.
      const authLine = smtp.commands.find((c) => c.toUpperCase().startsWith("AUTH"));
      expect(authLine, "transport sent no AUTH command").toBeDefined();

      const b64 = authLine!.split(/\s+/)[2];
      expect(b64, `no credential payload in: ${authLine}`).toBeDefined();
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      expect(decoded).toContain("probe-user");
      expect(decoded).toContain("probe-pass");
    } finally {
      await smtp.close();
    }
  }, 20_000);

  it("reports a send failure as { sent: false, error } rather than throwing", async () => {
    // A port that was listening and is now closed refuses immediately.
    const dead = await startSmtpServer();
    const deadPort = dead.port;
    await dead.close();

    const { sendMail } = await loadMail({
      SMTP_HOST: RELAY_HOST,
      SMTP_PORT: String(deadPort),
      SMTP_SECURE: "false",
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
    });

    const result = await sendMail({
      to: "nobody@example.invalid",
      subject: "Failure path probe",
      html: "<p>fail</p>",
    });

    // sendMail's documented promise: it never throws, and a failure carries a
    // readable message. This is the assertion that would catch an error object
    // that stopped being an Error (the `e instanceof Error` branch).
    expect(result.sent).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  }, 20_000);

  it("actually applies SMTP_SECURE (TLS attempted against a plaintext relay fails)", async () => {
    // 🔴 This case exists because the mutation matrix found a hole: with
    // SMTP_SECURE=false everywhere, renaming lib/mail.ts's `secure:` option changed
    // nothing — false IS nodemailer's default, so every other test here stayed green
    // for a transport that no longer read the option at all.
    //
    // Proving `secure` is wired without a certificate: point a secure transport at a
    // PLAINTEXT relay. A client that honours secure:true opens with a TLS handshake,
    // the plaintext relay answers with "220 ..." which is not a TLS record, and the
    // send fails. A client that has LOST the option speaks plain SMTP and succeeds —
    // so success here is the failure signal.
    const smtp = await startSmtpServer({ advertiseAuth: false });
    try {
      const { sendMail } = await loadMail({
        SMTP_HOST: RELAY_HOST,
        SMTP_PORT: String(smtp.port),
        SMTP_SECURE: "true",
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
      });

      const result = await sendMail({
        to: "tls-probe@example.invalid",
        subject: "Secure flag probe",
        html: "<p>tls</p>",
      });

      expect(
        result.sent,
        "secure:true reached a plaintext relay successfully — the SMTP_SECURE option is not being applied",
      ).toBe(false);
      expect(typeof result.error).toBe("string");
      // 🔴 Asserted as an EXACT COUNT, not as `not.toContain("DATA")`.
      // Instrumenting this case showed the relay records 0 command rows: the TLS
      // handshake fails before any SMTP verb is sent. On an empty transcript a
      // `not.toContain` passes vacuously and proves nothing, so it is the wrong
      // shape of assertion here. The count is the real claim: a transport that
      // had lost `secure` would speak plain SMTP and leave 4 rows behind.
      expect(smtp.commands).toHaveLength(0);
    } finally {
      await smtp.close();
    }
  }, 20_000);

  it("stays a no-op when SMTP is not configured", async () => {
    const { sendMail } = await loadMail({
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
    });

    const result = await sendMail({
      to: "skipped@example.invalid",
      subject: "Unconfigured probe",
      html: "<p>skip</p>",
    });

    // Unconfigured must be a silent skip, not an error: dev, CI and the Docker
    // build all run without a relay (see the comment at the top of lib/mail.ts).
    expect(result).toEqual({ sent: false });
  }, 20_000);
});
