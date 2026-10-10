# Restart the existing PC workspace; private state remains in ignored data/local.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskRuntimePath = Join-Path $taskRoot 'data/local/runtime.json'
if (!(Test-Path -LiteralPath $taskRuntimePath)) {
    throw 'Create the dedicated asd-local database using docs/LOCAL_DEVELOPMENT.md first. This launcher requires data/local/runtime.json with databaseUrl and appPort.'
}
$taskRuntime = Get-Content -LiteralPath $taskRuntimePath -Raw | ConvertFrom-Json
$taskPort = [int]$taskRuntime.appPort
if ($taskPort -lt 1 -or $taskPort -gt 65535) { throw 'Invalid appPort in local runtime settings.' }
if (Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue) {
    throw "Port $taskPort is already in use. Check the existing app before starting another worker."
}
$taskSavedPids = Join-Path $taskRoot 'data/local/processes.json'
if (Test-Path -LiteralPath $taskSavedPids) {
    $taskPrevious = Get-Content -LiteralPath $taskSavedPids -Raw | ConvertFrom-Json
    foreach ($taskPid in @($taskPrevious.appPid, $taskPrevious.workerPid)) {
        $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskPid" -ErrorAction SilentlyContinue
        if ($taskProcess -and $taskProcess.CommandLine -like "*$taskRoot*") {
            throw 'A workspace process is still running. Stop that process before restarting; use only one local download worker.'
        }
    }
}
docker start asd-local | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not start the existing asd-local Docker database.' }
$taskBinding = docker port asd-local 5432/tcp
if ($LASTEXITCODE -ne 0 -or $taskBinding -notmatch '^127\.0\.0\.1:(\d+)$') {
    throw 'The asd-local database must have exactly one loopback port binding.'
}
$taskDbPort = [int]$Matches[1]
$taskDbUri = [UriBuilder]::new($taskRuntime.databaseUrl)
if ($taskDbUri.Host -ne '127.0.0.1' -or $taskDbUri.Path -ne '/asd_local') {
    throw 'Runtime settings must point to the dedicated loopback asd_local database.'
}
$taskDbUri.Port = $taskDbPort
$taskRuntime.databaseUrl = $taskDbUri.Uri.AbsoluteUri.TrimEnd('/')
$taskReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    docker exec asd-local pg_isready -U postgres -d asd_local 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $taskReady = $true; break }
    Start-Sleep -Seconds 1
}
if (!$taskReady) { throw 'Local database did not become ready.' }
if (!$taskRuntime.PSObject.Properties['tokenEncryptionKey']) {
    $taskTokenCount = docker exec asd-local psql -U postgres -d asd_local -Atc 'select count(*) from platform_tokens;'
    if ($LASTEXITCODE -ne 0 -or $taskTokenCount.Trim() -ne '0') {
        throw 'Restore the original tokenEncryptionKey in private runtime settings before launching a database with provider tokens.'
    }
    $taskKeyBytes = New-Object byte[] 32
    $taskRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $taskRng.GetBytes($taskKeyBytes) } finally { $taskRng.Dispose() }
    $taskRuntime | Add-Member -NotePropertyName tokenEncryptionKey -NotePropertyValue ([Convert]::ToBase64String($taskKeyBytes))
}
$taskRuntime | ConvertTo-Json | Set-Content -LiteralPath $taskRuntimePath
$env:APP_MODE = 'local'
$env:LOCAL_DATABASE_URL = $taskRuntime.databaseUrl
$env:NEXT_PUBLIC_APP_URL = "http://127.0.0.1:$taskPort"
$env:PORT = "$taskPort"
$env:PYTHON_PATH = 'C:\Python312\python.exe'
$env:TOKEN_ENCRYPTION_KEY = $taskRuntime.tokenEncryptionKey
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskAppScript = Join-Path $taskRoot 'scripts/local-server.ts'
$taskWorkerScript = Join-Path $taskRoot 'scripts/worker.ts'
$taskWorker = Start-Process -FilePath $taskNode -ArgumentList @('--import', 'tsx', ('"' + $taskWorkerScript + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'data/local/worker.stdout.log') -RedirectStandardError (Join-Path $taskRoot 'data/local/worker.stderr.log') -PassThru
try {
    $taskApp = Start-Process -FilePath $taskNode -ArgumentList @('--import', 'tsx', ('"' + $taskAppScript + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'data/local/app.stdout.log') -RedirectStandardError (Join-Path $taskRoot 'data/local/app.stderr.log') -PassThru
} catch {
    Stop-Process -Id $taskWorker.Id -ErrorAction SilentlyContinue
    throw
}
@{ appPid = $taskApp.Id; workerPid = $taskWorker.Id; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $taskSavedPids
$taskAppReady = $false
$taskStartupTimer = [Diagnostics.Stopwatch]::StartNew()
while ($taskStartupTimer.Elapsed.TotalSeconds -lt 60) {
    if ($taskApp.HasExited -or $taskWorker.HasExited) { break }
    try {
        $taskHealth = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$taskPort/api/health" -TimeoutSec 5
        if (($taskHealth.Content | ConvertFrom-Json).status -eq 'ok') { $taskAppReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (!$taskAppReady) {
    Stop-Process -Id $taskApp.Id, $taskWorker.Id -ErrorAction SilentlyContinue
    throw 'Local startup failed. Inspect data/local/app.stderr.log and worker.stderr.log.'
}
Write-Output "Started local app at http://127.0.0.1:$taskPort with worker. Logs: data/local/*.log"
