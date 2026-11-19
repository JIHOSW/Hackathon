// AI 추출 API 주소
// 같은 서버(Vercel)에서 열면 상대 경로 api/extract를 쓴다.
// GitHub Pages처럼 서버 기능이 없는 곳에서 열면 아래 VERCEL_URL의 API를 부른다.
// Vercel 배포 주소가 정해지면 VERCEL_URL을 채운다. 예: 'https://munteok.vercel.app/'
const VERCEL_URL = '';

const onPages = location.hostname.endsWith('github.io');
export const API_BASE = onPages ? VERCEL_URL : '';
export const AI_AVAILABLE = !onPages || Boolean(VERCEL_URL);
