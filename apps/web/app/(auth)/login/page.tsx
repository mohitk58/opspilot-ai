export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Sign in to OpsPilot</h1>
      <p className="text-sm text-slate-400">
        Auth flow lands with the auth module (JWT + rotating refresh tokens).
        This placeholder keeps routing honest from day one.
      </p>
    </main>
  );
}
