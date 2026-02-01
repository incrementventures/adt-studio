import { notFound } from "next/navigation";
import { getBookMetadata } from "@/lib/books";
import { BookSidebar } from "./book-sidebar";

export default async function BookLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ label: string }>;
}) {
  const { label } = await params;
  const metadata = getBookMetadata(label);
  if (!metadata) notFound();

  return (
    <div className="-mx-4 -mt-6 flex" style={{ width: "100vw", marginLeft: "calc(-50vw + 50%)" }}>
      <aside className="fixed top-0 h-screen w-52 bg-slate-900 pt-[var(--header-h)]">
        <BookSidebar label={label} title={label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} />
      </aside>
      <main className="ml-52 min-w-0 flex-1 py-6 pl-6 pr-7">{children}</main>
    </div>
  );
}
