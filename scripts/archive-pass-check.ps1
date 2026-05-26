param(
  [string]$BaseRef = "",
  [string]$HeadRef = "HEAD"
)

$ErrorActionPreference = "Stop"

function Write-ArchiveWarning {
  param([string]$Message)

  if ($env:GITHUB_ACTIONS -eq "true") {
    Write-Output "::warning title=Archive pass recommended::$Message"
  } else {
    Write-Warning $Message
  }
}

function Test-GitAvailable {
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $script:ErrorActionPreference = "Continue"
    git rev-parse --is-inside-work-tree *> $null
    $exitCode = $LASTEXITCODE
    $script:ErrorActionPreference = $previousErrorActionPreference
    return $exitCode -eq 0
  } catch {
    $script:ErrorActionPreference = "Stop"
    return $false
  }
}

if (-not (Test-GitAvailable)) {
  Write-ArchiveWarning "Not inside a Git worktree. Archive drift check skipped."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($BaseRef)) {
  $BaseRef = $env:ARCHIVE_CHECK_BASE
}

if ([string]::IsNullOrWhiteSpace($BaseRef)) {
  $BaseRef = "HEAD~1"
}

$changedFiles = @()
git diff --name-only "$BaseRef" "$HeadRef" 2>$null | ForEach-Object {
  if (-not [string]::IsNullOrWhiteSpace($_)) {
    $changedFiles += $_
  }
}

if ($LASTEXITCODE -ne 0 -or $changedFiles.Count -eq 0) {
  Write-Output "Archive check: no changed files detected for $BaseRef..$HeadRef."
  exit 0
}

$sourcePatterns = @(
  "^frontend/src/",
  "^backend/src/",
  "^frontend/package\.json$",
  "^backend/package\.json$",
  "^frontend/vite\.config\.ts$",
  "^frontend/tsconfig\.json$",
  "^backend/tsconfig\.json$"
)

$archivePatterns = @(
  "^CONTEXT\.md$",
  "^docs/VOCABULARY\.md$",
  "^docs/DECISIONS\.md$",
  "^docs/BUGS\.md$",
  "^docs/WORKFLOW\.md$",
  "^docs/README\.md$",
  "^docs/ai-skills/",
  "^docs/ai-prompts/"
)

$sourceChanged = $false
foreach ($file in $changedFiles) {
  foreach ($pattern in $sourcePatterns) {
    if ($file -match $pattern) {
      $sourceChanged = $true
      break
    }
  }
}

$archiveChanged = $false
foreach ($file in $changedFiles) {
  foreach ($pattern in $archivePatterns) {
    if ($file -match $pattern) {
      $archiveChanged = $true
      break
    }
  }
}

if ($sourceChanged -and -not $archiveChanged) {
  Write-ArchiveWarning "Source changed without archive docs changing. Run: Run an archive pass using docs/ai-prompts/archive-pass.md."
  exit 0
}

Write-Output "Archive check: ok."
