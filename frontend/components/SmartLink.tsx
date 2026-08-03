"use client";

import { useCallback } from "react";

// On iOS, force links into their native app via URL scheme (X app, Amazon app)
// with an https fallback if the app isn't installed. Elsewhere the plain https
// link is used and iOS/Android universal links still do their default thing.
function appScheme(href: string): string | null {
  const tweet = href.match(/^https?:\/\/(?:twitter|x)\.com\/(?:i\/status|[^/]+\/status)\/(\d+)/);
  if (tweet) return `twitter://status?id=${tweet[1]}`;
  const amazon = href.match(/^https?:\/\/(www\.)?(amazon\.[a-z.]+\/.*)$/);
  if (amazon) return `com.amazon.mobile.shopping.web://${amazon[2]}`;
  return null;
}

function isIOS(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export default function SmartLink({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const scheme = appScheme(href);
      if (!scheme || !isIOS()) return; // normal navigation
      e.preventDefault();
      const fallback = setTimeout(() => {
        window.location.href = href;
      }, 900);
      // If the app opens, the page is backgrounded and the timer never fires
      // before pagehide; clear it to avoid a surprise navigation on return.
      window.addEventListener("pagehide", () => clearTimeout(fallback), { once: true });
      window.location.href = scheme;
    },
    [href]
  );
  return (
    <a
      href={href}
      className={className}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    >
      {children}
    </a>
  );
}
