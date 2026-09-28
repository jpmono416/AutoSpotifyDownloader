import { getConnectionStatus, listOperationFailures, listPlaylistMappings } from "@/lib/db";
import Dashboard from "@/components/dashboard";
import { getPlatformConfigurationStatus } from "@/lib/platform-config";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

import { appMode } from "@/lib/app-mode";
import { localDownloadDiagnostics } from "@/lib/local-download";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const status = await getConnectionStatus(user.id);
  const playlists = await listPlaylistMappings(user.id);
  const configured = getPlatformConfigurationStatus();
  const failures = await listOperationFailures(user.id);

  return <Dashboard localDiagnostics={appMode()==="local" ? await localDownloadDiagnostics() : undefined} username={user.username} initialStatus={status} initialConfigured={configured} initialPlaylists={playlists} initialFailures={failures} />;
}
