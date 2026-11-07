# 상점 Lambda (2026-11-07)

클라이언트(`TimesTable` Unreal 프로젝트, `Docs\BC003_기능정리.md` "의상 상점")와 짝을 이루는 서버 함수들입니다. 2026-11-07 에 `node deploy-shop.mjs` 로 배포했습니다.

| 함수 | 라우트 | 하는 일 |
|---|---|---|
| `GetShop` (`getShop.ts`) | `GET /get-shop` | 카탈로그(`shopCatalog.ts`) + 플레이어 크레딧·보유·착용 |
| `PurchaseOutfit` (`purchaseOutfit.ts`) | `POST /purchase-outfit` `{OutfitId}` | 멱등(ITEM_PURCHASE). 크레딧 조건부 차감 + `OwnedOutfits` 추가. 409 `InsufficientCredits` / `AlreadyOwned` |
| `EquipOutfit` (`equipOutfit.ts`) | `POST /equip-outfit` `{CharacterId, OutfitId}` | 보유·호환 확인 뒤 `EquippedOutfits[CharacterId]` 설정. `OutfitId` 가 빈 문자열이면 벗기기 |
| `PurchaseCredits` (`purchaseCredits.ts`) | `POST /purchase-credits` `{ProductId, PurchaseToken, Platform}` | 멱등(PAYMENT_VERIFY). `google` 은 Play Developer API 로 검증, `sandbox` 는 `ALLOW_SANDBOX_PURCHASE=true` 일 때만. `PurchaseReceipts` 테이블로 토큰 재사용 차단 |
| `RecordPlayerInfo` (`recordPlayerInfo.ts`) | (기존) | 응답에 `Credits`, `OwnedOutfits`, `EquippedOutfits` 추가 |

PlayerResources 에 새로 쓰는 속성: `Credits`(N), `OwnedOutfits`(L of S), `EquippedOutfits`(M: 캐릭터ID → 의상ID).

## 묶기와 배포

```
cd C:\Users\inchul\Documents\layers\quiz-functions
npm run build:shop        # node build-shop.mjs → dist-shop\*.zip (esbuild, 레이어·AWS SDK 는 external)
aws sso login --profile inchul
npm run deploy:shop:dry   # 무엇을 할지 명령만 출력
npm run deploy:shop       # 테이블·함수·라우트·권한 생성, recordPlayerInfo 코드 갱신
```

`deploy-shop.mjs` 는 REST API(v1) `QuizInGameAPI 7sgqi34u0h` 에 리소스·메서드를 만들고(Cognito 인가자 `lu3670`, 스코프 `openid aws.cognito.signin.user.admin`, AWS_PROXY), 레이어는 기존 `SelectCharacter` 함수에서 읽고, 실행 역할 `TT_ShopLambdaRole`(기본 로그 + `TT_AccessPlayerResourceTable` + `TT_AccessIdempotencyTable` + `PurchaseReceipts` PutItem)을 없으면 만들어 씁니다. 다시 실행하면 코드·환경 변수만 갱신됩니다.

### 환경 변수

| 이름 | 값 |
|---|---|
| `REGION` | `ap-northeast-2` |
| `IDEMPOTENCY_TABLE` | `IdempotencyTable` |
| `RECEIPT_TABLE` | `PurchaseReceipts` |
| `ALLOW_SANDBOX_PURCHASE` | 개발 스테이지 `true`, 운영은 비움 |
| `GOOGLE_PACKAGE_NAME` | 앱 패키지 이름 |
| `GOOGLE_SA_EMAIL` | Play Console 에 연결한 서비스 계정 이메일 |
| `GOOGLE_SA_PRIVATE_KEY` | 그 서비스 계정의 PEM 개인 키(줄바꿈은 `\n`) |

구글 값 3개는 `deploy-shop.mjs` 실행 전에 같은 이름의 셸 환경 변수로 넣으면 함수 설정에 들어갑니다. 비워 두면 `Platform: google` 요청은 402 로 거부되고 샌드박스만 됩니다.

## 카탈로그 바꾸기

`shopCatalog.ts` 의 `OUTFITS` / `CREDIT_PACKS` 를 고치고 상점 함수 4개를 다시 배포합니다. 클라이언트 `DA_Outfit_*` 의 `OutfitId` 와 Google Play 인앱 상품 ID 가 여기 값과 같아야 합니다. 가격은 항상 서버 값으로 판정되고, 클라이언트는 `get-shop` 으로 받은 가격을 표시합니다.
