"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { MOTTO } from "@/lib/brand";

type Step = "password" | "enrol" | "totp";

type Envelope<T> = {
  data?: T;
  error?: { code: string; message: string };
};

async function post<T>(path: string, body?: unknown): Promise<Envelope<T>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState<{
    qrDataUrl: string;
    secret: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post<{ totpEnrolled: boolean }>("/api/core/v1/auth/login", {
      email,
      password,
    });
    setBusy(false);
    if (result.error) return setError(result.error.message);
    if (result.data!.totpEnrolled) {
      setStep("totp");
    } else {
      const enrol = await post<{ qrDataUrl: string; secret: string }>(
        "/api/core/v1/auth/totp/enrol",
      );
      if (enrol.error) return setError(enrol.error.message);
      setEnrolment(enrol.data!);
      setStep("enrol");
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post<{ loggedIn: boolean }>("/api/core/v1/auth/totp", { code });
    setBusy(false);
    if (result.error) return setError(result.error.message);
    router.push(search.get("next") ?? "/admin");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-8">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">N8E Collect</h1>
        <p className="mb-6 font-mono text-xs text-[var(--text-muted)]">{MOTTO}</p>

        {step === "password" && (
          <form onSubmit={submitPassword} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--surface-2)] px-3 py-2 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--surface-2)] px-3 py-2 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-2 rounded-[var(--radius-control)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
        )}

        {step === "enrol" && enrolment && (
          <form onSubmit={submitCode} className="flex flex-col gap-4">
            <p className="text-sm">
              Scan this QR code with your authenticator app, then enter the 6-digit code
              to finish enrolment.
            </p>
            <Image
              src={enrolment.qrDataUrl}
              alt="TOTP enrolment QR code"
              width={176}
              height={176}
              unoptimized
              className="mx-auto rounded bg-white p-2"
            />
            <p className="break-all font-mono text-xs text-[var(--text-muted)]">
              Manual secret: {enrolment.secret}
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Authenticator code"
              className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--surface-2)] px-3 py-2 text-center font-mono outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-[var(--radius-control)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Enable 2FA and sign in"}
            </button>
          </form>
        )}

        {step === "totp" && (
          <form onSubmit={submitCode} className="flex flex-col gap-4">
            <p className="text-sm">Enter the 6-digit code from your authenticator app.</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Authenticator code"
              className="rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--surface-2)] px-3 py-2 text-center font-mono outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-[var(--radius-control)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Sign in"}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
