# Applies the GitHub settings that keep a PUBLIC repository with a self-hosted runner safe. Needs the gh CLI
# logged in as the owner. Safe to re-run. Steps marked (public) are refused by GitHub while the repo is private.
#
#   pwsh -File scripts/harden-github.ps1   (or powershell -ExecutionPolicy Bypass -File ...)
param([string]$Repo = 'ebialobrzeski/aram_overlay')
$ErrorActionPreference = 'Continue'

function Step($name, [scriptblock]$body) {
  Write-Host "==> $name"
  $out = & $body 2>&1 | Out-String
  if ($out.Trim()) { Write-Host ("   " + $out.Trim()) }
}
function Api($method, $path, $json) {
  if (-not $json) { return gh api -X $method $path }
  # a file avoids console-encoding surprises when piping JSON into gh
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding $false))
  try { gh api -X $method $path --input $tmp } finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
}

Step 'Repository metadata; wiki and projects off; delete merged branches' {
  gh repo edit $Repo --description 'Always-on-top ARAM champion-select overlay: ranks picks, plans party swaps, detects ult combos' `
    --enable-wiki=false --enable-projects=false --delete-branch-on-merge
  gh repo edit $Repo --add-topic league-of-legends --add-topic aram --add-topic overlay --add-topic electron --add-topic lcu
  'ok'
}

Step 'Actions: only GitHub-owned, verified and the release action; default token read-only' {
  Api PUT "repos/$Repo/actions/permissions" '{ "enabled": true, "allowed_actions": "selected" }' | Out-Null
  Api PUT "repos/$Repo/actions/permissions/selected-actions" '{ "github_owned_allowed": true, "verified_allowed": true, "patterns_allowed": ["softprops/action-gh-release@*"] }' | Out-Null
  Api PUT "repos/$Repo/actions/permissions/workflow" '{ "default_workflow_permissions": "read", "can_approve_pull_request_reviews": false }' | Out-Null
  'ok'
}

Step 'Actions: require approval for ALL outside contributors before any workflow runs (public) - protects the NAS runner' {
  Api PUT "repos/$Repo/actions/permissions/fork-pr-contributor-approval" '{ "approval_policy": "all_external_contributors" }' | Out-Null
  'ok'
}

Step 'Dependabot alerts and automated security fixes' {
  Api PUT "repos/$Repo/vulnerability-alerts" | Out-Null
  Api PUT "repos/$Repo/automated-security-fixes" | Out-Null
  'ok'
}

Step 'Secret scanning and push protection (public)' {
  Api PATCH "repos/$Repo" '{ "security_and_analysis": { "secret_scanning": { "status": "enabled" }, "secret_scanning_push_protection": { "status": "enabled" } } }' | Out-Null
  'ok'
}

Step 'Branch protection for main: no force-push, no deletion, CI must pass, conversations resolved (public)' {
  Api PUT "repos/$Repo/branches/main/protection" '{ "required_status_checks": { "strict": true, "contexts": ["test"] }, "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null, "allow_force_pushes": false, "allow_deletions": false, "required_conversation_resolution": true }' | Out-Null
  'ok'
}

Step 'Release tags v*: no deletion, no moving (public)' {
  Api POST "repos/$Repo/rulesets" '{ "name": "release tags", "target": "tag", "enforcement": "active", "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } }, "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ] }' | Out-Null
  'ok (a "already exists" error on re-run is fine)'
}

Write-Host ''
Write-Host 'Current state:'
gh api "repos/$Repo/actions/permissions/workflow"
gh api "repos/$Repo/actions/permissions/fork-pr-contributor-approval" 2>$null
gh api "repos/$Repo" --jq '{visibility, security: .security_and_analysis}'
