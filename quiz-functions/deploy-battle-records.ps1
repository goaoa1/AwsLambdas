# Battle records read deploy (마도서 창의 전투 기록, 2026-11-24): AWS SSO login (approve in the browser), then build + deploy GetBattleRecords only.
#   & C:\Users\inchul\Documents\layers\quiz-functions\deploy-battle-records.ps1
Set-Location -LiteralPath $PSScriptRoot
aws sso login --profile inchul
if ($LASTEXITCODE -ne 0) { Write-Host 'SSO login did not finish - nothing was deployed.'; exit 1 }
node build-battle.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'Build failed - nothing was deployed.'; exit 1 }
node deploy-battle.mjs --only GetBattleRecords
