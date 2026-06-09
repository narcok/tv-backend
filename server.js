/**
 * TV Backend - YouTube to MP4 URL Converter
 * Deploy on Render.com (Web Service)
 *
 * API:
 *   POST /api/convert
 *   Body: { "url": "https://www.youtube.com/watch?v=..." }
 *   Response: { "success": true, "url": "https://...", "title": "..." }
 *
 *   GET /health
 *   Response: { "status": "ok" }
 */

const express = require("express");
const cors = require("cors");
const ytdl = require("@distube/ytdl-core");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

// YouTube cookies optionnel (aide a eviter le rate limiting)
// Pour obtenir les cookies :
// 1. Connectez-vous a YouTube dans Chrome
// 2. Installez l'extension "Get cookies.txt" (ou "cookies.txt export")
// 3. Exportez les cookies pour youtube.com
// 4. Copiez le contenu dans une variable d'environnement YT_COOKIES sur Render.com
// Format: "name1=value1; name2=value2"
const YT_COOKIES = process.env.YT_COOKIES || "";

// Agent HTTP avec keep-alive pour les performances
const agent = new https.Agent({
	keepAlive: true,
	maxSockets: 1, // Limite a 1 connexion simultanee pour eviter le rate limiting
});

// Options ytdl-core avec cookies optionnels
function getYtdlOptions() {
	const opts = {
		requestOptions: {
			agent: agent,
			headers: {
				"Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
			},
		},
	};
	if (YT_COOKIES) {
		opts.requestOptions.headers.Cookie = YT_COOKIES;
		console.log("Using YouTube cookies");
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
		const info = await ytdl.getInfo(url, getYtdlOptions());
		const title = info.videoDetails.title;
		const videoId = info.videoDetails.videoId;

		console.log(`Video: "${title}" (${videoId})`);

		// Try to find a format with both audio and video (highest quality)
		let selectedFormat = null;

		// Priority: try to get a combined audio+video format
		const formats = info.formats;
		console.log(`Available formats: ${formats.length}`);

		// Log all formats for debugging
		for (const f of formats) {
			if (f.hasVideo) {
				console.log(`  Format: ${f.itag} ${f.qualityLabel || "?"} ${f.container} ${f.codecs || "?"} audio=${f.hasAudio} video=${f.hasVideo}`);
			}
		}

		// First, look for a good quality combined format (both audio and video in any container)
		const combinedFormats = formats.filter(
			(f) => f.hasAudio && f.hasVideo && (f.container === "mp4" || f.container === "webm")
		);

		if (combinedFormats.length > 0) {
			// Sort by quality (resolution height), highest first
			combinedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
			selectedFormat = combinedFormats[0];
			console.log(
				`Selected combined format: ${selectedFormat.qualityLabel || "?"} (${selectedFormat.container}) itag:${selectedFormat.itag}`
			);
		} else {
			// Fallback: try mp4 video only (highest quality, no audio)
			const videoFormats = formats.filter(
				(f) => f.hasVideo && f.container === "mp4"
			);
			videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

			if (videoFormats.length > 0) {
				selectedFormat = videoFormats[0];
				console.log(
					`Selected video-only format: ${selectedFormat.qualityLabel || "?"} (${selectedFormat.container}) itag:${selectedFormat.itag}`
				);
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

		// Last resort: try to get any URL from any format
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
		const info = await ytdl.getInfo(videoUrl);
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
