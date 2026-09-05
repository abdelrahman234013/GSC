import { prisma } from "../db";
import {
  hashPassword,
  comparePassword,
  hashToken,
  compareToken,
  isLegacyPasswordHash,
} from "../lib/password";
import { signToken, verifyToken as verifyJwt, TOKEN_PURPOSE } from "../lib/jwt";
import { sendEmail } from "../lib/mailer";
import { OAuth2Client } from "google-auth-library";
import { setRefreshCookie, clearRefreshCookie } from "../lib/jwt";
import {
  isValidPassword,
  isValidEmail,
  normalizeEmail,
} from "../lib/validation";
import {
  verificationEmail,
  passwordResetEmail,
  accountAlreadyExistsEmail,
} from "../lib/emailTemplates";
import { publicCustomer, resolveCustomerId } from "../lib/helperFunctions";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function createEmailVerificationToken(customerId) {
  return signToken(
    { customerId, type: "email_verification" },
    process.env.CUSTOMER_JWT_SECRET,
    "24h",
    TOKEN_PURPOSE.EMAIL_VERIFICATION,
  );
}

async function createToken(customerId) {
  const accessToken = signToken(
    { userId: customerId },
    process.env.CUSTOMER_JWT_SECRET,
    "15m",
    TOKEN_PURPOSE.CUSTOMER_ACCESS,
  );
  const refreshToken = signToken(
    { userId: customerId },
    process.env.CUSTOMER_REFRESH_SECRET,
    "5d",
    TOKEN_PURPOSE.CUSTOMER_REFRESH,
  );

  const refreshTokenHash = await hashToken(refreshToken);

  await prisma.customer.update({
    where: { id: customerId },
    data: { refreshTokenHash },
  });

  return { accessToken, refreshToken };
}

function registrationMessage(emailSent: boolean): string {
  return emailSent
    ? "Account created. Check your email to verify before logging in."
    : "Account created, but we couldn't send the verification email right now. Use \"resend verification\" once you're ready to verify.";
}

export async function register(req, res) {
  try {
    const { email, password, name, phone } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    if (!isValidEmail(email)) {
      return res
        .status(400)
        .json({ error: "Please enter a valid email address" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        error:
          "Password must be at least 8 characters and contain at least one letter and one number",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const existing = await prisma.customer.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      let noticeSent = true;
      try {
        const msg = accountAlreadyExistsEmail(
          `${process.env.FRONTEND_URL}/login`,
          `${process.env.FRONTEND_URL}/forgot-password`,
        );
        await sendEmail(existing.email, msg.subject, msg.html);
      } catch (emailErr) {
        noticeSent = false;
        console.error(
          "Duplicate-registration notice failed to send:",
          emailErr,
        );
      }

      return res.status(201).json({ message: registrationMessage(noticeSent) });
    }

    const passwordHash = await hashPassword(password);
    const customer = await prisma.customer.create({
      data: { email: normalizedEmail, passwordHash, name, phone },
    });

    let emailSent = true;
    try {
      const verifyToken = createEmailVerificationToken(customer.id);
      const verifyLink = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
      const verifyMsg = verificationEmail(verifyLink);
      await sendEmail(customer.email, verifyMsg.subject, verifyMsg.html);
    } catch (emailErr) {
      emailSent = false;
      console.error(
        "Account created but verification email failed to send:",
        emailErr,
      );
    }

    res.status(201).json({ message: registrationMessage(emailSent) });
  } catch (err) {
    console.error("POST /auth/register failed:", err);
    res.status(500).json({ error: "Failed to create account" });
  }
}

export async function verifyEmail(req, res) {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }

    let payload;
    try {
      payload = verifyJwt(
        token,
        process.env.CUSTOMER_JWT_SECRET,
        TOKEN_PURPOSE.EMAIL_VERIFICATION,
      );
    } catch {
      return res
        .status(401)
        .json({ error: "Invalid or expired verification link" });
    }

    if (
      payload.type !== "email_verification" ||
      typeof payload.customerId !== "string" ||
      payload.customerId.length === 0
    ) {
      return res.status(401).json({ error: "Invalid verification link" });
    }

    await prisma.customer.update({
      where: { id: payload.customerId },
      data: { emailVerifiedAt: new Date() },
    });

    res.json({ message: "Email verified — you can now log in" });
  } catch (err) {
    console.error("GET /auth/verify-email failed:", err);
    res.status(500).json({ error: "Failed to verify email" });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const customer = await prisma.customer.findUnique({
      where: { email: normalizedEmail },
    });

    if (!customer?.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await comparePassword(password, customer.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (isLegacyPasswordHash(customer.passwordHash)) {
      try {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { passwordHash: await hashPassword(password) },
        });
      } catch (upgradeErr) {
        console.error("Password hash upgrade failed:", upgradeErr);
      }
    }

    if (!customer.emailVerifiedAt) {
      return res
        .status(403)
        .json({ error: "Please verify your email before logging in" });
    }

    const tokens = await createToken(customer.id);
    setRefreshCookie(res, tokens.refreshToken);
    res.json({
      customer: publicCustomer(customer),
      accessToken: tokens.accessToken,
    });
  } catch (err) {
    console.error("POST /auth/login failed:", err);
    res.status(500).json({ error: "Failed to log in" });
  }
}

export async function logout(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    await prisma.customer.update({
      where: { id: customerId },
      data: { refreshTokenHash: null },
    });
    clearRefreshCookie(res);
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error("POST /auth/logout failed:", err);
    res.status(500).json({ error: "Failed to log out" });
  }
}

export async function refreshToken(req, res) {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(400).json({ error: "refreshToken cookie is missing" });
    }

    let payload;
    try {
      payload = verifyJwt(
        token,
        process.env.CUSTOMER_REFRESH_SECRET,
        TOKEN_PURPOSE.CUSTOMER_REFRESH,
      );
    } catch {
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    if (typeof payload.userId !== "string" || payload.userId.length === 0) {
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: payload.userId },
    });
    if (
      !customer?.refreshTokenHash ||
      !(await compareToken(token, customer.refreshTokenHash))
    ) {
      return res
        .status(401)
        .json({ error: "Refresh token is no longer valid" });
    }

    const tokens = await createToken(customer.id);
    setRefreshCookie(res, tokens.refreshToken);
    res.json({ accessToken: tokens.accessToken });
  } catch (err) {
    console.error("POST /auth/refresh-token failed:", err);
    res.status(500).json({ error: "Failed to refresh token" });
  }
}

export async function forgotPassword(req, res) {
  try {
    const { email } = req.body ?? {};
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const customer = await prisma.customer.findUnique({
      where: { email: normalizedEmail },
    });

    if (customer) {
      try {
        const resetToken = signToken(
          { customerId: customer.id, type: "password_reset" },
          process.env.CUSTOMER_JWT_SECRET,
          "15m",
          TOKEN_PURPOSE.PASSWORD_RESET,
        );

        await prisma.customer.update({
          where: { id: customer.id },
          data: { passwordResetTokenHash: hashToken(resetToken) },
        });
        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        const resetMsg = passwordResetEmail(resetLink);
        await sendEmail(customer.email, resetMsg.subject, resetMsg.html);
      } catch (emailErr) {
        console.error(
          "Password reset requested but email failed to send:",
          emailErr,
        );
      }
    }

    res.json({
      message: "If that email is registered, a reset link has been sent.",
    });
  } catch (err) {
    console.error("POST /auth/forgot-password failed:", err);
    res.status(500).json({ error: "Failed to process request" });
  }
}

export async function resetPassword(req, res) {
  try {
    const { token, password } = req.body ?? {};
    if (!token || !password) {
      return res.status(400).json({ error: "token and password are required" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        error:
          "Password must be at least 8 characters and contain at least one letter and one number",
      });
    }

    let payload;
    try {
      payload = verifyJwt(
        token,
        process.env.CUSTOMER_JWT_SECRET,
        TOKEN_PURPOSE.PASSWORD_RESET,
      );
    } catch {
      return res.status(401).json({ error: "Invalid or expired reset token" });
    }

    if (
      payload.type !== "password_reset" ||
      typeof payload.customerId !== "string" ||
      payload.customerId.length === 0
    ) {
      return res.status(401).json({ error: "Invalid reset token" });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: payload.customerId },
      select: { id: true, passwordResetTokenHash: true },
    });

    if (
      !customer?.passwordResetTokenHash ||
      !compareToken(token, customer.passwordResetTokenHash)
    ) {
      return res
        .status(401)
        .json({ error: "This reset link has already been used or expired" });
    }

    const passwordHash = await hashPassword(password);
    const updated = await prisma.customer.updateMany({
      where: {
        id: customer.id,
        passwordResetTokenHash: customer.passwordResetTokenHash,
      },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        refreshTokenHash: null,
      },
    });

    if (updated.count === 0) {
      return res
        .status(401)
        .json({ error: "This reset link has already been used or expired" });
    }

    res.json({ message: "Password updated" });
  } catch (err) {
    console.error("POST /auth/reset-password failed:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
}

export async function google(req, res) {
  try {
    const { idToken } = req.body ?? {};
    if (!idToken) {
      return res.status(400).json({ error: "idToken is required" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      return res.status(401).json({ error: "Could not verify Google account" });
    }

    const normalizedEmail = normalizeEmail(payload.email);
    let customer = await prisma.customer.findUnique({
      where: { email: normalizedEmail },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          email: normalizedEmail,
          name: payload.name,
          googleId: payload.sub,
          emailVerifiedAt: new Date(),
        },
      });
    } else if (!customer.googleId) {
      // Existing email/password account, now also linking Google sign-in.
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          googleId: payload.sub,
          emailVerifiedAt: customer.emailVerifiedAt ?? new Date(),
        },
      });
    }

    const tokens = await createToken(customer.id);
    setRefreshCookie(res, tokens.refreshToken);
    res.json({
      customer: publicCustomer(customer),
      accessToken: tokens.accessToken,
    });
  } catch (err) {
    console.error("POST /auth/google failed:", err);
    res.status(500).json({ error: "Google sign-in failed" });
  }
}

export async function getUserInfo(req, res) {
  try {
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(publicCustomer(customer));
  } catch (err) {
    console.error("GET /auth/me failed:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

export async function resendVerification(req, res) {
  try {
    const { email } = req.body ?? {};
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const customer = await prisma.customer.findUnique({
      where: { email: normalizedEmail },
    });

    if (customer && !customer.emailVerifiedAt) {
      try {
        const verifyToken = createEmailVerificationToken(customer.id);
        const verifyLink = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
        const verifyMsg = verificationEmail(verifyLink);
        await sendEmail(customer.email, verifyMsg.subject, verifyMsg.html);
      } catch (emailErr) {
        console.error(
          "Verification resend requested but email failed to send:",
          emailErr,
        );
      }
    }

    res.json({
      message:
        "If that email is registered and not yet verified, a new verification link has been sent.",
    });
  } catch (err) {
    console.error("POST /auth/resend-verification failed:", err);
    res.status(500).json({ error: "Failed to resend verification email" });
  }
}
