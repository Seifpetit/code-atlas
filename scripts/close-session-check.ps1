param(
  [string]$VerificationCommand = ""
)

$ErrorActionPreference = "Stop"

function Write-CheckLine {
  param(
    [string]$Label,
    [string]$Value
  )

  Write-Output ("{0}: {1}" -f $Label, $Value)
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
  Write-Warning "Not inside a Git worktree. Close-session check skipped."
  exit 0
}

$changedFiles = @()
git status --short --untracked-files=all | ForEach-Object {
  if (-not [string]::IsNullOrWhiteSpace($_)) {
    $changedFiles += $_
  }
}

$sourceChanged = $changedFiles | Where-Object {
  $_ -match "^\s*(M|A|\?\?)\s+frontend/src/" -or
  $_ -match "^\s*(M|A|\?\?)\s+backend/src/"
}

$archiveChanged = $changedFiles | Where-Object {
  $_ -match "^\s*(M|A|\?\?)\s+CONTEXT\.md" -or
  $_ -match "^\s*(M|A|\?\?)\s+docs/(VOCABULARY\.md|DECISIONS\.md|BUGS\.md|WORKFLOW\.md|README\.md|SESSION_NOTES\.md)" -or
  $_ -match "^\s*(M|A|\?\?)\s+docs/ai-skills/" -or
  $_ -match "^\s*(M|A|\?\?)\s+docs/ai-prompts/"
}

Write-Output "Close-session check"
Write-Output "-------------------"

if ([string]::IsNullOrWhiteSpace($VerificationCommand)) {
  Write-CheckLine "Verification" "not provided; record the build/test command in docs/SESSION_NOTES.md and CONTEXT.md"
} else {
  Write-CheckLine "Verification" $VerificationCommand
}

if ($sourceChanged.Count -gt 0 -and $archiveChanged.Count -eq 0) {
  Write-Warning "Source files changed but no archive/session docs changed."
} else {
  Write-CheckLine "Archive/session docs" "ok"
}

if ($changedFiles.Count -eq 0) {
  Write-CheckLine "Git status" "clean"
} else {
  Write-CheckLine "Git status" ("{0} changed item(s)" -f $changedFiles.Count)
  $changedFiles | ForEach-Object { Write-Output ("  {0}" -f $_) }
}

Write-Output ""
Write-Output "Close ritual:"
Write-Output "1. Verify"
Write-Output "2. Archive"
Write-Output "3. Update docs/SESSION_NOTES.md"
Write-Output "4. Refresh CONTEXT.md handoff"
Write-Output "5. Commit"
Write-Output "6. Push"
Write-Output "7. Handoff"
