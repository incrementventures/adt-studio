import { listBooks } from "@/lib/books";
import BookGrid from "./book-grid";

export default function Home() {
  const books = listBooks();

  return <BookGrid books={books} />;
}
