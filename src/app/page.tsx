import { getConnectionStatus, listPlaylistMappings } from "@/lib/db";
import Dashboard from "@/components/dashboard";

export default function Home() {
  const status = getConnectionStatus();
  const playlists = listPlaylistMappings();

  return <Dashboard initialStatus={status} initialPlaylists={playlists} />;
}
