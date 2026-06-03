param(
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "[agents-setup] $Message"
}

function Resolve-AppDataDir {
  $bootstrapPath = Join-Path $env:APPDATA "github-repo-manager\bootstrap.json"
  if (Test-Path -LiteralPath $bootstrapPath) {
    $bootstrap = Get-Content -LiteralPath $bootstrapPath -Raw | ConvertFrom-Json
    if ($bootstrap.dataDir -and [string]$bootstrap.dataDir -ne "") {
      return [string]$bootstrap.dataDir
    }
  }

  if ($env:LOCALAPPDATA -and [string]$env:LOCALAPPDATA -ne "") {
    return Join-Path $env:LOCALAPPDATA "github-repo-manager"
  }

  throw "Cannot locate github-repo-manager data directory."
}

function Resolve-ConfiguredAgentsPath([string]$ConfigPath) {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Missing app config: $ConfigPath"
  }

  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $cliPath = [string]$config.agents.cliPath
  if ([string]::IsNullOrWhiteSpace($cliPath)) {
    throw "agents.cliPath is empty. Configure the agents CLI path in Settings first."
  }

  return $cliPath.Trim()
}

function First-ExistingFile([string[]]$Candidates) {
  foreach ($candidate in $Candidates) {
    if ((Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

function Test-CurrentPlatformIsWindows {
  return ($PSVersionTable.PSEdition -eq "Desktop") -or ($IsWindows -eq $true)
}

function Resolve-AgentsEntry([string]$ConfiguredPath) {
  if (-not (Test-Path -LiteralPath $ConfiguredPath)) {
    throw "Configured agents path does not exist: $ConfiguredPath"
  }

  $resolved = (Resolve-Path -LiteralPath $ConfiguredPath).Path
  $item = Get-Item -LiteralPath $resolved
  if (-not $item.PSIsContainer) {
    $extension = [IO.Path]::GetExtension($resolved)
    if ((Test-CurrentPlatformIsWindows) -and [string]::IsNullOrEmpty($extension)) {
      $shim = First-ExistingFile @("$resolved.cmd", "$resolved.bat", "$resolved.exe")
      if ($shim) { return $shim }
    }
    return $resolved
  }

  $candidates = if (Test-CurrentPlatformIsWindows) {
    @(
      (Join-Path $resolved "bin\agents.cmd"),
      (Join-Path $resolved "bin\agents.bat"),
      (Join-Path $resolved "agents.cmd"),
      (Join-Path $resolved "agents.bat"),
      (Join-Path $resolved "bin\agents.exe"),
      (Join-Path $resolved "agents.exe"),
      (Join-Path $resolved "bin\agents"),
      (Join-Path $resolved "agents")
    )
  } else {
    @(
      (Join-Path $resolved "bin/agents"),
      (Join-Path $resolved "agents"),
      (Join-Path $resolved "bin/agents.cmd"),
      (Join-Path $resolved "bin/agents.bat"),
      (Join-Path $resolved "agents.cmd"),
      (Join-Path $resolved "agents.bat")
    )
  }

  $entry = First-ExistingFile $candidates
  if (-not $entry) {
    throw "No agents executable was found under: $resolved"
  }

  return $entry
}

function Resolve-AgentsSourceRoot([string]$EntryPath) {
  $leaf = [IO.Path]::GetFileName($EntryPath).ToLowerInvariant()
  $supportedNames = @("agents", "agents.cmd", "agents.bat", "agents.exe")
  if ($supportedNames -notcontains $leaf) {
    throw "Configured path resolves to a non-agents executable: $EntryPath"
  }

  $parent = [IO.Path]::GetDirectoryName($EntryPath)
  $parentName = [IO.Path]::GetFileName($parent.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar))
  $sourceRoot = if ($parentName.ToLowerInvariant() -eq "bin") {
    [IO.Path]::GetDirectoryName($parent)
  } else {
    $parent
  }

  $packageJsonPath = Join-Path $sourceRoot "package.json"
  if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    throw "Configured agents path is not an @agents-dev/cli source checkout: $sourceRoot"
  }

  $packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
  if ([string]$packageJson.name -ne "@agents-dev/cli") {
    throw "Configured agents path is not @agents-dev/cli: $sourceRoot"
  }

  return $sourceRoot
}

function Invoke-CheckedCommand([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
  Write-Step ("Running: {0} {1}" -f $FilePath, ($Arguments -join " "))
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

$dataDir = Resolve-AppDataDir
$configPath = Join-Path $dataDir "config.json"
$configuredPath = Resolve-ConfiguredAgentsPath $configPath
$entryPath = Resolve-AgentsEntry $configuredPath
$sourceRoot = Resolve-AgentsSourceRoot $entryPath
$distCli = Join-Path $sourceRoot "dist\cli.js"
$typescriptCli = Join-Path $sourceRoot "node_modules\typescript\bin\tsc"

Write-Step "Data dir: $dataDir"
Write-Step "Config: $configPath"
Write-Step "Configured agents path: $configuredPath"
Write-Step "Resolved agents entry: $entryPath"
Write-Step "Agents source root: $sourceRoot"

if ($DryRun) {
  if ($Force -or -not (Test-Path -LiteralPath $typescriptCli -PathType Leaf)) {
    Write-Step "Would run: npm install"
  } else {
    Write-Step "Would skip npm install because TypeScript is already present. Use --force to reinstall."
  }
  Write-Step "Would run: npm run build"
  exit 0
}

if ($Force -or -not (Test-Path -LiteralPath $typescriptCli -PathType Leaf)) {
  Invoke-CheckedCommand "npm" @("install") $sourceRoot
} else {
  Write-Step "Skipping npm install because TypeScript is already present. Use --force to reinstall."
}

Invoke-CheckedCommand "npm" @("run", "build") $sourceRoot

if (-not (Test-Path -LiteralPath $distCli -PathType Leaf)) {
  throw "Build finished, but dist CLI is still missing: $distCli"
}

Write-Step "agents CLI is ready: $distCli"
