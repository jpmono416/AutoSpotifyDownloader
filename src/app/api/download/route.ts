/**
 * @deprecated Use POST /api/jobs/download.
 * QA downloads are deliberately gated and run only in the isolated worker. YouTube
 * terms and provider policy must be reviewed before enabling this lab feature.
 */
export async function POST(){return Response.json({error:"Downloads now run as QA-only background jobs. Use /api/jobs/download.",code:"background_jobs_required"},{status:410});}
