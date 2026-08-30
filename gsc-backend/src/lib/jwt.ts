import jwt from "jsonwebtoken";

export function signToken(payload, secret, expiresIn) {
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyToken(token, secret) {
  try {
    const payload: any = jwt.verify(token, secret);
    return payload;
  } catch (err) {
    console.error("Token verification failed:", err);
    return null;
  }
}

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", // false in local dev over http
  sameSite: "lax",
  path: "/auth/refresh-token", // only sent to this one endpoint, not every request
  maxAge: 5 * 24 * 60 * 60 * 1000, // keep this in sync with the "5d" refresh token expiry
};

export function setRefreshCookie(res, refreshToken) {
  res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);
}

export function setAdminSessionCookie(res, token) {
  res.cookie("adminSession", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  });
}

export function clearAdminSessionCookie(res) {
  res.clearCookie("adminSession", { path: "/admin" });
}
