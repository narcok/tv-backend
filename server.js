/**
 * TV Backend - YouTube to MP4 Proxy for Roblox VideoFrame
 * Deploy on Render.com (Web Service)
 *
 * Endpoints:
 *   POST /api/convert
 *     Convertit YouTube en URL directe googlevideo.com (legacy)
 *     Body: { "url": "https://www.youtube.com/watch?v=..." }
 *     Response: { "success": true, "url": "https://...", "title": "..." }
 *
 *   POST /api/proxy
 *     Valide une URL YouTube et retourne une URL proxy pour VideoFrame
 *     Body: { "url": "https://www.youtube.com/watch?v=..." }
 *     Response: { "success": true, "url": "https://BACKEND/api/stream/VIDEOID", "title": "...", "videoId": "..." }
 *
 *   GET /api/stream/:videoId
 *     Stream une vidéo YouTube à travers le proxy (pour Roblox VideoFrame)
 *     Response: Flux MP4 video/audio
 *
 *   GET /api/info
 *     Metadata d'une vidéo (titre, duree, etc.)
 *     Query: ?url=... ou ?id=...
 *
 *   POST /api/twitch-clip
 *     Extrait l'URL directe d'un clip Twitch
 *
 *   GET /health
 *     Response: { "status": "ok" }
 */

const express = require("express");
const cors = require("cors");
const ytdl = require("@distube/ytdl-core");

const app = express();
const PORT = process.env.PORT || 3000;

// === COOKIES YOUTUBE ===
// Optionnel: définir YT_COOKIES dans les variables d'environnement Render
// pour éviter le rate-limiting YouTube.
// Formats acceptés:
//   - Chaîne HTTP: "name=value; name2=value2"
//   - Netscape cookies.txt: lignes avec tabulations (export extension navigateur)
let ytCookies = null;
if (process.env.YT_COOKIES) {
	let raw = process.env.YT_COOKIES.trim();

	// Détecter le format Netscape (contient des tabulations et des domaines)
	if (raw.includes("\t") || raw.includes("# ")) {
		// Format cookies.txt: extraire les name=value des lignes valides
		const pairs = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
			const parts = trimmed.split("\t");
			// Netscape format: domain flag path secure expiry name value
			if (parts.length >= 7) {
				const name = parts[parts.length - 2];
				const value = parts[parts.length - 1];
				if (name && value) pairs.push(`${name}=${value}`);
			}
		}
		if (pairs.length > 0) {
			ytCookies = pairs.join("; ");
			console.log(`Parsed ${pairs.length} cookies from Netscape format`);
		}
	} else {
		// Format déjà en chaîne HTTP
		ytCookies = raw;
	}

	if (ytCookies) {
		console.log(`YT_COOKIES ready (${ytCookies.length} chars)`);
	} else {
		console.warn("YT_COOKIES set but could not parse any cookies");
	}
}

// Crée les options pour les appels ytdl avec cookies si présents
function makeYtdlOptions(extra = {}) {
	const opts = { ...extra };
	if (ytCookies) {
		opts.requestOptions = opts.requestOptions || {};
		opts.requestOptions.headers = {
			...(opts.requestOptions.headers || {}),
			Cookie: ytCookies,
		};
	}
	return opts;
}

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
	next();
});

/**
 * POST /api/convert
 * Convert a YouTube URL to a direct MP4 video URL
 */
app.post("/api/convert", async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({
			success: false,
			error: "Missing 'url' in request body",
		});
	}

	// Validate YouTube URL
	const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
	if (!youtubeRegex.test(url)) {
		return res.status(400).json({
			success: false,
			error: "Invalid YouTube URL",
		});
	}

	console.log(`Converting: ${url}`);

	try {
		console.log(`Fetching video info...`);
		// Get video info from YouTube
		const info = await ytdl.getInfo(url, makeYtdlOptions());
		const title = info.videoDetails.title;
		const videoId = info.videoDetails.videoId;

		console.log(`Video: "${title}" (${videoId})`);

		// Try to find a format with both audio and video (highest quality)
		let selectedFormat = null;

		// Priority: try to get a combined audio+video format
		const formats = info.formats;
		console.log(`Available formats: ${formats.length}`);

		// First, look for a good quality combined format (both audio and video in mp4)
		const combinedFormats = formats.filter(
			(f) => f.hasAudio && f.hasVideo && f.container === "mp4"
		);

		if (combinedFormats.length > 0) {
			// Sort by quality (resolution height), highest first
			combinedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
			selectedFormat = combinedFormats[0];
			console.log(`Selected: ${selectedFormat.qualityLabel || "?"} mp4 itag:${selectedFormat.itag}`);
		} else {
			// Fallback: mp4 video only (highest quality)
			const videoFormats = formats.filter(
				(f) => f.hasVideo && f.container === "mp4"
			);
			videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
			if (videoFormats.length > 0) {
				selectedFormat = videoFormats[0];
				console.log(`Selected video-only: ${selectedFormat.qualityLabel || "?"} mp4 itag:${selectedFormat.itag}`);
			}
		}

		if (selectedFormat && selectedFormat.url) {
			console.log(`Returning URL (${selectedFormat.url.length} chars)`);
			return res.json({
				success: true,
				url: selectedFormat.url,
				title: title,
				videoId: videoId,
				quality: selectedFormat.qualityLabel || "unknown",
			});
		}

		// Last resort: any format with a URL
		for (const f of formats) {
			if (f.url) {
				console.log(`Fallback format: ${f.qualityLabel || "unknown"}`);
				return res.json({
					success: true,
					url: f.url,
					title: title,
					videoId: videoId,
					quality: f.qualityLabel || "unknown",
				});
			}
		}

		res.status(404).json({
			success: false,
			error: "No playable format found for this video",
		});
	} catch (err) {
		const msg = err.message || "Unknown error";

		// Detecter rate limiting YouTube
		if (msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("status code: 429")) {
			console.error(`YOUTUBE RATE LIMITED: ${msg}`);
			return res.status(429).json({
				success: false,
				error: "YouTube rate limit. Attendez 30min ou ajoutez YT_COOKIES (voir README)",
			});
		}

		// Detecter video bloquee
		if (msg.includes("403") || msg.includes("Private video") || msg.includes("unavailable")) {
			return res.status(403).json({
				success: false,
				error: "Video indisponible ou privee sur YouTube",
			});
		}

		console.error(`Error: ${msg}`);
		res.status(500).json({
			success: false,
			error: `Conversion failed: ${msg}`,
		});
	}
});

/**
 * POST /api/proxy
 * Validate a YouTube URL and return a streaming proxy URL
 * The client uses this URL directly in VideoFrame
 */
app.post("/api/proxy", async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({
			success: false,
			error: "Missing 'url' in request body",
		});
	}

	// Validate YouTube URL
	const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
	if (!youtubeRegex.test(url)) {
		return res.status(400).json({
			success: false,
			error: "Invalid YouTube URL",
		});
	}

	console.log(`Proxy request: ${url}`);

	try {
		// Get video info and verify it's playable (avec cookies si presents)
		const info = await ytdl.getInfo(url, makeYtdlOptions());
		const videoId = info.videoDetails.videoId;
		const title = info.videoDetails.title;

		// Verify at least one progressive MP4 format exists
		const hasPlayableFormat = info.formats.some(
			(f) => f.hasAudio && f.hasVideo && f.container === "mp4"
		);
		if (!hasPlayableFormat) {
			return res.status(404).json({
				success: false,
				error: "No playable MP4 format found for this video",
			});
		}

		// Build the proxy streaming URL
		const proxyUrl = `${req.protocol}://${req.get("host")}/api/stream/${videoId}`;
		console.log(`Proxy OK: "${title}" (${videoId})`);

		return res.json({
			success: true,
			url: proxyUrl,
			title: title,
			videoId: videoId,
		});
	} catch (err) {
		const msg = err.message || "Unknown error";

		if (msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("status code: 429")) {
			console.error(`YOUTUBE RATE LIMITED: ${msg}`);
			return res.status(429).json({
				success: false,
				error: "YouTube rate limit. Attendez 30min ou ajoutez YT_COOKIES",
			});
		}

		if (msg.includes("403") || msg.includes("Private video") || msg.includes("unavailable")) {
			return res.status(403).json({
				success: false,
				error: "Video indisponible ou privée sur YouTube",
			});
		}

		console.error(`Proxy error: ${msg}`);
		res.status(500).json({
			success: false,
			error: `Proxy failed: ${msg}`,
		});
	}
});

/**
 * GET /api/stream/:videoId
 * Stream a YouTube video through the proxy (for Roblox VideoFrame)
 * VideoFrame loads this URL directly; backend fetches from YouTube in real-time
 */
app.get("/api/stream/:videoId", async (req, res) => {
	const { videoId } = req.params;

	// Validate video ID format
	if (!videoId || !/^[a-zA-Z0-9_\-]{11}$/.test(videoId)) {
		return res.status(400).json({
			success: false,
			error: "Invalid video ID format",
		});
	}

	const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
	console.log(`Stream request: ${videoId}`);

	try {
		const opts = makeYtdlOptions();
		const info = await ytdl.getInfo(youtubeUrl, opts);

		// Find best progressive format (audio+video combined in mp4)
		let format = info.formats.find((f) => f.itag == 18);  // 360p
		if (!format) format = info.formats.find((f) => f.itag == 22);  // 720p
		if (!format) format = info.formats.find((f) => f.itag == 36);  // 240p
		if (!format) {
			format = info.formats.find(
				(f) => f.hasAudio && f.hasVideo && f.container === "mp4"
			);
		}
		if (!format) {
			console.error(`No suitable format for ${videoId}`);
			return res.status(404).send("No suitable video format found");
		}

		console.log(`Streaming format: itag=${format.itag} ${format.qualityLabel || "?"} ${format.container}`);

		// Set appropriate headers for video streaming
		const mimeType = format.mimeType ? format.mimeType.split(";")[0] : "video/mp4";
		res.setHeader("Content-Type", mimeType);
		res.setHeader("Accept-Ranges", "bytes");
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Cache-Control", "no-store");

		// Create and pipe the video stream (avec cookies pour le download)
		const streamOpts = { quality: format.itag };
		if (ytCookies) {
			streamOpts.requestOptions = streamOpts.requestOptions || {};
			streamOpts.requestOptions.headers = { Cookie: ytCookies };
		}
		const stream = ytdl.downloadFromInfo(info, streamOpts);

		stream.on("error", (err) => {
			console.error(`Stream pipe error for ${videoId}: ${err.message}`);
			if (!res.headersSent) {
				res.status(500).end();
			}
		});

		stream.pipe(res);
	} catch (err) {
		console.error(`Stream error for ${videoId}: ${err.message}`);
		if (!res.headersSent) {
			res.status(500).send(`Stream error: ${err.message}`);
		}
	}
});

/**
 * GET /api/info
 * Get video metadata only (no URL conversion)
 */
app.get("/api/info", async (req, res) => {
	const { url, id } = req.query;
	const videoUrl =
		url || (id ? `https://www.youtube.com/watch?v=${id}` : null);

	if (!videoUrl) {
		return res.status(400).json({
			success: false,
			error: "Provide 'url' or 'id' query parameter",
		});
	}

	try {
		const info = await ytdl.getInfo(videoUrl, makeYtdlOptions());
		res.json({
			success: true,
			title: info.videoDetails.title,
			videoId: info.videoDetails.videoId,
			lengthSeconds: parseInt(info.videoDetails.lengthSeconds),
			author: info.videoDetails.author.name,
			thumbnails: info.videoDetails.thumbnails,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
});

/**
 * POST /api/twitch-clip
 * Extract direct MP4 URL from a Twitch clip
 */
app.post("/api/twitch-clip", async (req, res) => {
	const { url } = req.body;

	if (!url) {
		return res.status(400).json({
			success: false,
			error: "Missing 'url' in request body",
		});
	}

	// Extract clip slug from various Twitch URL formats
	let slug = null;

	// Format: https://www.twitch.tv/{channel}/clip/{slug}
	let match = url.match(/twitch\.tv\/[^\/]+\/clip\/([a-zA-Z0-9_\-]+)/);
	if (match) slug = match[1];

	// Format: https://clips.twitch.tv/{slug}
	if (!slug) {
		match = url.match(/clips\.twitch\.tv\/([a-zA-Z0-9_\-]+)/);
		if (match) slug = match[1];
	}

	if (!slug) {
		return res.status(400).json({
			success: false,
			error: "Invalid Twitch clip URL. Expected: twitch.tv/{channel}/clip/{slug} or clips.twitch.tv/{slug}",
		});
	}

	console.log(`Twitch clip slug: ${slug}`);

	try {
		// Use Twitch's persisted GQL query to get clip metadata + playbackAccessToken
		const response = await fetch("https://gql.twitch.tv/gql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
			},
			body: JSON.stringify({
				operationName: "ShareClipRenderStatus",
				variables: { slug },
				extensions: {
					persistedQuery: {
						version: 1,
						sha256Hash: "324783ea014524fa10a88739aa507de7a52f9624574dba9739a52b8c97d885cf",
					},
				},
			}),
		});

		if (!response.ok) {
			console.error(`Twitch API error: ${response.status}`);
			return res.status(502).json({
				success: false,
				error: `Twitch API returned status ${response.status}`,
			});
		}

		const data = await response.json();

		if (!data?.data?.clip) {
			return res.status(404).json({
				success: false,
				error: "Clip not found on Twitch",
			});
		}

		const clip = data.data.clip;
		const qualities = clip.videoQualities;
		const token = clip.playbackAccessToken;

		if (!qualities || qualities.length === 0) {
			return res.status(404).json({
				success: false,
				error: "No video qualities found for this clip",
			});
		}

		if (!token?.signature || !token?.value) {
			return res.status(403).json({
				success: false,
				error: "Clip requires authentication (no playback token)",
			});
		}

		// Sort by quality (highest first)
		qualities.sort((a, b) => parseInt(b.quality) - parseInt(a.quality));

		const best = qualities[0];

		// Build signed URL with playback token
		const signedUrl = best.sourceURL + "?sig=" + token.signature + "&token=" + encodeURIComponent(token.value);

		console.log(`Twitch clip: "${clip.title}" - ${best.quality}p`);

		return res.json({
			success: true,
			url: signedUrl,
			title: clip.title,
			slug: clip.slug,
			quality: `${best.quality}p`,
		});
	} catch (err) {
		console.error(`Twitch clip error: ${err.message}`);
		return res.status(500).json({
			success: false,
			error: `Twitch clip failed: ${err.message}`,
		});
	}
});

/**
 * GET /debug
 * Debug endpoint - shows cookie status and lists all cookie names
 */
app.get("/debug", (req, res) => {
	const cookieNames = [];
	if (ytCookies) {
		for (const pair of ytCookies.split("; ")) {
			const eq = pair.indexOf("=");
			if (eq > 0) cookieNames.push(pair.substring(0, eq));
		}
	}
	res.json({
		status: "ok",
		hasCookies: !!ytCookies,
		cookieCount: cookieNames.length,
		cookieNames: cookieNames,
		cookieLength: ytCookies ? ytCookies.length : 0,
		hasSecure3PSID: cookieNames.includes("__Secure-3PSID"),
		hasLOGIN_INFO: cookieNames.includes("LOGIN_INFO"),
		hasPREF: cookieNames.includes("PREF"),
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	});
});

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", (req, res) => {
	res.json({
		status: "ok",
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	});
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
	console.log(`TV Backend running on port ${PORT}`);
	console.log(`Health check: http://localhost:${PORT}/health`);
	console.log(`Convert API: POST http://localhost:${PORT}/api/convert`);
});
