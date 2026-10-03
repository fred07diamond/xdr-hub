// The signed-in person's Gmail connection (D96), shared by the draft card and
// the Email settings tab: its status, and opening Google to connect.
import { appPath } from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export interface GmailStatus {
  you: string;
  configured: boolean;
  connected: boolean;
  needsReconnect: boolean;
  email: string | null;
}

export function useGmail(enabled = true) {
  const [waiting, setWaiting] = useState(false);
  const status = useActionQuery(
    "get-gmail-status",
    {},
    {
      enabled,
      // While the Google window is open, check every few seconds.
      refetchInterval: waiting ? 3000 : false,
    },
  );
  const gmail = status.data as GmailStatus | undefined;
  const connected = Boolean(gmail?.connected && !gmail.needsReconnect);

  useEffect(() => {
    if (waiting && connected) {
      setWaiting(false);
      toast.success("Gmail connected.");
    }
  }, [waiting, connected]);

  const connect = () => {
    setWaiting(true);
    window.open(
      appPath("/_agent-native/gmail/auth-url?redirect=1"),
      "pa-connect-gmail",
      "width=520,height=680",
    );
  };

  return { status, gmail, connected, waiting, connect };
}
