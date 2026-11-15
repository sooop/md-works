// 내보내기 화면의 비밀번호 입력 검증(순수 함수). 화면(BackupDialog)과 단위 테스트가 함께 쓴다.

/** 이보다 짧으면 경고한다(막지는 않는다) */
export const PASSWORD_MIN_RECOMMENDED = 8;

export interface PasswordCheck {
  /** 내려받기를 막는 이유(없으면 null) */
  blocked: string | null;
  /** 막지는 않지만 보여 줄 경고(없으면 null) */
  warning: string | null;
}

/** NFC 로 맞춘 글자(코드 포인트) 수 — 한글 조합 차이로 길이가 달라지지 않게 한다 */
export const passwordLength = (pw: string): number => [...pw.normalize('NFC')].length;

/** 비밀번호와 확인 입력을 검사한다: 비었거나 서로 다르면 막고, 8자 미만이면 경고만 한다 */
export function checkPasswordPair(password: string, confirm: string): PasswordCheck {
  if (!password) return { blocked: '비밀번호를 입력하세요', warning: null };
  const warning = passwordLength(password) < PASSWORD_MIN_RECOMMENDED ? '짧은 비밀번호는 쉽게 풀릴 수 있습니다' : null;
  // 같은 비밀번호인지는 실제로 키가 되는 NFC 형태로 비교한다
  if (password.normalize('NFC') !== confirm.normalize('NFC')) return { blocked: '비밀번호와 확인 입력이 서로 다릅니다', warning };
  return { blocked: null, warning };
}
