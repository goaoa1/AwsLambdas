// ========================================
// profileCatalog.ts - 닉네임 단어 목록과 친구 코드 규칙 (서버가 기준값을 가진다)
//   클라이언트는 get-my-profile 응답의 NicknameWords 를 받아 고르기 화면을 만든다 (따로 복사하지 않음).
//   단어를 지우면 이미 그 단어를 쓰는 닉네임은 그대로 남는다 (저장된 문자열을 보여 주기만 하므로).
// ========================================

// 형용사 + 동물. 아이용 앱이라 정해진 단어 조합만 쓴다 (자유 입력 없음 → 욕설 검사 불필요)
export const NICKNAME_ADJECTIVES: string[] = [
  '용감한', '반짝이는', '씩씩한', '똑똑한', '날쌘', '귀여운', '다정한', '신나는',
  '느긋한', '수줍은', '명랑한', '꼼꼼한', '재빠른', '든든한', '상냥한', '포근한',
  '힘센', '호기심많은', '튼튼한', '부지런한', '노래하는', '춤추는', '꿈꾸는', '웃는',
  '빛나는', '하늘색', '분홍빛', '초록빛', '달콤한', '새콤한', '엉뚱한', '멋진',
];

export const NICKNAME_NOUNS: string[] = [
  '판다', '토끼', '고양이', '강아지', '여우', '다람쥐', '펭귄', '코알라',
  '사자', '호랑이', '기린', '코끼리', '수달', '부엉이', '돌고래', '고래',
  '햄스터', '거북이', '병아리', '오리', '사슴', '곰', '너구리', '고슴도치',
  '앵무새', '나비', '무당벌레', '해달', '물개', '얼룩말', '캥거루', '알파카',
];

export function isValidNickname(adjective: string, noun: string): boolean {
  return NICKNAME_ADJECTIVES.includes(adjective) && NICKNAME_NOUNS.includes(noun);
}

export function makeNickname(adjective: string, noun: string): string {
  return `${adjective}${noun}`;
}

// 친구 코드: 헷갈리는 글자(0 O 1 I L)를 뺀 6글자, 보여 줄 때는 3-3 으로 끊는다 (예: K7Q-2MX)
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const FRIEND_CODE_LENGTH = 6;

export function randomFriendCode(): string {
  let s = '';
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export function formatFriendCode(code: string): string {
  return code.length === FRIEND_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

// 입력값 정리: 대문자, 하이픈·공백 제거. 형식이 아니면 ''
export function normalizeFriendCode(input: string): string {
  const s = (input || '').toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== FRIEND_CODE_LENGTH) return '';
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return '';
  return s;
}

// 같은 닉네임끼리 구분하는 4자리 번호 (1000~9999)
export function randomNicknameTag(): number {
  return 1000 + Math.floor(Math.random() * 9000);
}

// PlayerHandles 테이블 키: 코드와 '닉네임#번호' 가 한 사람에게만 가도록 조건부 Put 으로 잡는다
export const handleForCode = (code: string) => `CODE#${code}`;
export const handleForNickname = (nickname: string, tag: number) => `NICK#${nickname}#${tag}`;

export const PROFILE_TABLE = 'PlayerProfiles';
export const HANDLE_TABLE = 'PlayerHandles';
