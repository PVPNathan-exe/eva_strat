# Reconnaissance de texte (OCR) intégrée à Windows : lit une liste d'images et écrit un JSON sur la sortie standard.
# Usage : powershell -NoProfile -ExecutionPolicy Bypass -File ocr_win.ps1 -ListFile liste.txt
# Chaque ligne de liste.txt est le chemin d'une image. Sortie : [{ "path", "lines": [{ "text", "x", "y", "w", "h" }] }]
param([Parameter(Mandatory = $true)][string]$ListFile)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, $type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw "Aucune langue de reconnaissance de texte installée sur ce PC." }

$out = New-Object System.Collections.ArrayList
foreach ($raw in (Get-Content -LiteralPath $ListFile -Encoding UTF8)) {
    $path = [string]$raw
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $lines = New-Object System.Collections.ArrayList
    foreach ($line in $res.Lines) {
        $x0 = [double]::MaxValue; $y0 = [double]::MaxValue; $x1 = 0.0; $y1 = 0.0
        foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            if ($r.X -lt $x0) { $x0 = $r.X }
            if ($r.Y -lt $y0) { $y0 = $r.Y }
            if ($r.X + $r.Width -gt $x1) { $x1 = $r.X + $r.Width }
            if ($r.Y + $r.Height -gt $y1) { $y1 = $r.Y + $r.Height }
        }
        [void]$lines.Add([ordered]@{ text = [string]$line.Text; x = $x0; y = $y0; w = ($x1 - $x0); h = ($y1 - $y0) })
    }
    [void]$out.Add([ordered]@{ path = [string]$path; lines = @($lines) })
}
ConvertTo-Json -InputObject @($out) -Depth 5 -Compress
