// Settings > Email (D99): your Gmail connection for sending first touches,
// with connect, reconnect, disconnect, and a test to yourself. The draft card
// only carries Approve and send / Approve.
import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import {
  IconBrandGmail,
  IconLoader2,
  IconMailForward,
  IconPlugConnectedX,
  IconRefresh,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useGmail } from "@/hooks/use-gmail";

export function EmailSettings() {
  const { status, gmail, connected, waiting, connect } = useGmail();
  const test = useActionMutation("send-test-email");
  const disconnect = useActionMutation("disconnect-gmail");

  const description = status.isLoading
    ? "Checking..."
    : connected
      ? `Connected as ${gmail?.email}. Approve and send on a lead you own goes out from this address, and HubSpot logs it through your inbox sync.`
      : gmail?.needsReconnect
        ? "Connected, but without permission to send. Reconnect to fix it."
        : gmail?.configured === false
          ? "Google sign-in is not set up on this server."
          : "Not connected. Connect once so you can send first touches from your own Gmail.";

  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Gmail"
        description="PA sends only when you click Approve and send, and only on leads you own. It can send and save drafts, never read your inbox."
      >
        <SettingsRow
          icon={<IconBrandGmail className="size-4" />}
          label="Your Gmail"
          description={description}
          control={
            status.isLoading ? null : connected ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={test.isPending}
                  onClick={() =>
                    test.mutate(
                      {},
                      {
                        onSuccess: () =>
                          toast.success(
                            `Test sent to ${gmail?.email}. Check your inbox.`,
                          ),
                        onError: (error) =>
                          toast.error(actionErrorMessage(error)),
                      },
                    )
                  }
                >
                  {test.isPending ? (
                    <IconLoader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <IconMailForward className="size-4" aria-hidden="true" />
                  )}
                  Send a test to me
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={connect}
                >
                  <IconRefresh className="size-4" aria-hidden="true" />
                  Reconnect
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(
                      {},
                      {
                        onSuccess: () => {
                          toast.success("Gmail disconnected.");
                          void status.refetch();
                        },
                        onError: (error) =>
                          toast.error(actionErrorMessage(error)),
                      },
                    )
                  }
                >
                  <IconPlugConnectedX className="size-4" aria-hidden="true" />
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={gmail?.configured === false}
                onClick={connect}
              >
                <IconBrandGmail className="size-4" aria-hidden="true" />
                {gmail?.needsReconnect ? "Reconnect Gmail" : "Connect Gmail"}
              </Button>
            )
          }
        />
      </SettingsGroup>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {waiting
          ? "Finish in the Google window. This page updates on its own. "
          : ""}
        Google says the app is not verified when you connect: click Advanced,
        then Go to XDR Hub. You only see that once.
      </p>
    </div>
  );
}
