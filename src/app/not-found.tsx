import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="text-center">
        <div className="text-5xl font-semibold tracking-tight text-faint">404</div>
        <h1 className="mt-3 text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/dashboard" className="mt-5 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
