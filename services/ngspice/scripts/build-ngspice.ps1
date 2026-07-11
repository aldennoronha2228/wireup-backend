$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$ngspiceDir = Join-Path $root "vendor\ngspice"
$buildDir = Join-Path $ngspiceDir "build"

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
Set-Location $ngspiceDir

if (-not (Test-Path (Join-Path $ngspiceDir "configure"))) {
  Write-Error "configure script not found. Run autogen.sh via MSYS2 or WSL before building."
}

Set-Location $buildDir

& "../configure" --enable-xspice --disable-debug --with-ngshared --prefix="$buildDir/dist"
& make -j2
& make install

Write-Output "ngspice built at $buildDir/dist"
