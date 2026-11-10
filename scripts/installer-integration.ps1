# Mutates only a disposable GitHub Windows runner. Never run on a user's installation.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Esta prueba de instalación solo se ejecuta en un runner Windows de GitHub Actions.'
}
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($repositoryRoot -ne [IO.Path]::GetFullPath($env:GITHUB_WORKSPACE)) { throw 'El repositorio no coincide con el espacio temporal de Actions.' }
$version = (Get-Content (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $repositoryRoot "release/PhoneGest-Barcode-Studio-$version-Instalador.exe"
$expectedHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA512).Hash
$temporaryRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$first = [IO.Path]::GetFullPath((Join-Path $temporaryRoot "phonegest-install-$env:GITHUB_RUN_ID/PhoneGest Barcode Studio"))
$moved = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'build/installation-moved/PhoneGest Barcode Studio'))
if (-not $first.StartsWith($temporaryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    -not $moved.StartsWith($repositoryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Las rutas de prueba deben permanecer en los directorios temporales previstos.'
}
function Invoke-PreviewInstaller([string]$destination) {
  # NSIS requires /D to be the final argument; its remaining text is the full path.
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser', "/D=$destination") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Falló la instalación de prueba: $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath (Join-Path $destination 'PhoneGest Barcode Studio.exe'))) { throw "No se instaló en $destination" }
  $receipt = Get-Content (Join-Path $destination 'resources/phonegest-installer.json') -Raw | ConvertFrom-Json
  if ($receipt.version -cne $version -or $receipt.sha512Hex -ine $expectedHash) { throw 'El registro sin conexión no coincide con el instalador ejecutado.' }
}
Invoke-PreviewInstaller $first
$sessionDirectory = Join-Path $env:APPDATA 'PhoneGest Barcode Studio'
New-Item -ItemType Directory -Path $sessionDirectory -Force | Out-Null
$sessionFile = Join-Path $sessionDirectory 'session.json'
$sessionText = '{"codes":["PG-INSTALL-TEST"],"dates":["2026-11-10"],"settings":{"layout":"comfortable","startNumber":17},"theme":"dark","input":"BORRADOR-CONSERVADO"}'
[IO.File]::WriteAllText($sessionFile, $sessionText)
Invoke-PreviewInstaller $moved
if (Test-Path -LiteralPath (Join-Path $first 'PhoneGest Barcode Studio.exe')) { throw 'La instalación anterior sigue activa en la carpeta original.' }
if ([IO.File]::ReadAllText($sessionFile) -cne $sessionText) { throw 'El cambio de ubicación no conservó la sesión.' }
$cachedInstaller = Join-Path $env:LOCALAPPDATA 'phonegest-barcode-studio-updater/installer.exe'
if ((Get-FileHash -LiteralPath $cachedInstaller -Algorithm SHA512).Hash -ine $expectedHash) { throw 'No se conservó la copia del instalador para mantenimiento sin conexión.' }
$report = @{ success = $true; version = $version; first = $first; moved = $moved; installerHashVerified = $true; sessionPreserved = $true; cachedInstallerVerified = $true }
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repositoryRoot 'build/installer-integration.json') -Encoding utf8
$report | ConvertTo-Json
