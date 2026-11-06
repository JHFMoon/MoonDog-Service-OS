param(
  [Parameter(Mandatory)]
  [string]$RepositoryRoot,
  [switch]$Publish,
  [switch]$DryRun,
  [switch]$RecoverMergedPR,
  [int]$PullRequestNumber,
  [switch]$SelfTest,
  [ValidateRange(1, 60)]
  [int]$TimeoutMinutes = 25
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:Repository = "JHFMoon/MoonDog-Service-OS"
$script:Origin = "https://github.com/JHFMoon/MoonDog-Service-OS.git"
$script:Api = "https://api.github.com"
$script:Http = $null
$script:Report = [ordered]@{
  Status = "BLOCKED"
  PR = "—"
  SHA = "—"
  Tests = "NOT RUN"
  Beta = "NOT APPLICABLE"
  Stable = "UNKNOWN"
  OwnerAction = "None"
}

function Write-Report {
  param([string]$Status, [string]$OwnerAction = "None")
  $script:Report.Status = $Status
  $script:Report.OwnerAction = $OwnerAction
  Write-Host "`nMoonDog Beta Publisher"
  foreach ($entry in $script:Report.GetEnumerator()) {
    Write-Host ("{0}: {1}" -f $entry.Key, $entry.Value)
  }
}

function Invoke-Git {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [switch]$AllowFailure
  )
  $output = @(& git -C $script:Root @Arguments 2>&1)
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) {
    $safe = ($output | ForEach-Object { "$_".Trim() }) -join " "
    throw "git $($Arguments[0]) failed ($code): $safe"
  }
  return ,$output
}

function Invoke-Python {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $output = @(& python @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Python check failed: $($output -join ' ')"
  }
  return ,$output
}

function Get-Credential {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command git -ErrorAction Stop).Source
  $psi.Arguments = "credential fill"
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.Environment["GIT_TERMINAL_PROMPT"] = "0"
  $process = [System.Diagnostics.Process]::Start($psi)
  $process.StandardInput.Write("protocol=https`nhost=github.com`n`n")
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $values = @{}
  foreach ($line in $stdout -split "`n") {
    if ($line -match "^([^=]+)=(.*)$") { $values[$matches[1]] = $matches[2].TrimEnd("`r") }
  }
  if ($process.ExitCode -ne 0 -or -not $values.username -or -not $values.password) {
    throw "Git Credential Manager did not provide GitHub credentials (exit $($process.ExitCode))."
  }
  $credential = [pscustomobject]@{ Username = $values.username; Password = $values.password }
  $values.Clear()
  $stdout = $null
  $stderr = $null
  return $credential
}

function Initialize-GitHub {
  $credential = Get-Credential
  $basic = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes("$($credential.Username):$($credential.Password)")
  )
  $script:Http = [System.Net.Http.HttpClient]::new()
  $script:Http.Timeout = [TimeSpan]::FromSeconds(30)
  $script:Http.DefaultRequestHeaders.UserAgent.ParseAdd("MoonDog-Beta-Publisher")
  $script:Http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json")
  $script:Http.DefaultRequestHeaders.Authorization =
    [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Basic", $basic)
  $credential.Password = $null
  $basic = $null
}

function Invoke-GitHub {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [object]$Body
  )
  $uri = if ($Path.StartsWith("https://")) { $Path } else { "$script:Api/$Path" }
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::new($Method), $uri
  )
  if ($null -ne $Body) {
    $json = ConvertTo-Json -InputObject $Body -Depth 30 -Compress
    $request.Content = [System.Net.Http.StringContent]::new(
      $json, [Text.Encoding]::UTF8, "application/json"
    )
  }
  $response = $null
  try {
    $response = $script:Http.SendAsync($request).GetAwaiter().GetResult()
    $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      throw "GitHub API $Method $Path returned HTTP $([int]$response.StatusCode)."
    }
    if ([string]::IsNullOrWhiteSpace($content)) { return $null }
    return $content | ConvertFrom-Json -AsHashtable
  } finally {
    if ($null -ne $response) { $response.Dispose() }
    $request.Dispose()
  }
}

function Get-GitHubCollection {
  param([Parameter(Mandatory)][string]$Path)
  $result = [System.Collections.Generic.List[object]]::new()
  for ($page = 1; $page -le 10; $page++) {
    $separator = if ($Path.Contains("?")) { "&" } else { "?" }
    $url = "$Path$($separator)per_page=100&page=$page"
    $items = @(Invoke-GitHub -Method GET -Path $url)
    foreach ($item in $items) { $result.Add($item) }
    if ($items.Count -lt 100) { return $result.ToArray() }
  }
  throw "GitHub returned more than 1,000 records for $Path; refusing an incomplete decision."
}

function Assert-CleanWorktree {
  $status = Invoke-Git -Arguments @("status", "--porcelain=v1", "--untracked-files=all")
  if ($status.Count) {
    $paths = @($status | ForEach-Object {
      $line = "$_"
      if ($line.Length -lt 4) { throw "Unrecognized Git status entry; refusing dirty worktree." }
      $line.Substring(3).Trim()
    })
    throw "Uncommitted or staged files are present and will never be staged automatically: $($paths -join ', ')"
  }
}

function Assert-PortableTaskConfiguration {
  $taskPath = Join-Path $script:Root ".vscode/tasks.json"
  if (-not (Test-Path -LiteralPath $taskPath)) { throw "The repository VS Code task file is missing." }
  $configuration = Get-Content -LiteralPath $taskPath -Raw | ConvertFrom-Json -AsHashtable
  $publishTasks = @($configuration.tasks | Where-Object { $_.label -eq "MoonDog: Publish Beta" })
  $syncTasks = @($configuration.tasks | Where-Object { $_.label -eq "MoonDog: Update main" })
  if ($publishTasks.Count -ne 1 -or $syncTasks.Count -ne 1) {
    throw "VS Code tasks must contain one publisher task and preserve one Update main task."
  }
  $task = $publishTasks[0]
  $arguments = @($task.args)
  $publisherArgument = [Array]::IndexOf($arguments, "-File") + 1
  $taskRunOptions = $task["runOptions"]
  if ($task.type -ne "process" -or $task.command -notin @("pwsh", "pwsh.exe") -or
      $publisherArgument -le 0 -or $publisherArgument -ge $arguments.Count -or
      $arguments[$publisherArgument] -ne '${workspaceFolder}/.vscode/publish-moondog-beta.ps1' -or
      "-Publish" -notin $arguments -or
      $task.options.cwd -ne '${workspaceFolder}' -or
      $null -ne $taskRunOptions) {
    throw "Publisher task must use the repository-relative script and require explicit manual invocation."
  }
  if ($syncTasks[0].runOptions.runOn -ne "folderOpen") {
    throw "The existing Update main folder-open task was not preserved."
  }
}

function Assert-Repository {
  $actualRoot = (Invoke-Git -Arguments @("rev-parse", "--show-toplevel") | Select-Object -First 1).Trim()
  if ([IO.Path]::GetFullPath($actualRoot) -ne [IO.Path]::GetFullPath($script:Root)) {
    throw "RepositoryRoot must name the current Git worktree."
  }
  $origin = (Invoke-Git -Arguments @("remote", "get-url", "origin") | Select-Object -First 1).Trim()
  if ($origin -ne $script:Origin) { throw "Unexpected origin remote; refusing to publish." }
  $branch = (Invoke-Git -Arguments @("branch", "--show-current") | Select-Object -First 1).Trim()
  if ([string]::IsNullOrWhiteSpace($branch) -or $branch -eq "main") {
    throw "Publish only from a named feature branch; main and detached HEAD are ineligible."
  }
  Assert-CleanWorktree
  $sha = (Invoke-Git -Arguments @("rev-parse", "HEAD") | Select-Object -First 1).Trim()
  $base = (Invoke-Git -Arguments @("rev-parse", "origin/main") | Select-Object -First 1).Trim()
  if ((Invoke-Git -Arguments @("merge-base", "HEAD", "origin/main") | Select-Object -First 1).Trim() -ne $base) {
    throw "Feature branch is not based on origin/main; synchronize it without rewriting history first."
  }
  if ((Invoke-Git -Arguments @("rev-list", "--count", "origin/main..HEAD") | Select-Object -First 1).Trim() -eq "0") {
    throw "Feature branch has no committed changes to publish."
  }
  $script:Branch = $branch
  $script:Head = $sha
  $script:Base = $base
  $script:Report.SHA = $sha
  return $branch
}

function Assert-SafeChangedPaths {
  $lines = Invoke-Git -Arguments @(
    "diff", "--name-status", "--find-renames", "$script:Base...$script:Head"
  )
  if (-not $lines.Count) { throw "Feature branch has no changed files." }
  $changes = [System.Collections.Generic.List[object]]::new()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $parts = "$($lines[$i])".Split("`t")
    $status = switch -Regex ($parts[0]) {
      "^A" { "added"; break }
      "^D" { "removed"; break }
      "^R" { "renamed"; break }
      "^C" { "copied"; break }
      default { "modified" }
    }
    $path = $parts[-1]
    $patch = ""
    if ($path.EndsWith(".css")) {
      $patch = (Invoke-Git -Arguments @(
        "diff", "--unified=0", "$script:Base...$script:Head", "--", $path
      )) -join "`n"
    }
    $changes.Add(@{ filename = $path; status = $status; patch = $patch })
  }
  $jsonPath = Join-Path ([IO.Path]::GetTempPath()) ("moondog-pr-risk-" + [guid]::NewGuid() + ".json")
  try {
    [IO.File]::WriteAllText($jsonPath, (ConvertTo-Json -InputObject $changes.ToArray() -Depth 20))
    $decision = (Invoke-Python -Arguments @(
      (Join-Path $script:Root "scripts/beta_change_risk.py"),
      $jsonPath, "--decision", "--expected", "$($changes.Count)"
    ) | Select-Object -Last 1).Trim()
  } finally {
    if (Test-Path -LiteralPath $jsonPath) { Remove-Item -LiteralPath $jsonPath -Force }
  }
  if ($decision -eq "protected") {
    throw "Repository policy classifies this change as protected; no push or PR was made."
  }
  $script:Risk = $decision
}

function Get-ManifestVersions {
  param([Parameter(Mandatory)][string]$Ref)
  $manifest = Invoke-GitHub -Method GET -Path "repos/$script:Repository/contents/updates/manifest.json?ref=$Ref"
  $bytes = [Convert]::FromBase64String(($manifest.content -replace "\s", ""))
  return [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -AsHashtable
}

function Get-ExactChecks {
  param([Parameter(Mandatory)][string]$Sha)
  $runs = Invoke-GitHub -Method GET -Path "repos/$script:Repository/actions/runs?head_sha=$Sha&per_page=100"
  $checks = Invoke-GitHub -Method GET -Path "repos/$script:Repository/commits/$Sha/check-runs?per_page=100"
  $specs = @(
    @{ Workflow = "Publication check"; File = ".github/workflows/publication-check.yml"; Check = "Publication Check" },
    @{ Workflow = "Clean Install Proof"; File = ".github/workflows/clean-install-proof.yml"; Check = "prove-clean-install" }
  )
  $states = [System.Collections.Generic.List[string]]::new()
  foreach ($spec in $specs) {
    $matchingRuns = @($runs.workflow_runs | Where-Object {
      $_.name -eq $spec.Workflow -and $_.path -eq $spec.File -and
      $_.head_sha -eq $Sha -and $_.event -eq "pull_request" -and
      $_.head_repository.full_name -eq $script:Repository
    } | Sort-Object created_at -Descending)
    if (-not $matchingRuns.Count) { $states.Add("pending"); continue }
    $run = $matchingRuns[0]
    if ($run.status -eq "completed" -and $run.conclusion -ne "success") {
      $states.Add("failure")
      continue
    }
    $matchingChecks = @($checks.check_runs | Where-Object {
      $_.name -eq $spec.Check -and $_.head_sha -eq $Sha -and
      $_.app.id -eq 15368 -and $_.check_suite.id -eq $run.check_suite_id
    } | Sort-Object started_at -Descending)
    if (-not $matchingChecks.Count -or $matchingChecks[0].status -ne "completed") {
      $states.Add("pending")
    } elseif ($matchingChecks[0].conclusion -eq "success") {
      $states.Add("success")
    } else {
      $states.Add("failure")
    }
  }
  return ,$states.ToArray()
}

function Test-PullRequestMerged {
  param([object]$PullRequest)
  return ($null -ne $PullRequest -and $PullRequest.merged -eq $true)
}

function Resolve-GuardedMergeTimeout {
  param(
    [Parameter(Mandatory)][object]$PullRequest,
    [Parameter(Mandatory)][string]$LastState,
    [Parameter(Mandatory)][string]$ChangeRisk
  )
  if (Test-PullRequestMerged -PullRequest $PullRequest) { return "merged" }
  if ($PullRequest.state -ne "open") { throw "PR was closed without a guarded merge." }
  if ($LastState -eq "success,success" -and $ChangeRisk -ne "automatic") {
    throw "Timed out waiting for guarded owner review/merge. Required owner action: review this exact PR head and submit an authorized review containing 'MoonDog-Owner-Review: approved'."
  }
  if ($LastState -eq "success,success") {
    throw "Timed out waiting for the repository's guarded automated data-proof merge. Inspect the Guarded PR Merge workflow result; no retry was attempted."
  }
  throw "Timed out waiting for exact-head checks (last state: $LastState). Inspect the failed or pending required check; no retry was attempted."
}

function Get-PostMergeCheckStates {
  param(
    [object[]]$Runs,
    [Parameter(Mandatory)][string]$Sha
  )
  $states = [ordered]@{
    Publication = "pending"
    HistorySafety = "pending"
  }
  $specs = @(
    @{ Key = "Publication"; Name = "Publication check"; File = ".github/workflows/publication-check.yml" },
    @{ Key = "HistorySafety"; Name = "Public Repository History Safety Audit"; File = ".github/workflows/public-history-safety-audit.yml" }
  )
  foreach ($spec in $specs) {
    $matching = @($Runs | Where-Object {
      $_.head_sha -eq $Sha -and $_.event -eq "push" -and
      $_.name -eq $spec.Name -and $_.path -eq $spec.File
    } | Sort-Object created_at -Descending)
    if (-not $matching.Count) { continue }
    if ($matching[0].status -eq "completed") {
      $states[$spec.Key] = if ($matching[0].conclusion -eq "success") { "success" } else { "failure" }
    }
  }
  return $states
}

function Get-RequestedMode {
  param(
    [bool]$PublishRequested,
    [bool]$DryRunRequested,
    [bool]$RecoveryRequested,
    [int]$RecoveryNumber
  )
  if ([int]$PublishRequested + [int]$DryRunRequested + [int]$RecoveryRequested -gt 1) {
    throw "Choose only one of -Publish, -DryRun, or -RecoverMergedPR."
  }
  if ($RecoveryRequested -and $RecoveryNumber -lt 1) {
    throw "-RecoverMergedPR requires a positive -PullRequestNumber."
  }
  if (-not $RecoveryRequested -and $RecoveryNumber -ne 0) {
    throw "-PullRequestNumber is only valid with -RecoverMergedPR."
  }
  if ($RecoveryRequested) { return "recover" }
  if ($PublishRequested) { return "publish" }
  return "dry-run"
}

function Assert-RequiredCheckStates {
  param([string[]]$States, [string]$Context)
  if ($States.Count -ne 2 -or @($States | Where-Object { $_ -ne "success" }).Count) {
    throw "$Context is not successful: $($States -join ', ')."
  }
}

function Get-PullRequest {
  $escapedBranch = [Uri]::EscapeDataString($script:Branch)
  $items = @(Get-GitHubCollection -Path "repos/$script:Repository/pulls?state=open&head=JHFMoon:$escapedBranch&base=main")
  if ($items.Count -gt 1) { throw "Multiple open PRs match the current feature branch." }
  if ($items.Count -eq 0) { return $null }
  return $items[0]
}

function Assert-PullRequest {
  param([Parameter(Mandatory)]$PullRequest, [string]$ExpectedSha = $script:Head)
  $failures = [System.Collections.Generic.List[string]]::new()
  if ($PullRequest.state -ne "open") { $failures.Add("not open") }
  if ($PullRequest.draft -ne $false) { $failures.Add("draft") }
  if ($PullRequest.base.ref -ne "main") { $failures.Add("base is not main") }
  if ($PullRequest.head.repo.full_name -ne $script:Repository) { $failures.Add("head is not same-repository") }
  if ($PullRequest.head.sha -ne $ExpectedSha) { $failures.Add("head SHA changed") }
  if ($PullRequest.author_association -notin @("OWNER", "MEMBER", "COLLABORATOR")) {
    $failures.Add("author association is not authorized")
  }
  if ($failures.Count) { throw "PR safety check failed: $($failures -join ', ')." }
}

function Get-PRFileList {
  param([int]$Number)
  return Get-GitHubCollection -Path "repos/$script:Repository/pulls/$Number/files"
}

function Assert-ExactPRScope {
  param([int]$Number)
  $files = @(Get-PRFileList -Number $Number)
  $expected = @(Invoke-Git -Arguments @(
    "diff", "--name-only", "--diff-filter=ACDMRTUXB", "$script:Base...$script:Head"
  ) | ForEach-Object { $_.Replace("\", "/") } | Sort-Object -Unique)
  $actual = @($files | ForEach-Object { $_.filename.Replace("\", "/") } | Sort-Object -Unique)
  if ((Compare-Object -ReferenceObject $expected -DifferenceObject $actual)) {
    throw "GitHub PR changed-file set differs from the committed local scope; refusing."
  }
  $riskPath = Join-Path ([IO.Path]::GetTempPath()) ("moondog-pr-api-risk-" + [guid]::NewGuid() + ".json")
  try {
    [IO.File]::WriteAllText($riskPath, (ConvertTo-Json -InputObject $files -Depth 30))
    $decision = (Invoke-Python -Arguments @(
      (Join-Path $script:Root "scripts/beta_change_risk.py"),
      $riskPath, "--decision", "--expected", "$($files.Count)"
    ) | Select-Object -Last 1).Trim()
  } finally {
    if (Test-Path -LiteralPath $riskPath) { Remove-Item -LiteralPath $riskPath -Force }
  }
  if ($decision -eq "protected") {
    throw "The exact GitHub PR scope is protected by repository policy."
  }
  $script:Risk = $decision
  return ,$files
}

function Get-PRBody {
  $template = Join-Path $script:Root ".github/PULL_REQUEST_TEMPLATE.md"
  if (-not (Test-Path -LiteralPath $template)) { throw "Required repository PR template is missing." }
  return [IO.File]::ReadAllText($template)
}

function Invoke-LocalChecksInByteExactCheckout {
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) ("moondog-beta-checks-" + [guid]::NewGuid())
  if (Test-Path -LiteralPath $testRoot) { throw "Temporary test worktree path already exists." }
  $setup = @(& git -c core.autocrlf=false -C $script:Root worktree add --detach $testRoot $script:Head 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Could not create byte-exact test worktree: $($setup -join ' ')" }
  try {
    Push-Location $testRoot
    try {
      $checks = @(
        @("python", @("-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py")),
        @("python", @("scripts/build_operating_modules.py", "--check")),
        @("python", @("scripts/build_distribution.py", "--check-source")),
        @("node", @("--test", "tests/*.test.cjs")),
        @("python", @("scripts/check_publication.py"))
      )
      foreach ($check in $checks) {
        $command = $check[0]
        $arguments = $check[1]
        $output = @(& $command @arguments 2>&1)
        if ($LASTEXITCODE -ne 0) {
          $tail = ($output | Select-Object -Last 30) -join "`n"
          throw "Local check failed in byte-exact Git checkout: $command $($arguments -join ' ')`n$tail"
        }
      }
    } finally {
      Pop-Location
    }
  } finally {
    $remaining = @(& git -C $testRoot status --porcelain=v1 --untracked-files=all 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "Could not inspect temporary test worktree; preserve it for investigation: $testRoot"
    }
    if ($remaining.Count) {
      throw "Python tests left files in their temporary worktree; preserve it for investigation: $testRoot"
    }
    & git -C $script:Root worktree remove $testRoot
    if ($LASTEXITCODE -ne 0) {
      throw "Could not remove the clean temporary Python test worktree: $testRoot"
    }
  }
}

function Invoke-LocalChecks {
  $script:Report.Tests = "RUNNING"
  Invoke-LocalChecksInByteExactCheckout
  $script:Report.Tests = "PASS (byte-exact Python/Node tests, runtime/source integrity, publication boundary)"
}

function Ensure-PullRequest {
  $pr = Get-PullRequest
  if ($null -ne $pr) {
    Assert-PullRequest -PullRequest $pr
    return $pr
  }
  $title = (Invoke-Git -Arguments @("log", "-1", "--format=%s", "HEAD") | Select-Object -First 1).Trim()
  if ([string]::IsNullOrWhiteSpace($title)) { throw "Latest commit has no usable PR title." }
  $body = Get-PRBody
  $payload = @{ title = $title; head = $script:Branch; base = "main"; body = $body; draft = $false }
  return Invoke-GitHub -Method POST -Path "repos/$script:Repository/pulls" -Body $payload
}

function Wait-ForGuardedMerge {
  param([Parameter(Mandatory)][int]$Number)
  $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
  $lastState = ""
  while ([DateTime]::UtcNow -lt $deadline) {
    $pr = Invoke-GitHub -Method GET -Path "repos/$script:Repository/pulls/$Number"
    if (Test-PullRequestMerged -PullRequest $pr) { return $pr }
    if ($pr.state -ne "open") { throw "PR was closed without a guarded merge." }
    Assert-PullRequest -PullRequest $pr
    $states = Get-ExactChecks -Sha $script:Head
    $state = $states -join ","
    if ($state -ne $lastState) {
      Write-Host "Exact-head CI: $state"
      $lastState = $state
    }
    if ($states -contains "failure") {
      throw "Required exact-head CI failed. No retry will be made; fix the reported failure and rerun."
    }
    if ($state -eq "success,success" -and $script:Report.OwnerAction -like "Waiting for*") {
      if ($script:Risk -eq "automatic") {
        $script:Report.OwnerAction = "None; waiting for the repository's automated data-proof guard. The publisher will not approve or merge."
      } else {
        $script:Report.OwnerAction = "Required owner action: review this exact PR head and submit an authorized review containing 'MoonDog-Owner-Review: approved'. The publisher will not approve or merge."
      }
      Write-Host "OwnerAction: $($script:Report.OwnerAction)"
    }
    Start-Sleep -Seconds 30
  }
  $finalPr = Invoke-GitHub -Method GET -Path "repos/$script:Repository/pulls/$Number"
  $decision = Resolve-GuardedMergeTimeout -PullRequest $finalPr -LastState $lastState -ChangeRisk $script:Risk
  if ($decision -eq "merged") { return $finalPr }
}

function Wait-ForPostMergeChecks {
  param([Parameter(Mandatory)][string]$MergeSha)
  $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
  $lastState = ""
  while ([DateTime]::UtcNow -lt $deadline) {
    $runs = Invoke-GitHub -Method GET -Path "repos/$script:Repository/actions/runs?head_sha=$MergeSha&per_page=100"
    $states = Get-PostMergeCheckStates -Runs $runs.workflow_runs -Sha $MergeSha
    $state = "Publication=$($states.Publication), HistorySafety=$($states.HistorySafety)"
    if ($state -ne $lastState) {
      Write-Host "Post-merge checks: $state"
      $lastState = $state
    }
    if ($states.Values -contains "failure") {
      throw "Post-merge verification failed: $state."
    }
    if ($states.Publication -eq "success" -and $states.HistorySafety -eq "success") { return }
    Start-Sleep -Seconds 30
  }
  $finalRuns = Invoke-GitHub -Method GET -Path "repos/$script:Repository/actions/runs?head_sha=$MergeSha&per_page=100"
  $finalStates = Get-PostMergeCheckStates -Runs $finalRuns.workflow_runs -Sha $MergeSha
  $finalState = "Publication=$($finalStates.Publication), HistorySafety=$($finalStates.HistorySafety)"
  if ($finalStates.Values -contains "failure") {
    throw "Post-merge verification failed at timeout boundary: $finalState."
  }
  if ($finalStates.Publication -eq "success" -and $finalStates.HistorySafety -eq "success") { return }
  throw "Timed out waiting for post-merge Publication and History Safety checks: $finalState."
}

function Sync-Main {
  Invoke-Git -Arguments @("fetch", "origin", "main") | Out-Null
  $worktreeLines = Invoke-Git -Arguments @("worktree", "list", "--porcelain")
  $candidate = $null
  $mainRoot = $null
  foreach ($line in $worktreeLines) {
    if ("$line" -like "worktree *") {
      $candidate = "$line".Substring(9)
    } elseif ("$line" -eq "branch refs/heads/main") {
      $mainRoot = $candidate
    }
  }
  if ($null -eq $mainRoot) {
    $branch = (Invoke-Git -Arguments @("branch", "--show-current") | Select-Object -First 1).Trim()
    if ($branch -eq "main") {
      $mainRoot = $script:Root
    } else {
      $status = Invoke-Git -Arguments @("status", "--porcelain=v1", "--untracked-files=all")
      if ($status.Count) { throw "Cannot switch this dirty worktree to main; preserve local changes." }
      Invoke-Git -Arguments @("switch", "main") | Out-Null
      $mainRoot = $script:Root
    }
  }
  $mainBranch = (& git -C $mainRoot branch --show-current 2>&1 | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or $mainBranch -ne "main") {
    throw "The selected local main worktree is not on main."
  }
  $mainStatus = @(& git -C $mainRoot status --porcelain=v1 --untracked-files=all 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect local main worktree status." }
  if ($mainStatus.Count) { throw "Local main worktree is dirty; preserving it without synchronization." }
  $mainHead = (& git -C $mainRoot rev-parse HEAD 2>&1 | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not determine local main HEAD." }
  & git -C $mainRoot merge-base --is-ancestor $mainHead origin/main 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Local main has commits not present on origin/main; refusing synchronization." }
  & git -C $mainRoot merge --ff-only origin/main
  if ($LASTEXITCODE -ne 0) { throw "Could not fast-forward the clean local main worktree." }
  $after = @(& git -C $mainRoot status --porcelain=v1 --untracked-files=all 2>&1)
  if ($LASTEXITCODE -ne 0 -or $after.Count) { throw "Local main did not remain clean after fast-forward." }
}

function Invoke-DryRun {
  param([scriptblock]$LocalChecks = { Invoke-LocalChecks })
  $script:Report.Status = "DRY RUN"
  $script:Report.PR = "NOT CREATED"
  Assert-SafeChangedPaths
  & $LocalChecks
  Write-Host "Dry run passed. No push, PR, approval, merge, or release operation was performed."
  Write-Host "Change classification: $script:Risk"
}

function Invoke-Publish {
  Assert-SafeChangedPaths
  Invoke-LocalChecks
  Initialize-GitHub
  $repo = Invoke-GitHub -Method GET -Path "repos/$script:Repository"
  if ($repo.full_name -ne $script:Repository -or $repo.permissions.push -ne $true) {
    throw "Authenticated GitHub access does not have push permission for the expected repository."
  }
  $remoteMain = Invoke-GitHub -Method GET -Path "repos/$script:Repository/branches/main"
  if ($remoteMain.commit.sha -ne $script:Base) {
    throw "origin/main is stale. Fetch and safely synchronize the feature branch before publishing."
  }
  $mainBefore = Get-ManifestVersions -Ref $script:Base
  $script:Report.Stable = $mainBefore.stable.version
  $script:Report.Beta = $mainBefore.beta.version
  Invoke-Git -Arguments @("push", "--set-upstream", "origin", $script:Branch) | Out-Null
  $pr = Ensure-PullRequest
  Assert-PullRequest -PullRequest $pr
  $script:Report.PR = "#$($pr.number)"
  $files = Assert-ExactPRScope -Number $pr.number
  if ($script:Risk -eq "protected") { throw "Protected change classification blocks publication." }
  if (-not $pr.body.Contains("MoonDog-Auto-Merge: yes")) {
    throw "PR template does not contain the repository guarded-merge authorization marker."
  }
  $script:Report.Status = "PUBLISHED — WAITING FOR GUARDED REVIEW"
  Write-Report -Status $script:Report.Status -OwnerAction "Waiting for the repository's exact-head checks and guarded review; no review or merge is performed by this script."
  $mergedPr = Wait-ForGuardedMerge -Number $pr.number
  $mergeSha = $mergedPr.merge_commit_sha
  if (-not $mergeSha) { throw "Merged PR has no recorded merge commit SHA." }
  $main = Invoke-GitHub -Method GET -Path "repos/$script:Repository/branches/main"
  $comparison = Invoke-GitHub -Method GET -Path "repos/$script:Repository/compare/$mergeSha...$($main.commit.sha)"
  if ($comparison.status -notin @("ahead", "identical")) {
    throw "GitHub main does not contain the guarded merge commit."
  }
  Wait-ForPostMergeChecks -MergeSha $main.commit.sha
  $mainAfter = Get-ManifestVersions -Ref $main.commit.sha
  if ($mainAfter.stable.version -ne $mainBefore.stable.version) {
    throw "Stable version changed during Beta publication; manual owner investigation is required."
  }
  $script:Report.SHA = $mergeSha
  $script:Report.Stable = $mainAfter.stable.version
  $script:Report.Beta = $mainAfter.beta.version
  if ($mainAfter.beta.version -ne $mainBefore.beta.version) {
    $script:Report.Beta = "$($mainAfter.beta.version) (published)"
  } else {
    $script:Report.Beta = "$($mainAfter.beta.version) (NOT APPLICABLE; no runtime package change)"
  }
  Sync-Main
  Write-Report -Status "VERIFIED"
}

function Invoke-RecoverMergedPR {
  param([Parameter(Mandatory)][int]$Number)
  $actualRoot = (& git -C $script:Root rev-parse --show-toplevel 2>&1 | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($actualRoot) -ne [IO.Path]::GetFullPath($script:Root)) {
    throw "RepositoryRoot must name the current Git worktree."
  }
  $origin = (& git -C $script:Root remote get-url origin 2>&1 | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or $origin -ne $script:Origin) { throw "Unexpected origin remote; refusing recovery." }
  Initialize-GitHub
  $pr = Invoke-GitHub -Method GET -Path "repos/$script:Repository/pulls/$Number"
  if ($pr.merged -ne $true -or $pr.base.ref -ne "main" -or
      $pr.base.repo.full_name -ne $script:Repository -or
      $pr.head.repo.full_name -ne $script:Repository) {
    throw "Recovery requires an already-merged same-repository PR targeting main."
  }
  if (-not $pr.merge_commit_sha -or -not $pr.base.sha) {
    throw "Merged PR is missing its merge or base SHA; recovery cannot verify manifests."
  }
  $main = Invoke-GitHub -Method GET -Path "repos/$script:Repository/branches/main"
  $comparison = Invoke-GitHub -Method GET -Path "repos/$script:Repository/compare/$($pr.merge_commit_sha)...$($main.commit.sha)"
  if ($comparison.status -notin @("ahead", "identical")) {
    throw "GitHub main does not contain the guarded PR merge commit."
  }
  $script:Branch = $pr.head.ref
  $script:Head = $pr.head.sha
  $script:Base = $pr.base.sha
  $exactStates = Get-ExactChecks -Sha $script:Head
  Assert-RequiredCheckStates -States $exactStates -Context "Exact-head Publication Check and Clean Install Proof"
  $guardRuns = Invoke-GitHub -Method GET -Path "repos/$script:Repository/actions/runs?head_sha=$($script:Head)&per_page=100"
  $guard = @($guardRuns.workflow_runs | Where-Object {
    $_.name -eq "Guarded PR Merge" -and $_.path -eq ".github/workflows/guarded-pr-merge.yml" -and
    $_.event -eq "pull_request_target" -and $_.head_sha -eq $script:Head -and
    $_.status -eq "completed" -and $_.conclusion -eq "success"
  } | Sort-Object created_at -Descending | Select-Object -First 1)
  if (-not $guard.Count) { throw "No successful exact-head Guarded PR Merge workflow was found." }
  Wait-ForPostMergeChecks -MergeSha $main.commit.sha
  $baseManifest = Get-ManifestVersions -Ref $pr.base.sha
  $mainManifest = Get-ManifestVersions -Ref $main.commit.sha
  if ($baseManifest.stable.version -ne $mainManifest.stable.version) {
    throw "Stable version changed since the PR base; recovery stopped for owner investigation."
  }
  $script:Report.PR = "#$Number"
  $script:Report.SHA = $pr.merge_commit_sha
  $script:Report.Tests = "PASS (verified guarded merge and post-merge checks)"
  $script:Report.Stable = $mainManifest.stable.version
  if ($baseManifest.beta.version -eq $mainManifest.beta.version) {
    $script:Report.Beta = "$($mainManifest.beta.version) (NOT APPLICABLE; no runtime package change)"
  } else {
    $script:Report.Beta = "$($mainManifest.beta.version) (published)"
  }
  Sync-Main
  Write-Report -Status "VERIFIED (RECOVERED)"
}

function Invoke-SelfTest {
  $originalRoot = if (Test-Path variable:script:Root) { $script:Root } else { $null }
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("moondog-publisher-selftest-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  function Assert-Test([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Self-test failed: $Message" }
    $script:SelfTestAssertions++
  }
  $script:SelfTestAssertions = 0
  try {
    $script:Root = $tempRoot
    & git -C $tempRoot init --initial-branch main | Out-Null
    & git -C $tempRoot config user.name "Publisher Self-Test"
    & git -C $tempRoot config user.email "publisher-self-test@example.invalid"
    New-Item -ItemType Directory -Path (Join-Path $tempRoot "tests") | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $tempRoot ".vscode") | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $tempRoot "scripts") | Out-Null
    Copy-Item -LiteralPath (Join-Path $originalRoot "scripts/beta_change_risk.py") `
      -Destination (Join-Path $tempRoot "scripts/beta_change_risk.py")
    [IO.File]::WriteAllText((Join-Path $tempRoot "README.md"), "synthetic`n")
    $publishTask = [ordered]@{
      label = "MoonDog: Publish Beta"
      type = "process"
      command = "pwsh"
      args = @(
        "-NoProfile", "-NonInteractive", "-File",
        '${workspaceFolder}/.vscode/publish-moondog-beta.ps1',
        "-RepositoryRoot", '${workspaceFolder}', "-Publish"
      )
      options = [ordered]@{ cwd = '${workspaceFolder}' }
      problemMatcher = @()
    }
    $updateTask = [ordered]@{
      label = "MoonDog: Update main"
      runOptions = [ordered]@{ runOn = "folderOpen" }
    }
    [IO.File]::WriteAllText((Join-Path $tempRoot ".vscode/tasks.json"),
      (ConvertTo-Json -InputObject ([ordered]@{ version = "2.0.0"; tasks = @($publishTask, $updateTask) }) -Depth 20 -Compress))
    & git -C $tempRoot add README.md .vscode/tasks.json scripts/beta_change_risk.py
    & git -C $tempRoot commit -m "test: create publisher fixture" | Out-Null
    $base = (Invoke-Git -Arguments @("rev-parse", "HEAD") | Select-Object -First 1).Trim()
    Assert-CleanWorktree
    Assert-PortableTaskConfiguration
    Assert-Test $true "portable publisher task is explicit and startup sync task remains"
    Assert-Test ((Get-RequestedMode -PublishRequested $false -DryRunRequested $false `
      -RecoveryRequested $false -RecoveryNumber 0) -eq "dry-run") "default mode is dry run"
    Assert-Test ((Get-RequestedMode -PublishRequested $true -DryRunRequested $false `
      -RecoveryRequested $false -RecoveryNumber 0) -eq "publish") "publish requires an explicit switch"
    $invalidModes = $false
    try { Get-RequestedMode -PublishRequested $true -DryRunRequested $true `
        -RecoveryRequested $false -RecoveryNumber 0 | Out-Null }
    catch { $invalidModes = $true }
    Assert-Test $invalidModes "conflicting operation modes are rejected"
    $missingRecoveryNumber = $false
    try { Get-RequestedMode -PublishRequested $false -DryRunRequested $false `
        -RecoveryRequested $true -RecoveryNumber 0 | Out-Null }
    catch { $missingRecoveryNumber = $true }
    Assert-Test $missingRecoveryNumber "recovery requires an explicit PR number"
    & git -C $tempRoot switch -c "test/publisher-self-test" | Out-Null
    [IO.File]::WriteAllText((Join-Path $tempRoot "tests/publisher-self-test.test.cjs"), "test('synthetic',()=>{});`n")
    & git -C $tempRoot add tests/publisher-self-test.test.cjs
    & git -C $tempRoot commit -m "test: add synthetic publisher fixture" | Out-Null
    $script:Base = $base
    $script:Head = (Invoke-Git -Arguments @("rev-parse", "HEAD") | Select-Object -First 1).Trim()
    Assert-SafeChangedPaths
    Assert-Test ($script:Risk -eq "automatic") "eligible synthetic test scope"
    Assert-CleanWorktree
    $script:SelfTestDryRunChecks = 0
    Invoke-DryRun -LocalChecks {
      $script:SelfTestDryRunChecks++
      $script:Report.Tests = "PASS (synthetic self-test checks)"
    }
    Assert-Test ($script:SelfTestDryRunChecks -eq 1 -and $script:Report.Status -eq "DRY RUN" `
      -and $script:Report.PR -eq "NOT CREATED") "dry run executes checks without remote publication"
    Assert-Test ($script:Origin -eq "https://github.com/JHFMoon/MoonDog-Service-OS.git") "expected origin"
    Assert-Test ($script:Repository -eq "JHFMoon/MoonDog-Service-OS") "expected repository"
    Assert-Test ("MoonDog-Auto-Merge: yes".Contains("MoonDog-Auto-Merge: yes")) "template authorization marker"
    Assert-Test (Test-PullRequestMerged -PullRequest @{ merged = $true }) "externally completed PR is recognized"
    Assert-Test (-not (Test-PullRequestMerged -PullRequest @{ merged = $false })) "unmerged PR is not treated as complete"
    Assert-Test ((Resolve-GuardedMergeTimeout -PullRequest @{ merged = $true; state = "closed" } `
      -LastState "success,success" -ChangeRisk "automatic") -eq "merged") `
      "timeout-boundary recheck recognizes an already merged PR"
    $pendingTimeout = $false
    try { Resolve-GuardedMergeTimeout -PullRequest @{ merged = $false; state = "open" } `
        -LastState "pending,success" -ChangeRisk "automatic" | Out-Null }
    catch { $pendingTimeout = $_.Exception.Message -like "*pending required check*" }
    Assert-Test $pendingTimeout "pending exact-head checks produce an actionable timeout"
    $reviewTimeout = $false
    try { Resolve-GuardedMergeTimeout -PullRequest @{ merged = $false; state = "open" } `
        -LastState "success,success" -ChangeRisk "review-required" | Out-Null }
    catch { $reviewTimeout = $_.Exception.Message -like "*owner review*" }
    Assert-Test $reviewTimeout "review-required changes are never auto-approved"
    $syntheticSha = "a" * 40
    $pendingRuns = @(
      @{ head_sha = $syntheticSha; event = "push"; name = "Publication check"; path = ".github/workflows/publication-check.yml"; status = "completed"; conclusion = "success"; created_at = "2026-01-01T00:00:00Z" },
      @{ head_sha = $syntheticSha; event = "push"; name = "Publication check"; path = ".github/workflows/publication-check.yml"; status = "in_progress"; conclusion = $null; created_at = "2026-01-01T00:01:00Z" },
      @{ head_sha = $syntheticSha; event = "push"; name = "Public Repository History Safety Audit"; path = ".github/workflows/public-history-safety-audit.yml"; status = "completed"; conclusion = "success"; created_at = "2026-01-01T00:01:00Z" }
    )
    $pendingStates = Get-PostMergeCheckStates -Runs $pendingRuns -Sha $syntheticSha
    Assert-Test ($pendingStates.Publication -eq "pending" -and $pendingStates.HistorySafety -eq "success") `
      "new in-progress post-merge run takes precedence over an older success"
    $requiredFailure = $false
    try { Assert-RequiredCheckStates -States @("success", "failure") -Context "Synthetic gates" }
    catch { $requiredFailure = $_.Exception.Message -like "*success, failure*" }
    Assert-Test $requiredFailure "a failed exact-head requirement blocks recovery"
    $requiredPending = $false
    try { Assert-RequiredCheckStates -States @("success", "pending") -Context "Synthetic gates" }
    catch { $requiredPending = $_.Exception.Message -like "*success, pending*" }
    Assert-Test $requiredPending "a pending exact-head requirement blocks recovery"
    Assert-RequiredCheckStates -States @("success", "success") -Context "Synthetic gates"
    Assert-Test $true "both exact-head required checks permit recovery"
    $successfulRuns = @($pendingRuns | Where-Object {
      $_.name -ne "Publication check" -or $_.status -ne "in_progress"
    })
    $successStates = Get-PostMergeCheckStates -Runs $successfulRuns -Sha $syntheticSha
    Assert-Test ($successStates.Publication -eq "success" -and $successStates.HistorySafety -eq "success") `
      "completed post-merge checks are recognized"
    $failedRuns = @($successfulRuns | ForEach-Object {
      if ($_.name -eq "Public Repository History Safety Audit") {
        $copy = @{} + $_
        $copy.conclusion = "failure"
        $copy
      } else { $_ }
    })
    $failedStates = Get-PostMergeCheckStates -Runs $failedRuns -Sha $syntheticSha
    Assert-Test ($failedStates.Publication -eq "success" -and $failedStates.HistorySafety -eq "failure") `
      "failed post-merge checks remain failures"
    [IO.File]::WriteAllText((Join-Path $tempRoot "private-local.txt"), "synthetic")
    $blocked = $false
    try { Assert-CleanWorktree } catch { $blocked = $true }
    Assert-Test $blocked "uncommitted source files are rejected"
    Remove-Item -LiteralPath (Join-Path $tempRoot "private-local.txt") -Force
    New-Item -ItemType Directory -Path (Join-Path $tempRoot "docs") | Out-Null
    [IO.File]::WriteAllText((Join-Path $tempRoot "docs/RELEASE-AUTHORIZATION.md"), "synthetic")
    & git -C $tempRoot add docs/RELEASE-AUTHORIZATION.md
    & git -C $tempRoot commit -m "docs: add protected fixture" | Out-Null
    $script:Head = (Invoke-Git -Arguments @("rev-parse", "HEAD") | Select-Object -First 1).Trim()
    $protected = $false
    try { Assert-SafeChangedPaths } catch { $protected = $_.Exception.Message -like "*protected*" }
    Assert-Test $protected "protected change scope is rejected"
    Write-Host "Publisher self-test passed ($script:SelfTestAssertions assertions)."
  } finally {
    $script:Root = $originalRoot
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

try {
  $script:Root = [IO.Path]::GetFullPath($RepositoryRoot)
  if (-not (Test-Path -LiteralPath $script:Root -PathType Container)) {
    throw "RepositoryRoot does not exist."
  }
  if ($SelfTest) {
    Invoke-SelfTest
    exit 0
  }
  $mode = Get-RequestedMode -PublishRequested $Publish.IsPresent `
    -DryRunRequested $DryRun.IsPresent -RecoveryRequested $RecoverMergedPR.IsPresent `
    -RecoveryNumber $PullRequestNumber
  Assert-PortableTaskConfiguration
  switch ($mode) {
    "recover" { Invoke-RecoverMergedPR -Number $PullRequestNumber }
    "dry-run" {
      Assert-Repository | Out-Null
      Invoke-DryRun
      Write-Report -Status "DRY RUN"
    }
    "publish" {
      Assert-Repository | Out-Null
      Invoke-Publish
    }
  }
} catch {
  $message = $_.Exception.Message
  if ($script:Report.Tests -eq "RUNNING") { $script:Report.Tests = "FAILED" }
  Write-Host "BLOCKED: $message" -ForegroundColor Red
  Write-Report -Status "BLOCKED" -OwnerAction $message
  exit 2
} finally {
  if ($null -ne $script:Http) { $script:Http.Dispose() }
}
