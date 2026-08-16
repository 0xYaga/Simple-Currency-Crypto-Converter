[CmdletBinding()]
param(
  [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function Get-RelativePackagePath([string]$ProjectRoot, [string]$FilePath) {
  $rootUri = [Uri]::new(($ProjectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar))
  $fileUri = [Uri]::new($FilePath)
  return [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($fileUri).ToString()).Replace("\", "/")
}

function Get-SourceFiles([string]$ProjectRoot) {
  $rootFiles = @("app.js", "background.js", "manifest.json", "popup.css", "popup.html", "README.md", "sidebar.html")
  $sourceDirectories = @("_locales", "icons", "modules")
  $files = [System.Collections.Generic.List[string]]::new()
  foreach ($file in $rootFiles) { $files.Add((Join-Path $ProjectRoot $file)) }
  foreach ($directory in $sourceDirectories) {
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot $directory) -Recurse -File |
      Sort-Object FullName |
      ForEach-Object { $files.Add($_.FullName) }
  }
  return $files
}

function Get-StreamHash([IO.Stream]$Stream) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha256.ComputeHash($Stream)).Replace("-", "") }
  finally { $sha256.Dispose() }
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot "manifest.json") -Raw | ConvertFrom-Json
if (-not $ArchivePath) {
  $ArchivePath = Join-Path $projectRoot ("dist\converter-v{0}.xpi" -f $manifest.version)
}
$resolvedArchivePath = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $resolvedArchivePath -PathType Leaf)) {
  throw "XPI archive does not exist: $resolvedArchivePath"
}

$expected = @{}
foreach ($file in Get-SourceFiles $projectRoot) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required package file is missing: $file" }
  $expected[(Get-RelativePackagePath $projectRoot $file)] = $file
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedArchivePath)
try {
  $entries = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith("/") })
  $actualNames = @($entries | ForEach-Object FullName | Sort-Object)
  $expectedNames = @($expected.Keys | Sort-Object)
  $difference = Compare-Object -ReferenceObject $expectedNames -DifferenceObject $actualNames
  if ($difference) { throw "XPI file list differs from the approved package scope: $($difference | Out-String)" }

  foreach ($entry in $entries) {
    $entryStream = $entry.Open()
    try {
      $entryHash = Get-StreamHash $entryStream
      $fileStream = [IO.File]::OpenRead($expected[$entry.FullName])
      try { $fileHash = Get-StreamHash $fileStream } finally { $fileStream.Dispose() }
      if ($entryHash -ne $fileHash) { throw "XPI content differs from source: $($entry.FullName)" }
    } finally {
      $entryStream.Dispose()
    }
  }

  $manifestEntry = $archive.GetEntry("manifest.json")
  $reader = [IO.StreamReader]::new($manifestEntry.Open())
  try { $packagedManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  if ($packagedManifest.version -ne $manifest.version) { throw "Packaged manifest version differs from source." }
} finally {
  $archive.Dispose()
}

Write-Output "Verified $resolvedArchivePath against the approved package scope."
