import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyDigest } from "../lib/notifications/digest.ts";
import { CaptureTransport, SmtpTransport } from "../lib/notifications/email.ts";

test("digest copy separates attention items from a quiet week", () => {
  const busy = buildWeeklyDigest({
    generatedAt: "2026-08-23T10:00:00.000Z",
    followUpsDue: [{ title: "Platform Analyst at Example", nextAction: "Email the recruiter." }],
    savedJobClosures: [{ title: "Content Designer", closed: false }],
    unseenStrongMatches: 3,
  });
  assert.match(busy.subject, /2026-08-23/);
  assert.match(busy.text, /Follow-ups due \(1\)/);
  assert.match(busy.text, /Platform Analyst at Example — Email the recruiter\./);
  assert.match(busy.text, /Content Designer may have closed/);
  assert.match(busy.text, /3 highly ranked roles .* have not been reviewed/);
  assert.match(busy.text, /Open RoleAtlas to act on any of these\./);

  const quiet = buildWeeklyDigest({
    generatedAt: "2026-08-23T10:00:00.000Z",
    followUpsDue: [],
    savedJobClosures: [],
    unseenStrongMatches: 0,
  });
  assert.match(quiet.text, /Nothing needs your attention this week/);
  assert.doesNotMatch(quiet.text, /Follow-ups due/);
});

test("singular counts read naturally", () => {
  const single = buildWeeklyDigest({
    generatedAt: "2026-08-23T00:00:00.000Z",
    followUpsDue: [],
    savedJobClosures: [],
    unseenStrongMatches: 1,
  });
  assert.match(single.text, /1 highly ranked role from recent searches has not been reviewed/);
});

test("capture transport records without any network path", async () => {
  const transport = new CaptureTransport();
  const result = await transport.send({ to: "fixture@example.test", subject: "s", text: "b" });
  assert.equal(result.delivered, true);
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].to, "fixture@example.test");
});

test("smtp failures report delivered:false and never throw", async () => {
  const failingMailer = {
    createTransport: () => ({
      sendMail: async () => {
        throw new Error("connection refused by relay");
      },
    }),
  };
  const transport = new SmtpTransport("smtp://relay.invalid:25", "no-reply@example.test", failingMailer);
  const result = await transport.send({ to: "user@example.test", subject: "s", text: "b" });
  assert.equal(result.delivered, false);
  if (!result.delivered) assert.match(result.error, /connection refused/);
});

test("successful smtp sends surface the provider message id", async () => {
  const recording: Array<Record<string, string>> = [];
  const mailer = {
    createTransport: () => ({
      sendMail: async (mail: Record<string, string>) => {
        recording.push(mail);
        return { messageId: "<digest-1@example.test>" };
      },
    }),
  };
  const transport = new SmtpTransport("smtp://relay.invalid:25", "no-reply@example.test", mailer);
  const result = await transport.send({ to: "user@example.test", subject: "Weekly briefing", text: "body" });
  assert.equal(result.delivered, true);
  assert.equal(result.delivered && result.messageId, "<digest-1@example.test>");
  assert.equal(recording[0].from, "no-reply@example.test");
});
