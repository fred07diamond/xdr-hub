import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { TeamPage } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconArrowRight, IconMail, IconRoute } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { EmailSettings } from "@/components/pa/email-settings";
import { RoutingSettings } from "@/components/pa/routing-settings";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "chat-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      teamLabel={t("navigation.team")}
      extraTabs={[
        {
          // Who exceptional leads go to, and everyone's meeting link (D79).
          id: "lead-routing",
          label: "Lead routing",
          icon: IconRoute,
          keywords:
            "routing meeting link commercial enterprise AE round robin PA",
          content: (
            <div className="mx-auto w-full max-w-3xl">
              <RoutingSettings />
            </div>
          ),
        },
        {
          // Your Gmail for Approve and send (D99).
          id: "email",
          label: "Email",
          icon: IconMail,
          keywords: "gmail email send connect reconnect disconnect test",
          content: (
            <div className="mx-auto w-full max-w-3xl">
              <EmailSettings />
            </div>
          ),
        },
        ...agentSettingsTabs,
      ]}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>

          <SettingsGroup>
            <SettingsRow
              id="language"
              label={t("settings.languageTitle")}
              description={t("settings.languageDescription")}
              control={
                <div className="w-56">
                  <LanguagePicker label={t("settings.languageLabel")} />
                </div>
              }
            />
          </SettingsGroup>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <Link
            to="/settings/lead-routing"
            className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-[13px] shadow-xs hover:bg-accent/50"
          >
            <IconRoute
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">
                Lead routing
              </span>
              <span className="block text-muted-foreground">
                Set the Commercial AE, the Enterprise AEs, and everyone's
                meeting links.
              </span>
            </span>
            <IconArrowRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
          <TeamPage
            showTitle={false}
            createOrgDescription={t("pages.teamCreateOrgDescription")}
          />
        </div>
      }
    />
  );
}
