/** @deprecated Use POST /api/jobs/sync. Long-lived HTTP syncs are intentionally disabled. */
export async function POST(){return Response.json({error:"Syncs now run as background jobs. Use /api/jobs/sync.",code:"background_jobs_required"},{status:410});}
