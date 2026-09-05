/**
 * Cookie Helper Utility
 * Centralizes all auth cookie operations for secure httpOnly cookie-based authentication.
 */

const isProduction = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  accessToken: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 30 * 60 * 1000, // 30 minutes
    path: '/',
  },
  refreshToken: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/refreshtoken',
  },
  adminAccessToken: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 2 * 60 * 60 * 1000, // 2 hours
    path: '/',
  },
};

/**
 * Sets httpOnly auth cookies on the response for user authentication.
 * @param {import('express').Response} res
 * @param {string} accessToken
 * @param {string} refreshToken
 */
export const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie('accessToken', accessToken, COOKIE_OPTIONS.accessToken);
  res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS.refreshToken);
};

/**
 * Clears all user auth cookies from the response.
 * @param {import('express').Response} res
 */
export const clearAuthCookies = (res) => {
  res.cookie('accessToken', '', { ...COOKIE_OPTIONS.accessToken, maxAge: 0 });
  res.cookie('refreshToken', '', { ...COOKIE_OPTIONS.refreshToken, maxAge: 0 });
};

/**
 * Sets the admin access token cookie.
 * @param {import('express').Response} res
 * @param {string} token
 */
export const setAdminCookie = (res, token) => {
  res.cookie('adminAccessToken', token, COOKIE_OPTIONS.adminAccessToken);
};

/**
 * Clears the admin access token cookie.
 * @param {import('express').Response} res
 */
export const clearAdminCookie = (res) => {
  res.cookie('adminAccessToken', '', { ...COOKIE_OPTIONS.adminAccessToken, maxAge: 0 });
};
