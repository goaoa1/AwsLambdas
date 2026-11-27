# Gear + skill levels deploy (장비 · 스킬 G1, 2026-11-25 — 게임 저장소 Docs/장비_스킬_계획.md):
#   2026-11-27 (게임 Docs/퀴즈맵_전투_개편_계획.md §88): the same steps also ship the attack-skill loadout
#   (SkillLoadout in every gear answer, equip-gear { CharacterId, Skills }) and FinishBattle without skill-book drops.
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
