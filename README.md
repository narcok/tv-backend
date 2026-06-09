# TV Backend - YouTube to MP4 URL Converter for Roblox

## 🚀 Deploy on Render.com

1. Push this folder to a GitHub repository

2. Go to https://dashboard.render.com → New → Web Service

3. Connect your GitHub repo

4. Configure:
   - **Name**: `tv-backend` (or anything)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

5. Click "Create Web Service"

6. Wait for deployment (2-3 minutes)

7. Copy your URL: `https://tv-backend.onrender.com`

8. **Important**: In Roblox Studio, open `ServerScriptService.TVServerHandler`
   and change line 10 from:
   ```lua
   local BACKEND_URL = "http://localhost:3000"
   ```
   to:
   ```lua
   local BACKEND_URL = "https://tv-backend.onrender.com"
   ```

9. Publish/playtest the game!

## Test the API

```bash
curl -X POST https://tv-backend.onrender.com/api/convert \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

## Notes

- Free tier spins down after 15min of inactivity (first request after sleep takes ~30s)
- Upgrade to Starter ($7/month) for always-on
