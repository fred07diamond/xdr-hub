import { useSession } from "@agent-native/core/client/hooks";

export function meta() {
  return [{ title: "Access Pending — XDR Booking Agent" }];
}

export default function PendingRoute() {
  const { session } = useSession();

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg text-center">
        <h1 className="mb-2 text-lg font-semibold">Access Pending</h1>
        {session?.email && (
          <p className="mb-3 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{session.email}</span>
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Your account is awaiting role assignment. Contact{" "}
          <a
            href="mailto:fred@builder.io"
            className="text-primary hover:underline"
          >
            fred@builder.io
          </a>{" "}
          to get access.
        </p>
      </div>
    </div>
  );
}
