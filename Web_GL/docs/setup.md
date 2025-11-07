mkdir -p docs
cat > docs/setup.md << 'EOF'
# 개발환경 세팅 가이드 (macOS & Windows)

이 문서는 **webgl-sim** 프로젝트의 개발 환경을 빠르게 맞추기 위한 가이드입니다.  
프로젝트 표준 Node.js 버전은 `.nvmrc`에 명시된 **20.x LTS** 입니다. (예: `20.11.1`)

---

## 1. Node.js 버전 정책

- 루트에 있는 `.nvmrc` 파일로 버전 고정
- `package.json`의 `"engines"`에도 명시

```json
{
  "engines": {
    "node": "20.x",
    "npm": ">=10"
  }
}