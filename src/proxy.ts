import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { roleHomePath } from "@/lib/session-routing";
import type { UserRole } from "@/lib/user-types";

const roleRoutes: Record<UserRole, string[]> = {
  tutor: ["/dashboard", "/students", "/courses", "/schedule", "/billing", "/content", "/quizzes", "/announcements", "/settings"],
  student: ["/home", "/course", "/quiz", "/assignments"],
  parent: ["/overview"],
};

function pathStartsWith(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const authProxy = auth((request) => {
  const { pathname } = request.nextUrl;
  const role = request.auth?.user?.role;

  if (pathname === "/" && role) {
    return NextResponse.redirect(new URL(roleHomePath(role), request.url));
  }

  const protectedRole = (Object.entries(roleRoutes) as [UserRole, string[]][]).find(([, routes]) =>
    pathStartsWith(pathname, routes),
  )?.[0];

  if (!protectedRole) {
    return NextResponse.next();
  }

  if (!role) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (role !== protectedRole) {
    return NextResponse.redirect(new URL(roleHomePath(role), request.url));
  }

  return NextResponse.next();
}) as unknown as NextMiddleware;

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return authProxy(request, event);
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/students/:path*", "/courses/:path*", "/schedule/:path*", "/billing/:path*", "/content/:path*", "/quizzes/:path*", "/announcements/:path*", "/settings/:path*", "/home/:path*", "/course/:path*", "/quiz/:path*", "/assignments/:path*", "/overview/:path*"],
};
