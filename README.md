# SteelOpt — STAAD BS5950 Optimizer

A browser-based optimizer for STAAD.Pro BS5950-1:2000 steel design output.  
Upload your STAAD PDF output and find the lightest sections within your target utilization band (80–95% UC).

## Features

- 📄 Parse STAAD.Pro PDF output (Member Selection / Code Check tables)
- ⚖️ Find lightest sections within 80–95% UC band per BS5950-1:2000
- 📊 Before/After tonnage comparison
- 📋 Bill of Quantities (BOQ) schedule
- 💾 Export results to CSV
- 🔒 Runs entirely in the browser — no server, no API key required

## Supported Section Types

UB · UC · PFC · IPE · HEA · HEB · HEM · UNP · SHS · RHS · CHS · PIP · EA · UA · ASB · RSJ · W-shapes · HSS · Tension Rods (RD)

---

## 🚀 Deploy to GitHub Pages (Free)

### Step 1 — Edit `vite.config.ts`
Change `repoName` to match your GitHub repository name exactly:
```ts
const repoName = 'your-repo-name-here';
```

### Step 2 — Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages
1. Go to your repo on GitHub
2. Click **Settings** → **Pages**
3. Under **Source**, select **GitHub Actions**
4. Save

### Step 4 — Place the workflow file
Move `deploy.yml` into `.github/workflows/` in your repo:
```
.github/
  workflows/
    deploy.yml
```

Your site will be live at:  
`https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

Every push to `main` will automatically redeploy.

---

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Build Locally

```bash
npm run build
npm run preview
```

## Tech Stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS v4
- Motion (Framer Motion)
- PDF.js (pdfjs-dist)
- Lucide React icons

## No API Key Required

This app runs entirely in the browser. No backend, no external API, no environment variables needed.
