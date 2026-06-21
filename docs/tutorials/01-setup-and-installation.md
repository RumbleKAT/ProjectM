# 01. 개발 환경 구성 및 로컬 설치 가이드

이 장에서는 ProjectM 소스 코드를 다운로드하고, 개발에 필요한 도구들을 설치한 후 로컬 환경에서 시스템을 빌드하고 실행하는 전 과정을 단계별로 알아봅니다.

---

## 1. 사전 준비 사항 (Prerequisites)
설치 및 실행에 앞서 다음 도구들이 개발 시스템에 올바르게 설치되어 있는지 확인합니다.

*   **Node.js**: `v18` 이상 (LTS 버전 권장, `node -v`로 확인)
*   **Yarn**: 의존성 관리 도구 (`npm install -g yarn`으로 전역 설치 필요)
*   **Git**: 리포지토리 복제용
*   **Python**: 파일 파서 의존성 빌드에 사용됨 (대다수 OS 기본 포함)

---

## 2. 프로젝트 소스 코드 다운로드 및 구조 설정
먼저 터미널에서 리포지토리를 클론(Clone)합니다.

```bash
git clone https://github.com/RumbleKAT/ProjectM.git
cd ProjectM
```

### 소스 코드 최상위 폴더 구조
*   `/frontend`: Vite + React 기반의 관리자 웹 대시보드 및 채팅 화면 소스
*   `/server`: Node.js + Express 기반의 백엔드 오케스트레이터 및 API 서버
*   `/collector`: 문서 파싱 및 청킹 처리를 전담하는 백그라운드 서비스
*   `/docker`: Docker 기반 컨테이너 배포 구성 스크립트

---

## 3. 개발 설정 자동화 스크립트 실행
프로젝트는 모든 설정 파일 사본 생성, 의존성 설치, 데이터베이스 생성을 위한 원클릭 명령어 `yarn setup`을 제공합니다.

터미널에서 루트 디렉터리에 위치한 후 다음 명령어를 차례대로 입력하세요.

### Step 1: 환경 변수 (.env) 파일 복제
각 서비스 폴더에 필요한 환경 설정 예시(.env.example) 파일들을 복사하여 실제 사용할 파일로 생성합니다.

```bash
yarn setup:envs
```
*실행 결과로 `frontend/.env`, `server/.env.development`, `collector/.env`, `docker/.env` 파일들이 자동 복제됩니다.*

### Step 2: 의존성 패키지 설치 및 Prisma DB 마이그레이션 실행
설정 구성(Prisma 스키마 생성 및 로컬 SQLite 데이터베이스 초기화)과 각 레이어의 `node_modules` 패키지를 다운로드합니다.

```bash
yarn setup
```
*설치 과정 중 SQLite 로컬 데이터베이스가 `server/storage/anythingllm.db` 경로에 자동 마이그레이션 및 시딩(Seed)되어 생성됩니다.*

---

## 4. 로컬 개발 서버 실행
설치가 정상 완료되었다면, 프로젝트를 개발 모드로 구동할 수 있습니다. 각 서브 시스템을 한번에 실행하거나 개별적으로 터미널 탭을 열어 켤 수 있습니다.

### 방법 A: 동시 실행 (권장)
루트 폴더에서 아래 단일 명령어를 수행하면 백엔드, 프론트엔드, 콜렉터가 동시 구동됩니다.

```bash
yarn dev
```

### 방법 B: 개별 탭에서 실행 (디버깅 시 유리)
터미널의 개별 탭을 열어 하위 폴더별로 개발 서버를 수동으로 켤 수 있습니다.

1.  **백엔드 서버 켜기**:
    ```bash
    cd server
    yarn dev
    ```
    *서버가 기본적으로 `http://localhost:3001`에서 수신을 시작합니다.*

2.  **프론트엔드 서버 켜기**:
    ```bash
    cd frontend
    yarn dev
    ```
    *웹 개발 대시보드가 `http://localhost:5173` 또는 다른 자동 포트에서 열리며 브라우저로 접속 가능합니다.*

3.  **콜렉터 모듈 켜기**:
    ```bash
    cd collector
    yarn dev
    ```
    *문서 가공 작업을 수신 대기합니다.*

브라우저에서 **`http://localhost:5173`**에 접속하여 첫 화면이 켜지면 기본 로컬 설치가 완료된 것입니다!
