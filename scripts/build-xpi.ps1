[CmdletBinding()]
param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function Get-RelativePackagePath([string]$ProjectRoot, [string]$FilePath) {
  $rootUri = [Uri]::new(($ProjectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar))
  $fileUri = [Uri]::new($FilePath)
  return [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($fileUri).ToString()).Replace("\", "/")
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot "dist"
}
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') {
  throw "manifest.json has an invalid extension version."
}

$rootFiles = @("app.js", "background.js", "manifest.json", "popup.css", "popup.html", "README.md", "sidebar.html")
$sourceDirectories = @("_locales", "icons", "modules")
$files = [System.Collections.Generic.List[string]]::new()
foreach ($file in $rootFiles) {
  $path = Join-Path $projectRoot $file
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required package file is missing: $file" }
  $files.Add($path)
}
foreach ($directory in $sourceDirectories) {
  $path = Join-Path $projectRoot $directory
  if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Required package directory is missing: $directory" }
  Get-ChildItem -LiteralPath $path -Recurse -File | Sort-Object FullName | ForEach-Object { $files.Add($_.FullName) }
}

$resolvedOutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($resolvedOutputDirectory) | Out-Null
$archivePath = Join-Path $resolvedOutputDirectory ("converter-v{0}.xpi" -f $manifest.version)
$temporaryPath = Join-Path $resolvedOutputDirectory (".{0}.{1}.tmp" -f [IO.Path]::GetFileName($archivePath), [guid]::NewGuid().ToString("N"))

try {
  $archive = [System.IO.Compression.ZipFile]::Open($temporaryPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files | Sort-Object) {
      $relativePath = Get-RelativePackagePath $projectRoot $file
      $entry = $archive.CreateEntry($relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
      $input = [IO.File]::OpenRead($file)
      try {
        $output = $entry.Open()
        try { $input.CopyTo($output) } finally { $output.Dispose() }
      } finally {
        $input.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
  Move-Item -LiteralPath $temporaryPath -Destination $archivePath -Force
} finally {
  if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
    [IO.File]::Delete($temporaryPath)
  }
}
Write-Output "Built $archivePath"
