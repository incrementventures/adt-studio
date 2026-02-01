"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Overview", href: "" },
  { label: "Extract", href: "/extract" },
  { label: "Storyboard", href: "/storyboard" },
];

const bottomItems = [
  { label: "Logs", href: "/log" },
];

export function BookSidebar({
  label,
  title,
}: {
  label: string;
  title: string;
}) {
  const pathname = usePathname();
  const base = `/books/${label}`;

  const renderItems = (items: typeof navItems) =>
    items.map((item) => {
      const href = base + item.href;
      const active = pathname === href;
      return (
        <li key={item.label}>
          <Link
            href={href}
            className={`block rounded px-2 py-1 ${
              active
                ? "bg-slate-700 font-medium text-white"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        </li>
      );
    });

  return (
    <nav className="flex h-full flex-col px-4 pt-6 text-sm">
      <Link
        href={base}
        className="mb-4 block font-semibold text-white hover:text-slate-300"
      >
        {title}
      </Link>
      <ul className="space-y-1">
        {renderItems(navItems)}
      </ul>
      <div className="mt-auto border-t border-slate-700 py-3">
        <ul className="space-y-1">
          {renderItems(bottomItems)}
        </ul>
      </div>
    </nav>
  );
}
