# Одноразовая загрузка сгенерированных фото автомобилей и их оптимизация в src/assets/photos.
# Запуск: pwsh scripts/dev/fetch-cars.ps1
$ErrorActionPreference = 'Stop'
$src = 'incoming\generated2'
$out = 'src\assets\photos'
New-Item -ItemType Directory -Force $src | Out-Null
$base = 'https://d8j0ntlcm91z4.cloudfront.net/user_3HcVX9vTwjUhcjHLALKyP4s1et6/'
$files = @{
  'econom'  = 'hf_20261012_085653_db1eac3b-d04c-4d80-be86-1e5dc920e90d.png'
  'basic'   = 'hf_20261012_085657_daec1c3b-df0f-4112-8c6d-9918c804b7dc.png'
  'premium' = 'hf_20261012_085700_cc10c2f5-8b42-4d37-bb1e-4ac6a78e91d8.png'
  'ultima'  = 'hf_20261012_085707_99d80c68-be91-4120-afad-0e37cf064e46.png'
}
foreach ($tier in $files.Keys) {
  $png = "$src\car-$tier.png"
  Invoke-WebRequest -Uri ($base + $files[$tier]) -OutFile $png
  ffmpeg -v error -y -i $png -vf 'scale=900:-2' -q:v 5 "$src\car-$tier.preview.jpg"
  foreach ($w in 1600, 960) {
    $q = if ($w -eq 1600) { 80 } else { 78 }
    $crf = if ($w -eq 1600) { 30 } else { 32 }
    ffmpeg -v error -y -i $png -vf "scale=${w}:-2:flags=lanczos" -c:v libwebp -quality $q "$out\car-$tier-$w.webp"
    ffmpeg -v error -y -i $png -vf "scale=${w}:-2:flags=lanczos" -c:v libsvtav1 -crf $crf -preset 5 -frames:v 1 "$out\car-$tier-$w.avif" 2>$null
  }
  Write-Output "[OK] $tier"
}
