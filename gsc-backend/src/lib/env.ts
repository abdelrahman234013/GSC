import { z } from "zod";

// Startup environment validation.
//
// Secrets used to be read into module-level constants at import time, so a
// missing or mistyped CUSTOMER_JWT_SECRET let the process boot happily, report
// healthy to the load balancer, and then fail on the first real request — with an
// error that pointed at token verification rather than at the deploy config.
// Deployment is exactly when these get mistyped.
//
// This module runs for its side effect: index.ts imports it immediately after
// dotenv, BEFORE any route or controller is imported. Module bodies evaluate in
// import order, so a bad environment is reported here rather than surfacing later
// as a confusing failure deeper in the stack (e.g. supabaseStorage constructing a
// StorageClient from an undefined URL).
//
// Fail loudly at boot, never quietly at runtime.

const isProduction = process.env.NODE_ENV === "production";

// 32 characters is not a policy invented here — it is roughly the point below
// which an HMAC secret becomes brute-forceable. A short "secret" is worse than a
// missing one, because nothing looks broken.
const secret = z
  .string()
  .min(32, "must be at least 32 characters — generate with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");

const url = z.string().url("must be a full URL including https://");

/**
 * Required everywhere: without these the app cannot serve a single request.
 */
const baseSchema = z.object({
  DATABASE_URL: z.string().min(1, "is required"),
  CUSTOMER_JWT_SECRET: secret,
  CUSTOMER_REFRESH_SECRET: secret,
  ADMIN_JWT_SECRET: secret,
  // Also the CORS allowlist and the admin CSRF origin check, so an empty value
  // means every browser request is rejected — see the note in lib/origins.ts.
  FRONTEND_URL: url,
});

/**
 * Required in production only.
 *
 * These gate features rather than the whole app — uploads and email — so a
 * developer can run the API locally without a Supabase project or a Resend key.
 * In production their absence is a broken deployment, not a choice.
 */
const productionSchema = z.object({
  RESEND_API_KEY: z.string().min(1, "is required in production (email will not send without it)"),
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "is required in production (uploads will fail without it)"),
});

function reportAndExit(issues: string[]): never {
  console.error(
    "\nFATAL: the environment is not configured correctly.\n\n" +
      issues.map((i) => `  - ${i}`).join("\n") +
      "\n\nSee .env.example for what each variable does.\n" +
      "The process is exiting rather than starting in a broken state.\n",
  );
  process.exit(1);
}

export function validateEnv() {
  const issues: string[] = [];

  const base = baseSchema.safeParse(process.env);
  if (!base.success) {
    for (const issue of base.error.issues) {
      issues.push(`${issue.path.join(".")} ${issue.message}`);
    }
  }

  if (isProduction) {
    const prod = productionSchema.safeParse(process.env);
    if (!prod.success) {
      for (const issue of prod.error.issues) {
        issues.push(`${issue.path.join(".")} ${issue.message}`);
      }
    }

    // Catches the specific mistake of copying .env.example verbatim and
    // deploying it — a placeholder is a value, so a presence check alone
    // would pass.
    if (process.env.SUPABASE_URL?.includes("your-project")) {
      issues.push("SUPABASE_URL still contains the .env.example placeholder");
    }
    if (process.env.DATABASE_URL?.includes("gsc:gsc@db:5432")) {
      issues.push(
        "DATABASE_URL still points at the local docker-compose database",
      );
    }
    if (process.env.FRONTEND_URL?.includes("localhost")) {
      issues.push("FRONTEND_URL still points at localhost");
    }
  }

  // Reusing one secret for two purposes collapses the separation that keeps a
  // password-reset token from being accepted as a session — see lib/jwt.ts.
  const secrets = [
    process.env.CUSTOMER_JWT_SECRET,
    process.env.CUSTOMER_REFRESH_SECRET,
    process.env.ADMIN_JWT_SECRET,
  ].filter(Boolean);
  if (secrets.length === 3 && new Set(secrets).size !== 3) {
    issues.push(
      "CUSTOMER_JWT_SECRET, CUSTOMER_REFRESH_SECRET and ADMIN_JWT_SECRET must " +
        "each be a different value",
    );
  }

  if (issues.length > 0) reportAndExit(issues);

  console.log(
    `Environment validated (${isProduction ? "production" : "development"}).`,
  );
}

validateEnv();
