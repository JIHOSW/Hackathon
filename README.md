# 문턱

청년이 알바 공고나 제안 메시지를 올리면, 그 일을 했을 때 넘게 되는 제도 기준선과 손익을 계산하고 넘지 않는 근무 조건을 제안하는 AI 에이전트.
2026 대한민국 청년 CAREER FAIR AI 해커톤 팀 프로젝트입니다.

| 폴더 | 내용 |
|---|---|
| [`munteok/`](munteok/) | 프로토타입. 실행 방법과 원문 확인이 남은 규칙은 [munteok/README.md](munteok/README.md) |
| [`기획/`](기획/) | 요구사항 문서, 기능명세, 유저플로우, 매니패스트 요청문 |

제출 마감: **2026. 11. 23.(월) 17:00**. 마감 후에는 기능·알고리즘·프롬프트·데이터를 바꿀 수 없습니다.

---

## 협업 방법: 팀원별 브랜치

각자 자기 브랜치에서 작업하고, 끝난 작업만 Pull Request(PR)로 `main`에 합칩니다.
`main`은 언제나 작동하는 상태로 두고, 제출 직전에 `main`을 배포합니다.

### 1. 처음 한 번: 저장소 받기

```bash
git clone https://github.com/JIHOSW/Hackathon.git
```

```bash
cd Hackathon
```

### 2. 작업 시작할 때마다: 최신 main에서 브랜치 만들기

```bash
git switch main
```

```bash
git pull
```

```bash
git switch -c rules/allowance-2026
```

브랜치 이름은 `역할/작업내용`으로 짓습니다.

| 역할 | 브랜치 예시 | 주로 고치는 파일 |
|---|---|---|
| 규칙 담당 | `rules/allowance-2026` | `munteok/data/rules.json`, `munteok/tests/` |
| AI 담당 | `ai/extract-api` | 새로 만들 서버 코드(`api/`) |
| 화면 담당 | `ui/result-screen` | `munteok/index.html`, `munteok/css/`, `munteok/js/app.js` |
| 기획·문서 담당 | `docs/intro-deck` | `기획/`, README |

`munteok/js/engine.js`는 여러 사람이 건드리기 쉬우니 고칠 사람을 한 명으로 정합니다. 담당자: [이름]

### 3. 작업하면서: 자주 커밋하고 올리기

```bash
git add munteok/data/rules.json
```

```bash
git commit -m "구직촉진수당 2026년 기준선 원문 확인"
```

```bash
git push -u origin rules/allowance-2026
```

처음 한 번만 `-u origin 브랜치이름`을 붙이고, 그다음부터는 `git push`만 하면 됩니다.

### 4. 작업이 끝나면: PR로 합치기

1. 푸시하면 GitHub 저장소 페이지에 "Compare & pull request" 버튼이 뜹니다.
2. 무엇을 바꿨고 어떻게 확인했는지 적고 PR을 만듭니다.
3. 다른 팀원 한 명이 보고 승인하면 "Merge"를 누릅니다.
4. 합친 뒤에는 각자 `main`을 다시 받습니다.

```bash
git switch main
```

```bash
git pull
```

### 5. 내 브랜치가 오래됐을 때: main 내용 가져오기

다른 사람의 작업이 먼저 합쳐졌으면, 내 브랜치에 반영한 뒤 PR을 올립니다.

```bash
git pull origin main
```

같은 줄을 둘이 고쳤다면 충돌이 나고, 파일 안에 `<<<<<<<`와 `>>>>>>>` 표시가 생깁니다.
둘 중 맞는 내용만 남기고 표시를 지운 뒤 다시 커밋합니다.

---

## 마감까지의 규칙

- **브랜치는 작게, 하루 안에 합치기.** 며칠씩 묵힌 브랜치는 합칠 때 충돌이 커집니다.
- **`main`에 직접 푸시하지 않기.** 저장소 주인이 Settings → Branches에서 `main` 보호 규칙을 켜면 실수를 막을 수 있습니다.
- **규칙표를 고친 PR은 테스트 결과 첨부.** `munteok/tests/` 페이지에서 전체 통과를 확인하고 PR에 적습니다. 규칙 값을 바꾸면 기대값도 손으로 다시 계산해 고칩니다.
- **API 키는 절대 커밋하지 않기.** `.env` 파일에만 넣으면 `.gitignore`가 막아 줍니다.
- **실제 개인정보 금지.** 외부 AI에 실제 개인정보를 보내는 것은 대회 규정 위반입니다. 시연과 테스트는 가상 샘플로만 합니다.
- **AI 도구 사용 기록.** 대회 규정상 AI 활용내역을 제출해야 하므로, 어떤 작업에 어떤 AI 도구를 썼는지 PR 설명에 한 줄씩 남깁니다.

### 제출 시점 기록

마감 직전 `main`의 커밋에 태그를 붙여, 제출 마감 시점의 버전을 남깁니다.

```bash
git tag submission-2026-11-23
```

```bash
git push origin submission-2026-11-23
```
