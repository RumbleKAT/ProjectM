# Prometheus(PromQL) & Grafana Loki(LogQL) 통합 모니터링 구축 플랜

## 1. 개요 (Summary)
ProjectM의 시스템 가동 안정성 및 AI API 호출 성능(지연 시간, 에러 발생률 등)을 지속적으로 관측하기 위한 모니터링 시스템 구축 계획입니다. 

ELK Stack(Elasticsearch, Logstash, Kibana)은 풍부하지만 무거운 메모리 자원을 요구하므로, CNCF의 표준 가벼운 대안인 **Grafana + Prometheus + Loki** 스택을 도입하여 지표(Metrics)와 로그(Logs)를 단일 대시보드에서 수집 및 분석할 수 있도록 설계합니다.

---

## 2. 모니터링 아키텍처 (Architecture)

```mermaid
graph TD
    subgraph "ProjectM 서비스"
        App[AnythingLLM Backend] -->|지표 노출| MetricsAPI[/metrics endpoint]
        App -->|구조화 로그| Winston[Winston Logger]
    end

    subgraph "모니터링 인프라"
        Prometheus[Prometheus Server] -->|Scrape| MetricsAPI
        Promtail[Promtail / Winston Loki] -->|로그 수집 & 푸시| Loki[Grafana Loki]
        Grafana[Grafana Dashboard] -->|PromQL| Prometheus
        Grafana -->|LogQL| Loki
    end

    subgraph "알림 및 시각화"
        Grafana -->|통계 시각화| Panel[대시보드 패널]
        Grafana -->|알림 발송| Alert[Slack / Email / Webhook]
    end
```

---

## 3. 세부 설계 및 수집 방안 (Details)

### ① 메트릭 모니터링 (Prometheus + PromQL)
AnythingLLM 서버 내에 이미 내장된 `prom-client` 패키지를 활성화하여 시계열 데이터 지표를 생성합니다.

1.  **지표 수집 엔드포인트 개설**:
    *   `/metrics` 경로를 노출하여 CPU, 메모리 사용량, 가비지 컬렉션(GC) 상태, Event Loop 지연시간 등을 노출합니다.
    *   API별 HTTP 요청 성공/실패 횟수, 모델별 토큰 생성 속도 및 Latency 지표를 수집합니다.
2.  **핵심 PromQL 질의 설계**:
    *   **API 성공률**: `sum(rate(http_requests_total{status=~"2.."}[5m])) / sum(rate(http_requests_total[5m])) * 100`
    *   **시스템 메모리 사용률**: `nodejs_memory_active_bytes / nodejs_memory_external_bytes * 100`

### ② 로그 모니터링 (Grafana Loki + LogQL)
ELK의 무거운 인덱싱 엔진 대신, 로그 메타데이터(레이블)만 인덱싱하여 매우 가볍고 비용 효율적인 **Grafana Loki**를 활용합니다.

1.  **로그 송출 구성**:
    *   내장 라이브러리인 `winston`에 `winston-loki` 전송 모듈을 설정하여 백엔드 오류 로그 및 비즈니스 로그를 직접 Loki로 푸시하도록 플러그인화하거나, Docker 컨테이너의 stdout을 수집하는 **Promtail**을 데몬으로 구성합니다.
2.  **핵심 LogQL 질의 설계**:
    *   **에러 로그 모아보기**: `{app="anythingllm"} |= "error" != "ignored"`
    *   **로그 기반 에러 메트릭 변환**: `sum(count_over_time({app="anythingllm"} |= "error" [5m]))` (에러 로그 빈도를 메트릭 지표로 변환하여 실시간 알림 차트 구축)

### ③ Grafana 단일 대시보드 시각화 & 알림
*   메트릭 대시보드 하단에 실시간 Loki 로그 스트림 패널을 배치하여, API 레이턴시가 튈 때 즉시 당시 에러 로그를 드릴다운(Drill-down)할 수 있도록 연동합니다.
*   에러 발생 횟수가 최근 5분간 임계치 이상으로 급증 시 Slack/이메일 알림을 유도합니다.

---

## 4. 단계별 구현 마일스톤 (Milestones)

1.  **Phase 1: 백엔드 `/metrics` 노출 설정**
    *   Node.js 내 `prom-client` 활성화 및 커스텀 HTTP 레이턴시 버킷 지표 추가.
2.  **Phase 2: 로깅 파이프라인 정비**
    *   Winston 파일 로깅 및 JSON 구조화 아웃풋 정비.
3.  **Phase 3: Docker-Compose 모니터링 스택 구축**
    *   Prometheus, Grafana, Loki 컨테이너 설정 파일 작성 및 패키징.
4.  **Phase 4: Grafana 대시보드 템플릿 제작 및 알림 규칙 정의**
    *   LogQL/PromQL 통합 뷰 및 임계치 슬랙 경보 연동.
