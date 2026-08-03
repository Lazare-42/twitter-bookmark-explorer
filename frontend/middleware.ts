import { NextRequest, NextResponse } from "next/server";

// Simple HTTP basic auth. The password comes from the sops secret
// `bookmarks-lazare-env` (BASIC_AUTH_PASSWORD, optionally BASIC_AUTH_USER),
// injected as an EnvironmentFile by the systemd unit. If no password is set the
// site is open — so it never locks you out before you define one.
export function middleware(req: NextRequest) {
  const password = process.env.BASIC_AUTH_PASSWORD || "";
  if (!password) return NextResponse.next();

  const user = process.env.BASIC_AUTH_USER || "laz";
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const [u, p] = atob(header.slice(6)).split(":");
      if (u === user && p === password) return NextResponse.next();
    } catch {
      /* malformed header → fall through to challenge */
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Bookmarks", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
