import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-(--ds-content-max) flex-col gap-3 p-6">
      <h1 className="text-xl text-fg">AI Receptionist</h1>
      <p className="text-muted">
        The dashboard screens arrive in milestone M1. The design system is at{" "}
        <Link href="/design" className="text-accent underline underline-offset-2">
          /design
        </Link>
        .
      </p>
    </main>
  );
}
