import "server-only";

import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { authEmailIsConfigured, sendAuthEmail } from "./auth-email.ts";
import { postgres } from "./postgres.ts";

const publicUrl =
  process.env.BETTER_AUTH_URL ??
  process.env.ROLEATLAS_PUBLIC_URL ??
  "http://localhost:3000";

const authSecret = process.env.BETTER_AUTH_SECRET ?? (
  process.env.NEXT_PHASE === "phase-production-build"
    ? "roleatlas-build-time-placeholder-never-used-at-runtime"
    : undefined
);

if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error("BETTER_AUTH_SECRET is required at runtime.");
}

const configuredOrigins = (
  process.env.AUTH_TRUSTED_ORIGINS ?? publicUrl
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const emailVerificationRequired =
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === "true";

if (emailVerificationRequired && !authEmailIsConfigured()) {
  throw new Error(
    "AUTH_REQUIRE_EMAIL_VERIFICATION=true requires SMTP_HOST to be configured.",
  );
}

const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

async function recordAuthEvent(
  userId: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
) {
  await postgres.query(
    "INSERT INTO audit_events (actor_user_id, subject_user_id, event_type, metadata) VALUES ($1,$1,$2,$3)",
    [userId, eventType, JSON.stringify(metadata)],
  );
}

function deletedSubjectFingerprint(userId: string) {
  return createHash("sha256")
    .update(`roleatlas-deleted-subject:${userId}`)
    .digest("hex")
    .slice(0, 32);
}

export const auth = betterAuth({
  appName: "RoleAtlas",
  baseURL: publicUrl,
  basePath: "/api/auth",
  secret: authSecret,
  database: postgres,
  trustedOrigins: configuredOrigins,
  advanced: {
    database: {
      generateId: "uuid",
    },
    useSecureCookies: process.env.NODE_ENV === "production",
    ipAddress: {
      ipAddressHeaders: [process.env.AUTH_CLIENT_IP_HEADER ?? "x-real-ip"],
    },
  },
  user: {
    modelName: "roleatlas_users",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
      image: "image_url",
    },
    additionalFields: {
      role: {
        type: ["user", "admin"],
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user, request) => {
        await postgres.query(
          "INSERT INTO audit_events (actor_user_id, subject_user_id, event_type, request_id, user_agent, metadata) VALUES ($1,$1,'account.delete',$2,$3,$4)",
          [
            user.id,
            request?.headers.get("x-request-id") ?? null,
            request?.headers.get("user-agent")?.slice(0, 500) ?? null,
            JSON.stringify({
              subjectFingerprint: deletedSubjectFingerprint(user.id),
            }),
          ],
        );
      },
    },
  },
  session: {
    modelName: "auth_sessions",
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
  },
  account: {
    modelName: "auth_accounts",
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      idToken: "id_token",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "auth_verifications",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: emailVerificationRequired,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your RoleAtlas password",
        text: `Use this link to reset your RoleAtlas password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: emailVerificationRequired,
    sendOnSignIn: emailVerificationRequired,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Verify your RoleAtlas email",
        text: `Use this link to verify your RoleAtlas email: ${url}`,
      });
    },
  },
  socialProviders:
    githubClientId && githubClientSecret
      ? {
          github: {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
          },
        }
      : {},
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await recordAuthEvent(user.id, "account.created");
        },
      },
      update: {
        after: async (user) => {
          await recordAuthEvent(user.id, "account.updated");
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await recordAuthEvent(session.userId, "session.created", {
            sessionId: session.id,
          });
        },
      },
      delete: {
        before: async (session) => {
          await recordAuthEvent(session.userId, "session.revoked", {
            sessionId: session.id,
          });
        },
      },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "auth_rate_limits",
    fields: {
      lastRequest: "last_request",
    },
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 10, max: 5 },
      "/request-password-reset": { window: 60 * 10, max: 3 },
    },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
