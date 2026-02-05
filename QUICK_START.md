# Quick Start Checklist

## Pre-Setup (Do Before Going to Friend's House)

### Spotify API Setup
1. ✅ Go to https://developer.spotify.com/dashboard
2. ✅ Create app with redirect URI: `http://localhost:8888/callback`
3. ✅ Copy Client ID and Client Secret
4. ✅ Save credentials securely (you'll need them)

### Google/YouTube API Setup
1. ✅ Go to https://console.cloud.google.com/
2. ✅ Create new project
3. ✅ Enable "YouTube Data API v3"
4. ✅ Create OAuth 2.0 credentials (Desktop app type)
5. ✅ Download `client_secret.json`
6. ✅ Save the file (you'll need to copy it to friend's computer)

---

## On Friend's Computer

### 1. Install Python
```bash
# Download from python.org
# Make sure to check "Add Python to PATH"
```

### 2. Copy Project Files
- Copy entire project folder to friend's computer
- Copy `client_secret.json` to project folder

### 3. Install Dependencies
```bash
cd AutoSpotifyDownloader
pip install -r requirements.txt
```

### 4. Create .env File
Create a file named `.env` in the project folder with:
```
SPOTIPY_CLIENT_ID=<paste_client_id>
SPOTIPY_CLIENT_SECRET=<paste_client_secret>
SPOTIPY_REDIRECT_URI=http://localhost:8888/callback
```

### 5. Run App
```bash
python app.py
```

### 6. First-Time Authentication
- Spotify: Browser will open, friend logs in and authorizes
- YouTube: Browser will open when first syncing, friend logs in and authorizes

---

## Files You Need

**From Spotify:**
- Client ID
- Client Secret

**From Google:**
- `client_secret.json` file

**Create on friend's computer:**
- `.env` file (with Spotify credentials)

---

## Common Issues

**"No module named 'spotipy'"**
→ Run: `pip install -r requirements.txt`

**Spotify auth fails**
→ Check `.env` file exists and has correct credentials

**YouTube auth fails**
→ Check `client_secret.json` is in project folder

**Port in use**
→ Usually auto-handled, but try closing other apps using port 8888
