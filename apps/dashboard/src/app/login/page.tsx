import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { readSession } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

async function AlreadySignedIn() {
  const session = await readSession();
  if (session) redirect(session.role === "STAFF" ? "/live" : "/");
  return null;
}

// Shown only when the local dev stack is running (it sets this), never on a real deployment.
const DEV_HINT = process.env.DEV_SIGN_IN_HINT === "1";

async function LoginWithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = (await searchParams).next;
  return <LoginForm sampleData={DEV_HINT} next={typeof next === "string" ? next : undefined} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <Suspense fallback={null}>
        <AlreadySignedIn />
      </Suspense>
      <div className="flex w-full max-w-100 flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl text-fg">Sign in</h1>
          <p className="text-sm text-muted">Your restaurant&apos;s AI receptionist: calls, orders and settings.</p>
        </div>
        <Suspense fallback={<LoginForm sampleData={DEV_HINT} />}>
          <LoginWithNext searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
