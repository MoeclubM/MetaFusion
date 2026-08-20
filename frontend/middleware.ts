import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, localeCookieName, normalizeLocale, parseAcceptLanguage } from "./src/i18n/routing";

export function middleware(req: NextRequest) {
  const cookieLocale = req.cookies.get(localeCookieName)?.value || null;
  const acceptLocale = parseAcceptLanguage(req.headers.get("accept-language"));
  const locale = normalizeLocale(cookieLocale || acceptLocale || defaultLocale);

  const res = NextResponse.next();
  res.headers.set("x-locale", locale);
  if (!cookieLocale || normalizeLocale(cookieLocale) !== locale) {
    res.cookies.set(localeCookieName, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
