import { Link } from "react-router-dom";
import { buttonVariants } from "@multica/ui/components/ui/button";

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="text-body font-medium text-muted-foreground">404</p>
      <h1 className="text-display-sm font-semibold">Page not found</h1>
      <p className="max-w-md text-body text-muted-foreground">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link to="/" className={buttonVariants({ className: "mt-2" })}>
        Back to Multica
      </Link>
    </main>
  );
}
