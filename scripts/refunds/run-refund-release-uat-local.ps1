$ErrorActionPreference = "Stop"
$startedAt = [DateTime]::UtcNow.ToString("o")
$sourceCommit = (git rev-parse HEAD).Trim()
$worktreeRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$ArtifactDir = "output/refund-uat-evidence"
$FragmentDir = "output/refund-uat-fragments"
$artifactPath = [IO.Path]::GetFullPath((Join-Path $worktreeRoot $ArtifactDir))
$fragmentPath = [IO.Path]::GetFullPath((Join-Path $worktreeRoot $FragmentDir))
$expectedArtifactPath = [IO.Path]::GetFullPath((Join-Path $worktreeRoot "output/refund-uat-evidence"))
$expectedFragmentPath = [IO.Path]::GetFullPath((Join-Path $worktreeRoot "output/refund-uat-fragments"))
$serverOut = Join-Path $worktreeRoot "output/refund-uat-server-release.log"
$serverErr = Join-Path $worktreeRoot "output/refund-uat-server-release-error.log"

function Invoke-CheckedNpm {
  param([string[]]$Arguments)

  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm failed: $($Arguments -join ' ')"
  }
}

if (
  -not $artifactPath.Equals($expectedArtifactPath, [StringComparison]::OrdinalIgnoreCase) -or
  -not $fragmentPath.Equals($expectedFragmentPath, [StringComparison]::OrdinalIgnoreCase)
) {
  throw "Refusing to reset any directory outside the two approved synthetic evidence targets."
}
if (Test-Path -LiteralPath $artifactPath) {
  Remove-Item -LiteralPath $artifactPath -Recurse -Force
}
if (Test-Path -LiteralPath $fragmentPath) {
  Remove-Item -LiteralPath $fragmentPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $artifactPath, $fragmentPath | Out-Null

$refundUatBytes = New-Object byte[] 32
$refundUatRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $refundUatRng.GetBytes($refundUatBytes)
} finally {
  $refundUatRng.Dispose()
}
$env:REFUND_UAT_EVIDENCE_RUN_TOKEN = (
  [System.BitConverter]::ToString($refundUatBytes) -replace "-", ""
).ToLowerInvariant()
[System.Array]::Clear($refundUatBytes, 0, $refundUatBytes.Length)

$env:REFUND_MANAGER_AGING_NOTICES_ENABLED = "false"
$env:VITE_SUPABASE_URL = "http://127.0.0.1:54321"
$env:VITE_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.synthetic-signature"

$server = $null
try {
  Invoke-CheckedNpm @("run", "db:validate-migrations", "--", "--evidence-dir", $FragmentDir)
  Invoke-CheckedNpm @(
    "run",
    "refunds:build-manager-aging-kill-fragment",
    "--",
    "--output",
    "$FragmentDir/refund-manager-aging-kill-fragment.json"
  )
  Invoke-CheckedNpm @("run", "refunds:evidence-gmail", "--", "--evidence-dir", $FragmentDir)

  $server = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev:uat") `
    -WorkingDirectory $worktreeRoot `
    -RedirectStandardOutput $serverOut `
    -RedirectStandardError $serverErr `
    -WindowStyle Hidden `
    -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      $response = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "http://127.0.0.1:8081/" `
        -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 750
    }
  }
  if (-not $ready) {
    throw "Synthetic UAT app did not become ready on port 8081."
  }

  Invoke-CheckedNpm @(
    "run",
    "refunds:validate-portal-uat",
    "--",
    "--app-url",
    "http://127.0.0.1:8081",
    "--artifact-dir",
    $ArtifactDir,
    "--fragment-dir",
    $FragmentDir
  )
  Invoke-CheckedNpm @(
    "run",
    "refunds:validate-qr-intake-uat",
    "--",
    "--app-url",
    "http://127.0.0.1:8081",
    "--artifact-dir",
    $ArtifactDir
  )
  Invoke-CheckedNpm @(
    "run",
    "refunds:validate-machine-manager-uat",
    "--",
    "--app-url",
    "http://127.0.0.1:8081",
    "--artifact-dir",
    $ArtifactDir
  )
  Invoke-CheckedNpm @(
    "run",
    "refunds:finalize-uat-evidence",
    "--",
    "--fragment-dir",
    $FragmentDir,
    "--artifact-dir",
    $ArtifactDir,
    "--fresh-after",
    $startedAt
  )
  Invoke-CheckedNpm @(
    "run",
    "refunds:build-uat-evidence",
    "--",
    "--artifact-dir",
    $ArtifactDir,
    "--source-commit",
    $sourceCommit,
    "--fresh-after",
    $startedAt
  )
  Invoke-CheckedNpm @("run", "refunds:validate-uat-evidence")

  Write-Output "Synthetic release packet ready: $ArtifactDir"
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Env:REFUND_UAT_EVIDENCE_RUN_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:REFUND_MANAGER_AGING_NOTICES_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
}
