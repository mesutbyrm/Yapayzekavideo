import { NextResponse, type NextRequest } from "next/server";

/** Oturum çerezi olmayan sayfa isteklerini giriş sayfasına yönlendirir (asıl doğrulama sunucu tarafında). */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api") || pathname === "/login" || pathname.startsWith("/login/") || pathname === "/privacy" || pathname.startsWith("/privacy/") || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }
  if (!req.cookies.get("asf_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
