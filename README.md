# Cont Pessoal

Personal finance web app: import bank statements, categorize transactions, and ask questions about your spending. FastAPI backend + React (Vite) frontend.

## Requirements

- Python >= 3.11
- Node.js (18+) and npm
- An [Anthropic API key](https://console.anthropic.com/) (used for statement categorization / natural-language queries)

## Backend dependencies

Declared in `backend/pyproject.toml`:

- fastapi >= 0.115
- uvicorn[standard] >= 0.32
- python-multipart >= 0.0.12
- pydantic >= 2.9
- anthropic >= 0.69
- python-dotenv >= 1.0

## Frontend dependencies

Declared in `frontend/package.json`:

- react ^19, react-dom ^19
- @tanstack/react-query ^5
- Dev tooling: vite, @vitejs/plugin-react, typescript, oxlint

## Setup

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -e .
```

Create a `.env` file (or copy `.env.example`) with your Anthropic API key:

```bash
cp .env.example .env
# then edit .env and set:
# ANTHROPIC_API_KEY=sk-ant-...
```

Run the API server:

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000` (health check at `/health`). The SQLite database (`app/data/ledger.db`) is created automatically on startup.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`. It proxies `/api` requests to the backend at `http://localhost:8000` (see `vite.config.ts`), so make sure the backend is running first.

## Running both together

You need two terminals:

```bash
# terminal 1
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000

# terminal 2
cd frontend && npm run dev
```

Then open `http://localhost:5173` in your browser.

## Other frontend scripts

- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run lint` — run oxlint
