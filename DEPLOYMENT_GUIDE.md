# FocusLock Cloud Deployment & Mobile Installation Guide

This guide explains how to deploy FocusLock to the cloud using **Vercel** (for the Next.js apps) and **Render** (for the real-time FastAPI + WebSocket backend), and how students install it on mobile like a downloaded native app.

---

## 1. Cloud Architecture Overview

| Component | Technology | Recommended Host | Why? |
| :--- | :--- | :--- | :--- |
| **Student App** | Next.js 14 (PWA) | **Vercel** | Fast global edge CDN, native Next.js support, automatic HTTPS for PWA installability. |
| **Faculty Dashboard** | Next.js 14 | **Vercel** | Fast global edge CDN, projector display mode. |
| **FocusLock Backend** | FastAPI + WebSockets | **Render** (or Railway / Fly.io) | Long-lived persistent WebSocket connections (`/ws/session`) and session state. |

---

## 2. Deploying the Backend (Render)

Because Vercel serverless functions do not maintain persistent WebSockets, deploy the Python backend on **Render.com** (free tier):

1. **Push your code to GitHub** (see Step 4 below).
2. Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** ➔ **Web Service**.
3. Connect your GitHub repository.
4. Fill in the service settings:
   - **Name**: `focuslock-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Python`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Click **Create Web Service**.
6. Once deployed, copy your backend URL (e.g. `https://focuslock-backend.onrender.com`).

---

## 3. Deploying the Student & Faculty Apps (Vercel)

### Option A: Using the Vercel Dashboard (Easiest)

1. Go to [vercel.com/new](https://vercel.com/new) and import your GitHub repository.
2. **Deploy Student App**:
   - **Project Name**: `focuslock-student`
   - **Framework Preset**: Next.js
   - **Root Directory**: Click `Edit` and select `focuslock/frontend-student`
   - **Environment Variables**:
     - Key: `NEXT_PUBLIC_API_URL`
     - Value: `https://focuslock-backend.onrender.com` (your backend URL from Step 2)
   - Click **Deploy**.

3. **Deploy Faculty Dashboard**:
   - Return to [vercel.com/new](https://vercel.com/new) and import the same repository again.
   - **Project Name**: `focuslock-faculty`
   - **Root Directory**: Click `Edit` and select `focuslock/frontend-faculty`
   - **Environment Variables**:
     - Key: `NEXT_PUBLIC_API_URL`
     - Value: `https://focuslock-backend.onrender.com`
   - Click **Deploy**.

### Option B: Using Vercel CLI

If you have `vercel` CLI installed (`npm i -g vercel`):

```bash
# Deploy Student App
cd focuslock/frontend-student
vercel --prod --build-env NEXT_PUBLIC_API_URL="https://focuslock-backend.onrender.com"

# Deploy Faculty Dashboard
cd ../frontend-faculty
vercel --prod --build-env NEXT_PUBLIC_API_URL="https://focuslock-backend.onrender.com"
```

---

## 4. Mobile Installation: Downloaded Native App Experience (PWA)

Once deployed to Vercel (or over local network HTTPS), the student app runs as an installable standalone Progressive Web App (PWA).

### On Android (Chrome, Brave, Samsung Internet, Edge):
1. Open the Vercel URL on mobile (e.g., `https://focuslock-student.vercel.app`).
2. An **"Install FocusLock Mobile"** banner appears at the bottom.
3. Tap **"Download / Install to Home Screen"** (or tap the 3 dots menu ➔ **"Install app"** / **"Add to Home Screen"**).
4. FocusLock downloads and installs to the phone's app drawer and home screen with the official app icon.
5. When tapped, it opens in **Standalone Window Mode** (no browser address bar, no navigation buttons, fullscreen native feel).

### On iOS (Apple Safari):
1. Open the Vercel URL in Safari.
2. Tap the **Share** button (box with upward arrow at the bottom of Safari).
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **"Add"**.
5. FocusLock appears as a standalone app icon on the iPhone home screen. Launching it runs in standalone mode without Safari browser chrome.

---

## 5. Local Git Push Steps

To initialize and push your repository to GitHub:

```bash
cd e:\genesis\focuslock
git init
git add .
git commit -m "FocusLock complete with privacy fixes, PWA support, and deployment configs"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```
