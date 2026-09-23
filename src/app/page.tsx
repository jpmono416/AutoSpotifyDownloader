import { getConnectionStatus, listOperationFailures, listPlaylistMappings } from "@/lib/db";
import Dashboard from "@/components/dashboard";
import { getPlatformConfigurationStatus } from "@/lib/platform-config";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const status = await getConnectionStatus(user.id);
  const playlists = await listPlaylistMappings(user.id);
  const configured = getPlatformConfigurationStatus();
  const failures = await listOperationFailures(user.id);

  return <Dashboard username={user.username} initialStatus={status} initialConfigured={configured} initialPlaylists={playlists} initialFailures={failures} />;
}
