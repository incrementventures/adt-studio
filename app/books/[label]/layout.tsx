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
    <div className="-mx-4 -my-6 flex" style={{ width: "100vw", marginLeft: "calc(-50vw + 50%)" }}>
      <aside className="sticky top-0 h-screen w-52 shrink-0 self-start overflow-y-auto bg-slate-900 px-4 py-6">
        <BookSidebar label={label} title={label.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} />
      </aside>
      <main className="min-w-0 flex-1 py-6 pl-6 pr-7">{children}</main>
    </div>
  );
}
