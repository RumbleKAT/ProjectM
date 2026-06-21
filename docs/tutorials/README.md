# ProjectM (AnythingLLM) 단계별 튜토리얼 가이드

이 디렉토리는 ProjectM(AnythingLLM) 플랫폼의 개발, 설정 및 운영을 처음부터 시작하는 사용자를 위한 한글 단계별 튜토리얼 문서들을 포함하고 있습니다.

ProjectM은 강력한 로컬 및 클라우드 기반 Retrieval-Augmented Generation(RAG) 플랫폼으로, 다양한 인공지능 모델(LLM)과 벡터 데이터베이스(Vector DB)를 연동하여 사용자의 전용 문서 기반 인공지능 시스템 및 텔레그램 챗봇을 빌드할 수 있게 돕습니다.

---

## 📚 튜토리얼 목차

이 가이드는 논리적 순서에 따라 6개의 파트로 나뉘어 구성되어 있습니다.

### 0. [개요 및 시스템 아키텍처](00-intro-and-architecture.md)
ProjectM의 기본 개념과 전체 시스템 구성도, 레이어별 아키텍처 및 RAG 질의 흐름을 이해합니다.

### 1. [개발 환경 구성 및 로컬 설치 가이드](01-setup-and-installation.md)
Node.js, Yarn 등 설치 필수 조건을 알아보고, 소스 코드 클론부터 Prisma DB 마이그레이션, 개발 서버 구동까지 차근차근 진행합니다.

### 2. [초기 온보딩 및 모델/벡터 DB 설정](02-onboarding-and-config.md)
앱 실행 후 관리자 계정 생성 과정(온보딩)을 진행하고, 대화형 LLM, 텍스트 임베딩 모델, 벡터 DB(Vector DB) 연동 설정을 다룹니다.

### 3. [워크스페이스 생성 및 문서 업로드 (RAG 구축)](03-workspace-and-documents.md)
리소스가 격리되는 독립적인 작업 공간인 '워크스페이스'를 만들고, 문서(PDF, DOCX 등)를 업로드 및 파싱하여 청킹 및 벡터화 과정을 수행하는 법을 학습합니다.

### 4. [채팅 스레드 관리, AI 에이전트 및 MCP 연동](04-chat-and-agents.md)
스레드(Thread) 단위로 컨텍스트를 분리하는 채팅 UI 활용법, 텍스트 음성 변환(TTS/STT), 자율 에이전트 도구 설정 및 MCP(Model Context Protocol) 연동을 탐구합니다.

### 5. [백그라운드 스케줄러 및 텔레그램 봇 연동](05-schedulers-and-telegram.md)
백그라운드 작업을 실행하는 Bree 스케줄러, 채팅방 및 워크스페이스 주기적 자동 삭제를 위한 시스템 작업(System Jobs) 설정, 그리고 텔레그램 챗봇을 생성하여 연동하는 전 과정을 완료합니다.
