# Gear + skill levels deploy (장비 · 스킬 G1, 2026-11-25 — 게임 저장소 Docs/장비_스킬_계획.md):
#   AWS SSO login (approve in the browser), then build + deploy if the login worked.
#   1) GetGear / EquipGear / LevelSkill / BuyGear + routes (deploy-gear.mjs)
#   2) FinishBattle only (battle rewards) — get-battle-records stays as it is
#   & C:\Users\inchul\Documents\layers\quiz-functions\deploy-gear.ps1
Set-Location -LiteralPath $PSScriptRoot
aws sso login --profile inchul
if ($LASTEXITCODE -ne 0) { Write-Host 'SSO login did not finish - nothing was deployed.'; exit 1 }
node build-gear.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'Gear build failed - nothing was deployed.'; exit 1 }
node build-battle.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'Battle build failed - nothing was deployed.'; exit 1 }
node deploy-gear.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'Gear deploy failed - FinishBattle was not touched.'; exit 1 }
node deploy-battle.mjs --only FinishBattle
